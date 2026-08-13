export async function coordinateUpdateInstall(options: {
  cleanup: () => Promise<void>
  allowQuit: () => void
  disallowQuit: () => void
  quitAndInstall: () => void
}): Promise<void> {
  await options.cleanup()
  options.allowQuit()
  try {
    options.quitAndInstall()
  } catch (error) {
    options.disallowQuit()
    throw error
  }
}
