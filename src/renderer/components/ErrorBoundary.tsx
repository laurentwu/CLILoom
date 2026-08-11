import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { i18n } from '../i18n'

type Props = {
  children: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

type State = {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo)
    this.props.onError?.(error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen items-center justify-center bg-muted/40 p-6">
          <Card className="w-full max-w-xl border-destructive/30">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                  <AlertTriangle />
                </div>
                <div>
                  <CardTitle>{i18n.t('errors:boundary.title')}</CardTitle>
                  <CardDescription>{i18n.t('errors:boundary.description')}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/50 p-4 text-xs leading-relaxed whitespace-pre-wrap break-words">
                {this.state.error?.message}
              </pre>
              <Button className="self-start" onClick={() => window.location.reload()}>
                <RotateCcw data-icon="inline-start" />
                {i18n.t('errors:boundary.reload')}
              </Button>
            </CardContent>
          </Card>
        </div>
      )
    }

    return this.props.children
  }
}
