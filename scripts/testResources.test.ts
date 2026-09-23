import { describe, expect, it } from 'vitest'
import { createTestResources, ResourceRegistrationError } from '../test-support/resources'

describe('createTestResources', () => {
  it('disposes resources in reverse registration order while awaiting async cleanups', async () => {
    const events: string[] = []
    const resources = createTestResources()
    resources.defer('first', () => {
      events.push('first-start')
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          events.push('first-end')
          resolve()
        }, 0)
      })
    })
    resources.defer('second', () => {
      events.push('second')
    })

    await resources.dispose()

    expect(events).toEqual(['second', 'first-start', 'first-end'])
  })

  it('continues disposing remaining resources when one cleanup fails', async () => {
    const events: string[] = []
    const resources = createTestResources()
    resources.defer('first', () => {
      events.push('first')
    })
    resources.defer('second', () => {
      events.push('second')
      throw new Error('second cleanup failed')
    })
    resources.defer('third', () => {
      events.push('third')
    })

    const failure = await resources.dispose().then(
      () => null,
      (error: unknown) => error
    )

    expect(events).toEqual(['third', 'second', 'first'])
    expect(failure).toBeInstanceOf(AggregateError)
    const aggregate = failure as AggregateError
    expect(aggregate.errors).toHaveLength(1)
    expect((aggregate.errors[0] as Error).message).toContain('second')
    expect((aggregate.errors[0] as Error).message).toContain('second cleanup failed')
  })

  it('keeps every identifiable error when several cleanups fail', async () => {
    const resources = createTestResources()
    resources.defer('db', () => {
      throw new Error('database close failed')
    })
    resources.defer('directory', async () => {
      throw new Error('directory remove failed')
    })
    resources.defer('process', () => undefined)

    const failure = await resources.dispose().then(
      () => null,
      (error: unknown) => error
    )

    expect(failure).toBeInstanceOf(AggregateError)
    const messages = (failure as AggregateError).errors.map((error) => (error as Error).message)
    expect(messages.some((message) => message.includes('db') && message.includes('database close failed'))).toBe(true)
    expect(messages.some((message) => message.includes('directory') && message.includes('directory remove failed'))).toBe(true)
    expect((failure as AggregateError).message).toContain('db')
    expect((failure as AggregateError).message).toContain('directory')
  })

  it('is idempotent: repeated dispose calls share the first execution', async () => {
    let runs = 0
    const resources = createTestResources()
    resources.defer('only', () => {
      runs += 1
    })

    const first = resources.dispose()
    const second = resources.dispose()

    expect(second).toBe(first)
    await first
    await resources.dispose()
    expect(runs).toBe(1)
  })

  it('rejects registering resources after dispose has started', async () => {
    const resources = createTestResources()
    resources.defer('only', () => undefined)
    const disposing = resources.dispose()

    expect(() => resources.defer('late', () => undefined)).toThrow(ResourceRegistrationError)
    await disposing
    expect(() => resources.defer('after', () => undefined)).toThrow(ResourceRegistrationError)
  })

  it('propagates non-Error cleanup rejections with their label', async () => {
    const resources = createTestResources()
    resources.defer('string-failure', () => Promise.reject('raw failure'))

    const failure = await resources.dispose().then(
      () => null,
      (error: unknown) => error
    )

    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toHaveLength(1)
    expect((failure as AggregateError).errors[0]).toBeInstanceOf(Error)
    expect(((failure as AggregateError).errors[0] as Error).message).toContain('string-failure')
    expect(((failure as AggregateError).errors[0] as Error).message).toContain('raw failure')
  })
})
