/// <reference types="vite/client" />

import type { CLILoomApi } from '../main/preload'
import type { CLILoomAssistantApi } from '../main/assistantPreload'

declare global {
  interface Window {
    cliLoom?: CLILoomApi
    cliLoomAssistant?: CLILoomAssistantApi
  }
}

export {}
