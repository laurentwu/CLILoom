import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type TerminalScrollHandler = (deltaY: number) => void

type TerminalScrollContextValue = {
  register: (id: string, handler: TerminalScrollHandler) => () => void
}

const TerminalScrollContext = createContext<TerminalScrollContextValue | null>(null)

export function TerminalScrollGroup({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const handlersRef = useRef(new Map<string, TerminalScrollHandler>())

  const register = useCallback((id: string, handler: TerminalScrollHandler) => {
    handlersRef.current.set(id, handler)
    return () => {
      if (handlersRef.current.get(id) === handler) handlersRef.current.delete(id)
    }
  }, [])

  const contextValue = useMemo(() => ({ register }), [register])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const handleWheel = (event: WheelEvent) => {
      if (handlersRef.current.size === 0 || event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      const target = event.target
      if (
        target instanceof Element &&
        target.closest('[data-terminal-scroll-region], [data-independent-scroll-region]')
      ) {
        return
      }

      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1
      event.preventDefault()
      for (const handler of handlersRef.current.values()) handler(event.deltaY * multiplier)
    }

    host.addEventListener('wheel', handleWheel, { passive: false })
    return () => host.removeEventListener('wheel', handleWheel)
  }, [])

  return (
    <TerminalScrollContext.Provider value={contextValue}>
      <div className={cn('min-h-0 min-w-0 max-w-full', className)} ref={hostRef}>
        {children}
      </div>
    </TerminalScrollContext.Provider>
  )
}

export function useTerminalScrollRegistration(id: string, handler: TerminalScrollHandler) {
  const context = useContext(TerminalScrollContext)
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!context) return
    return context.register(id, (deltaY) => handlerRef.current(deltaY))
  }, [context, id])
}
