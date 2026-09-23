export type Cleanup = () => void | Promise<void>

export type TestResources = {
  defer(label: string, cleanup: Cleanup): void
  dispose(): Promise<void>
}

type DeferredCleanup = {
  label: string
  cleanup: Cleanup
}

export class ResourceRegistrationError extends Error {
  constructor() {
    super('Cannot register cleanup after dispose() has started')
    this.name = 'ResourceRegistrationError'
  }
}

export function createTestResources(): TestResources {
  const deferred: DeferredCleanup[] = []
  let disposeState: 'pending' | 'started' = 'pending'
  let sharedResult: Promise<void> | null = null

  return {
    defer(label: string, cleanup: Cleanup): void {
      if (disposeState !== 'pending') {
        throw new ResourceRegistrationError()
      }
      deferred.push({ label, cleanup })
    },
    dispose(): Promise<void> {
      if (disposeState !== 'pending') return sharedResult!
      disposeState = 'started'
      sharedResult = (async () => {
        const errors: Array<{ label: string; error: unknown }> = []
        while (deferred.length > 0) {
          const { label, cleanup } = deferred.pop()!
          try {
            await cleanup()
          } catch (error) {
            errors.push({ label, error })
          }
        }
        if (errors.length > 0) {
          throw new AggregateError(
            errors.map((entry) => (
              entry.error instanceof Error
                ? new Error(`${entry.label}: ${entry.error.message}`, { cause: entry.error })
                : new Error(`${entry.label}: ${String(entry.error)}`)
            )),
            `Failed to dispose ${errors.length} test resource${errors.length === 1 ? '' : 's'}: ${errors.map((entry) => entry.label).join(', ')}`
          )
        }
      })()
      return sharedResult
    }
  }
}
