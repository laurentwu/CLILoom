import { AppError } from '../shared/appError'

export class NotFoundError extends AppError {
  constructor(message: string) {
    super({ code: 'NOT_FOUND', message })
    this.name = 'NotFoundError'
  }
}

export class TerminalRetryError extends AppError {
  constructor(message: string) {
    super({ code: 'TERMINAL_RETRY', message })
    this.name = 'TerminalRetryError'
  }
}
