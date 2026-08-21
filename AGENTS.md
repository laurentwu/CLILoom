# Repository Guidelines

## Project Structure & Boundaries

This is a TypeScript Electron desktop application with Vite/React renderers.

- `src/renderer/` contains the main and assistant renderer entry points, UI, themes, and CSS. Reusable components live in `components/`, shadcn/Radix primitives in `components/ui/`, and workflow-editor code in `designer/`.
- `src/main/` contains Electron windows and preload bridges, IPC, SQLite, PTY/process execution, runtime persistence, updates, and cleanup.
- `src/shared/` contains cross-process types and pure logic, including workflow/runtime, shell, terminal, settings, and i18n code. Keep it free of Electron and browser dependencies.
- `e2e/` contains Playwright Electron tests. `scripts/` contains development, test, build, license, and packaging tooling.
- `native/windows/` contains the C++20 Console launcher. `build/` contains checked-in packaging resources; neither directory is generated output.
- `dist/`, `.vite/`, `release/`, `out/`, `coverage/`, `playwright-report/`, `test-results/`, and `*.tsbuildinfo` are generated. Do not edit or commit them.
- `THIRD_PARTY_NOTICES.md` is tracked but generated; refresh it with the license script instead of editing it directly.
- Do not commit databases or WAL files, environment files, logs, or machine-specific paths.

## Toolchain & Commands

- Use the Node version declared by `.nvmrc` and `package.json#engines` (currently Node 24) and use npm with `package-lock.json`.
- `npm install` installs dependencies and rebuilds Electron native modules. Do not use `--ignore-scripts`.
- `npm run dev` starts only Vite; `npm run electron:dev` builds the main process and launches Electron.
- `npm run typecheck` checks application and E2E TypeScript. `npm run build` checks licenses and builds both renderers and the main process.
- `npm test` runs Vitest through Electron and excludes `src/main/shellSmoke.test.ts`. Use `npm run test:shell-smoke` for real host Shell/PTY coverage and `npm run test:e2e` for Playwright Electron flows.
- On real Windows, `npm run test:windows-cli-smoke` validates the native Console launcher. See `PACKAGING.md` for packaging commands and platform prerequisites.
- After runtime dependency changes, run `npm run licenses:generate`, review the result, and run `npm run licenses:check`.

## Coding Style & Cross-Cutting Changes

Use TypeScript for application code. Match the existing style: two-space indentation, single quotes, no trailing semicolons, and named exports for shared utilities. React components use `PascalCase`; functions, variables, and file-local helpers use `camelCase`. Follow the local style for CJS/Shell tooling and C++ native code.

Use the `@/` alias only in renderer code. Prefer existing `components/ui/` primitives and Lucide icons. Keep Electron APIs in `src/main/`, browser UI in `src/renderer/`, and portable logic in `src/shared/`.

Update both `src/shared/i18n/locales/en.ts` and `zh.ts` for user-facing text, preserving matching keys and interpolation placeholders. Keep `README.md` and `README.zh-CN.md` aligned; update `SHELLS.md`, `PACKAGING.md`, or `SECURITY_MODEL.md` when their documented behavior changes.

## Testing Guidelines

Vitest tests use `*.test.{ts,tsx}` and live beside covered code or in `scripts/`; Playwright tests use `*.e2e.ts` in `e2e/`. Add focused regression tests for changed behavior, especially workflow/runtime logic, IPC and persistence, process/session lifecycle, renderer helpers, and designer geometry.

Run focused tests while iterating. For code changes, run `npm test` and `npm run typecheck` before handoff; also run `npm run build` for build configuration or Electron entry-point changes, `npm run test:e2e` for Electron UI integration, and the relevant smoke tests for Shell, PTY, native launcher, or packaging changes.

## Security & IPC

Keep renderer sandboxing and `contextIsolation` enabled, `nodeIntegration` disabled, the CSP restrictive, and navigation/new-window creation blocked. Expose renderer capabilities only through typed preload APIs.

When changing IPC, update the main handler, preload API, and renderer type declarations together. Treat renderer payloads as untrusted: verify the expected window/main frame and validate filesystem paths, process inputs, and other privileged arguments in the main process.

## Commit & Pull Request Guidelines

Use concise Conventional Commit subjects such as `feat(scope): ...`, `fix(scope): ...`, or `docs: ...`, and keep commits focused. Pull requests should summarize the change and testing, link relevant issues, and include screenshots or recordings for visible UI changes.
