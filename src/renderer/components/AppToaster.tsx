import { useEffect } from 'react'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'

type AppToastDetail = {
  text: string
  type?: 'error' | 'success' | 'info'
}

export function AppToaster() {
  useEffect(() => {
    function onAppToast(event: Event) {
      const detail = (event as CustomEvent<AppToastDetail>).detail
      const show = detail.type === 'success' ? toast.success : detail.type === 'info' ? toast.info : toast.error
      show(detail.text)
    }

    window.addEventListener('app:error', onAppToast)
    return () => window.removeEventListener('app:error', onAppToast)
  }, [])

  return <Toaster position="bottom-right" richColors closeButton />
}
