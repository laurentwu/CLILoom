# Repository Guidelines

## Project Structure & Module Organization

This is a TypeScript Electron desktop application with a Vite/React renderer.

- `src/renderer/` contains the React entry points, application UI, theme utilities, and global CSS. Reusable UI lives in `components/`, shadcn/Radix primitives in `components/ui/`, and workflow-editor code in `designer/`.
- `src/main/` contains the Electron main process and preload bridge, IPC handlers, SQLite access and schema initialization, PTY process execution, runtime persistence/reconciliation, and task cleanup.
- `src/shared/` contains cross-process workflow types, validation and interpolation, expression evaluation, the runtime engine, and terminal-buffer helpers. Keep this layer free of Electron and browser dependencies.
- `scripts/` contains the Electron development launcher and the Vitest wrapper used to run tests in Electron's Node runtime.
- `dist/`, `.vite/`, `release/`, `out/`, and `*.tsbuildinfo` are generated. Do not edit or commit them.

## Build, Test, and Development Commands

- `npm install` installs dependencies; its `postinstall` hook rebuilds native modules for Electron.
- `npm run dev` starts only the Vite renderer dev server.
- `npm run electron:dev` starts Vite and launches Electron against the dev server.
- `npm run build` type-checks, builds the renderer, then compiles the Electron main process.
- `npm run build:main` compiles only the main-process TypeScript project.
- `npm run typecheck` runs TypeScript project checks without emitting app bundles.
- `npm test` runs the Vitest suite once through the Electron runtime.
- `npm run electron:rebuild` rebuilds the native `better-sqlite3` and `node-pty` dependencies.

## Coding Style & Naming Conventions

Use TypeScript throughout. Match the existing style: two-space indentation, single quotes, no trailing semicolons, and named exports for shared utilities. React components use `PascalCase`; functions, variables, and file-local helpers use `camelCase`. The `@/` import alias points to `src/renderer/`; use it only in renderer code. Prefer existing primitives in `src/renderer/components/ui/` and Lucide icons when extending the UI. Keep Electron-only APIs in `src/main/`, browser UI in `src/renderer/`, and cross-process types or pure logic in `src/shared/`.

## Testing Guidelines

Tests use Vitest, follow the `*.test.ts` naming pattern, and live beside the code they cover across `src/main/`, `src/renderer/`, and `src/shared/`. Add focused regression tests for changes to workflow validation/runtime behavior, expression parsing, persistence and schema initialization, process/session lifecycle, renderer helpers, or designer geometry. Native-module tests rely on the repository's Electron-based test wrapper. Run `npm test` and `npm run typecheck` before submitting changes; also run `npm run build` when changing build configuration or Electron entry points.

## Commit & Pull Request Guidelines

Recent history uses concise, imperative commit subjects such as `Refine terminal detail layout` and `Fix workflow output persistence stalls`. Keep each commit focused. Pull requests should include a short summary, testing performed, linked issues when applicable, and screenshots or screen recordings for visible UI changes.

## Security & Configuration Tips

Keep `contextIsolation: true` and `nodeIntegration: false`. Expose renderer capabilities through the preload bridge and typed IPC APIs rather than importing Node or Electron modules into renderer code. Validate filesystem paths and process inputs at the IPC boundary. Do not commit local databases and WAL files, environment files, logs, generated output, or machine-specific paths.
