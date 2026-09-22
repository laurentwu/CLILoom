import type { StartupEchoContext } from './terminalStartupEcho'

// Byte structures captured from the failed Package run 35694396922 (job logs
// 106637981502 macOS and 106637981584 Windows). Machine-specific temporary
// directories are replaced with synthetic paths. The fixtures reproduce the
// observed control sequences, redraw boundaries, and padding. They exist
// only for tests and are never imported by production code paths.

export const DARWIN_STARTUP_CONTEXT: StartupEchoContext = {
  family: 'posix',
  platform: 'darwin',
  cols: 40
}

export const WIN32_STARTUP_CONTEXT: StartupEchoContext = {
  family: 'posix',
  platform: 'win32',
  cols: 40
}

export const CAPTURED_TASK_PREFIX = `printf '%s ' "任务说明：请先检查 UI 布局与主题样式改动，再运行 npm test 与 npm run typecheck，修复全部失败用例，最后用中文总结本次改动、影响范围和验证结果。提示词：`
export const CAPTURED_INTERNAL_BINDING = '${CLILOOM_INTERNAL_VALUE_1}'
export const CAPTURED_PROGRAM_OUTPUT = `${CAPTURED_TASK_PREFIX}实际参数-$(echo 注入) logout\r\n`

export const CAPTURED_BINDING_NAME = 'CLILOOM_INTERNAL_VALUE_1'
export const CAPTURED_BINDING_VALUE = '实际参数-$(echo 注入)'

export const MACOS_CAPTURED_COMMAND = `${CAPTURED_TASK_PREFIX}${CAPTURED_INTERNAL_BINDING}";printf x >> "/var/folders/aa/fixtures1e2e-temp-1234567890abc/T/cliloom-shell-ssmoke-data1/工作 空间-😀/startup-echo-count.txt"; exit`
export const MACOS_CAPTURED_DISPLAY_COMMAND = `${CAPTURED_TASK_PREFIX}${CAPTURED_BINDING_VALUE}";printf x >> "/var/folders/aa/fixtures1e2e-temp-1234567890abc/T/cliloom-shell-ssmoke-data1/工作 空间-😀/startup-echo-count.txt"; exit`

// macOS Readline at 40 columns redraws row by row: every segment ends with a
// padding space, the wide glyph that crossed the boundary was already drawn
// and is repeated after CR, and the first boundary additionally uses the
// "space + ESC[K" fragment before the wrapped glyph.
export const MACOS_CAPTURED_REDRAW = [
  `printf '%s ' "任务说明：请先检 \u001b[K查`,
  `查 UI 布局与主题样式改动，再运行 npm tes `,
  `t 与 npm run typecheck，修复全部失败用例 `,
  `，最后用中文总结本次改动、影响范围和验证 `,
  `结果。提示词：${CAPTURED_INTERNAL_BINDING.slice(0, -1)} `,
  `}";printf x >> "/var/folders/aa/fixtures1 `,
  `e2e-temp-1234567890abc/T/cliloom-shell-s `,
  `smoke-data1/工作 空间-😀/startup-echo-co `,
  `unt.txt"; exit`
].join('\r')

export const CAPTURED_ZSH_BANNER = [
  'The default interactive shell is now zsh.',
  'To update your account to use zsh, please run `chsh -s /bin/zsh`.',
  'For more details, please visit https://support.apple.com/kb/HT208050.'
]

export const MACOS_CAPTURED_STREAM = [
  MACOS_CAPTURED_COMMAND,
  '\r\n',
  '\r\n',
  ...CAPTURED_ZSH_BANNER.flatMap((line) => [line, '\r\n']),
  '\u001b[?1034hCLILOOM$ ',
  MACOS_CAPTURED_REDRAW,
  '\r\n',
  CAPTURED_PROGRAM_OUTPUT
].join('')

export const MACOS_CAPTURED_EXPECTED = [
  '\r\n',
  ...CAPTURED_ZSH_BANNER.flatMap((line) => [line, '\r\n']),
  '\u001b[?1034hCLILOOM$ ',
  MACOS_CAPTURED_DISPLAY_COMMAND,
  '\r\n',
  CAPTURED_PROGRAM_OUTPUT
].join('')

export const WIN32_CAPTURED_COMMAND = `${CAPTURED_TASK_PREFIX}${CAPTURED_INTERNAL_BINDING}";printf x >> "C:\\tmp\\cliloom-fixture-zZRD3A\\工作 空间-😀\\startup-echo-count.txt"; exit`
export const WIN32_CAPTURED_DISPLAY_COMMAND = `${CAPTURED_TASK_PREFIX}${CAPTURED_BINDING_VALUE}";printf x >> "C:\\tmp\\cliloom-fixture-zZRD3A\\工作 空间-😀\\startup-echo-count.txt"; exit`

export const WIN32_CAPTURED_PREFIX = [
  '\u001b[?9001h',
  '\u001b[?1004h',
  '\u001b[?2004h',
  '\u001b[?25l',
  '\u001b[2J',
  '\u001b[m',
  '\u001b[H',
  '\u001b]0;C:\\Program Files\\Git\\bin\\bash.exe\u0007',
  '\u001b[?25h'
].join('')

// Windows ConPTY emits no bare echo. Inside the first draw it inserts a
// padding space, disables bracketed paste, repositions the cursor to the
// wrapping column, and pads again before the wide glyph that crossed the
// boundary.
export const WIN32_CAPTURED_REDRAW = [
  `printf '%s ' "任务说明：请先检 `,
  '\u001b[?2004l',
  '\u001b[1;40H',
  ` 查 UI 布局与主题样式改动，再运行 npm test 与 npm run typecheck，修复全部失败用例，`,
  `最后用中文总结本次改动、影响范围和验证结果。提示词：${CAPTURED_INTERNAL_BINDING}";`,
  `printf x >> "C:\\tmp\\cliloom-fixture-zZRD3A\\工作 空间-😀\\startup-echo-count.txt"; exit`
].join('')

export const WIN32_CAPTURED_STREAM = `${WIN32_CAPTURED_PREFIX}CLILOOM$ ${WIN32_CAPTURED_REDRAW}\r\n${CAPTURED_PROGRAM_OUTPUT}`
export const WIN32_CAPTURED_EXPECTED = `${WIN32_CAPTURED_PREFIX}CLILOOM$ ${WIN32_CAPTURED_DISPLAY_COMMAND}\r\n${CAPTURED_PROGRAM_OUTPUT}`
