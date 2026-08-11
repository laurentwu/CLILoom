import { AppError } from '../shared/appError'

type TextClipboard = Pick<Clipboard, 'readText' | 'writeText'>

function getSystemClipboard(): TextClipboard {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    throw new AppError({
      code: 'CLIPBOARD_UNAVAILABLE',
      message: 'System clipboard is unavailable',
      i18nKey: 'errors:clipboard.unavailable'
    })
  }
  return navigator.clipboard
}

export async function readClipboardText(clipboard: TextClipboard = getSystemClipboard()): Promise<string> {
  return clipboard.readText()
}

export async function writeClipboardText(
  text: string,
  clipboard: TextClipboard = getSystemClipboard()
): Promise<void> {
  await clipboard.writeText(text)
}
