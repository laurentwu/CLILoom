import React from 'react'
import ReactDOM from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_ASSISTANT_CONFIG,
  DEFAULT_LAYOUT_PREFERENCES,
  DEFAULT_SHELL_PREFERENCES
} from '../shared/appSettings'
import type { AssistantTerminalStatus } from '../shared/assistant'
import { AssistantApp, type AssistantBootstrap } from './assistant/AssistantApp'
import { AppToaster } from './components/AppToaster'
import { ErrorBoundary } from './components/ErrorBoundary'
import { i18n, syncI18nLanguage } from './i18n'
import { preloadBundledCodeFont } from './fonts'
import { DEFAULT_SKIN, initializeSkin } from './theme'
import { TooltipProvider } from '@/components/ui/tooltip'
import './styles.css'

const fallbackBootstrap: AssistantBootstrap = {
  settings: {
    assistant: DEFAULT_ASSISTANT_CONFIG,
    appearance: DEFAULT_APPEARANCE_PREFERENCES,
    layout: DEFAULT_LAYOUT_PREFERENCES,
    shell: DEFAULT_SHELL_PREFERENCES,
    skins: [],
    activeSkin: DEFAULT_SKIN
  },
  shell: {
    platform: 'other',
    preferences: DEFAULT_SHELL_PREFERENCES,
    candidates: [],
    effectiveShell: null,
    error: i18n.t('status:shell.notDetected')
  },
  status: { state: 'idle' } satisfies AssistantTerminalStatus,
  transcript: ''
}

async function startAssistantRenderer(): Promise<void> {
  const fontReady = preloadBundledCodeFont()
  let bootstrap = fallbackBootstrap
  let bootstrapError: string | null = null
  try {
    bootstrap = await window.cliLoomAssistant?.bootstrap() ?? fallbackBootstrap
  } catch (error) {
    bootstrapError = error instanceof Error ? error.message : String(error)
  }
  await fontReady

  initializeSkin(bootstrap.settings.activeSkin)
  syncI18nLanguage(bootstrap.settings.appearance.language)
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <I18nextProvider i18n={i18n}>
        <ErrorBoundary>
          <TooltipProvider>
            <AssistantApp initialBootstrap={bootstrap} bootstrapError={bootstrapError} />
            <AppToaster />
          </TooltipProvider>
        </ErrorBoundary>
      </I18nextProvider>
    </React.StrictMode>
  )
  window.cliLoomAssistant?.themeReady()
}

void startAssistantRenderer()
