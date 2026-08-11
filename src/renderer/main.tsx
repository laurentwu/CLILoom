import React from 'react'
import ReactDOM from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AppToaster } from './components/AppToaster'
import { i18n } from './i18n'
import { preloadBundledCodeFont } from './fonts'
import { initializeSkin, loadInitialSkin } from './theme'
import { TooltipProvider } from '@/components/ui/tooltip'
import './styles.css'

async function startRenderer(): Promise<void> {
  const [skin] = await Promise.all([
    loadInitialSkin(window.cliLoom?.getActiveSkin),
    preloadBundledCodeFont()
  ])

  initializeSkin(skin)
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <I18nextProvider i18n={i18n}>
        <ErrorBoundary>
          <TooltipProvider>
            <App initialSkin={skin} />
            <AppToaster />
          </TooltipProvider>
        </ErrorBoundary>
      </I18nextProvider>
    </React.StrictMode>
  )
  window.cliLoom?.themeReady()
}

void startRenderer()
