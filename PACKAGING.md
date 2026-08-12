# CLILoom packaging

CLILoom uses `electron-builder` to create unsigned x64 and ARM64 packages for macOS, Windows, and Linux. Compiled application files and installers are written to `dist/` and `release/` respectively; both directories are ignored by Git.

## Runtime baseline

CLILoom targets Electron 43.3.0, which embeds Chromium 150, Node 24.18.1, and Node module ABI 148. The minimum supported operating systems are:

- macOS 12 (Monterey) or newer. macOS 11 is no longer supported by Electron 43.
- Windows x64 and ARM64.
- Linux glibc x64 and ARM64 (Ubuntu 24.04 or equivalent). musl/Alpine is not supported.

Linux Wayland sessions use Electron's native Wayland default behavior. No `--ozone-platform=x11` override is applied, so X11 sessions continue to use X11. Frameless assistant windows follow the system's default corner rounding on Linux.

## Prerequisites

- Node.js `>=24.15.0 <25` and npm. This is the development/CI toolchain requirement (resolving dependencies, running npm, packaging); it is independent of the Node version embedded in Electron. The repository pins this baseline with an `.nvmrc` containing `24`, an `engines.node` range of `>=24.15.0 <25`, and `node-version: 24` in the GitHub Actions workflow. The minimum `24.15.0` also satisfies jsdom 30's Node 24 support range. The host Node 24 toolchain and Electron 43's embedded Node (24.18.1) are the same Node generation but released independently, so their patch versions need not match.
- The native build toolchain for the host platform (C++20 capable):
  - Windows: Visual Studio 2022 C++ build tools. ARM64 builds require the ARM64 toolchain. The same toolchain builds the small Console-subsystem `cliloom-cli.exe` used for reliable stdin forwarding.
  - macOS: current Xcode command line tools.
  - Linux: GCC or Clang supporting C++20. Ubuntu 24.04 runners satisfy this.
- A host OS matching the package platform.
- For Windows WSL acceptance: Windows WSL with at least one registered distribution using a regular default user and bash, zsh, or sh. Both inbox and Microsoft Store-serviced WSL are launched through the trusted system `wsl.exe` entry.

Run `npm install` after cloning. The postinstall hook (`electron-builder install-app-deps`) rebuilds `node-pty` for the installed Electron version and architecture. `better-sqlite3` 13 ships N-API prebuilt binaries (`prebuilds/<platform>-<arch>.node`) and usually does not require an Electron-ABI-specific recompile, but it is still validated through the packaging tests.

RPM creation on Debian or Ubuntu also requires:

```sh
sudo apt-get install --no-install-recommends rpm
```

On Linux, Electron must have either a correctly configured SUID sandbox helper or usable unprivileged user namespaces. `npm run electron:dev` checks this before launching and fails with setup instructions instead of adding `--no-sandbox`. The most predictable development setup is to configure the helper printed by that command as `root:root` with mode `4755`; reinstalling Electron can replace it, so repeat the check after `npm ci` or dependency upgrades.

The AppImage uses electron-builder's pinned static runtime (`toolsets.appimage: 1.0.3`), so it does not require a FUSE 2 package. Because a SUID helper cannot elevate from an AppImage mount, its fail-closed launcher passes `--disable-setuid-sandbox` and requires Chromium's primary user-namespace sandbox; this is distinct from `--no-sandbox`, which remains forbidden. Ubuntu 23.10 and newer restrict user namespaces for downloaded applications through AppArmor by default, so the AppImage is not the recommended package on that baseline. The isolated Ubuntu CI runner temporarily lifts that kernel policy only while exercising the AppImage, restores it immediately afterward, and then separately verifies the installed DEB/SUID path.

### Electron binary on-demand download

Electron 42+ no longer downloads its binary during `npm install`. Instead `require('electron')` triggers an on-demand download the first time the binary or `path.txt` is missing. This means a clean checkout's first `npm test`, `npm run electron:dev`, or other Electron invocation may perform a network download, after which the result is cached.

To pre-warm the cache before an offline build, run this on a networked machine (do **not** add it to `postinstall`, to preserve the on-demand behavior):

```sh
npx install-electron --no
```

If the download fails, check proxy, mirror, and cache settings, then retry. Do not delete the entire `node_modules` directory for a download failure; preserve Electron's original error for diagnosis.

## Native modules

- `better-sqlite3` 13 is an N-API module. It loads from `prebuilds/<platform>-<arch>.node` (for example `darwin-arm64.node`, `win32-x64.node`, `linux-arm64.node`). A source-compile fallback lives in `build/Release/`.
- `node-pty` 1.1.0 is Electron-ABI and platform sensitive. It must be rebuilt on the target OS/architecture via `electron-builder install-app-deps` (postinstall) or `npm run electron:rebuild`.

`node-pty` rebuild failure usually indicates a missing or incompatible C++20 toolchain. Verify the toolchain, then run:

```sh
npm run electron:rebuild
```

Do not work around failures by disabling PTY, moving `node-pty` to devDependencies, or switching to an un-audited prerelease or fork.

`npm ci --ignore-scripts` is **not** a supported workflow because it skips native dependency rebuilding.

## Clean commands

Generated artifacts are removed by a fixed-whitelist script with no third-party dependencies:

```sh
npm run clean       # build scope + release/out/coverage/playwright-report/test-results
```

The three scopes are also wired to npm lifecycle hooks:

| Scope | Script | What it removes |
| --- | --- | --- |
| `build` | `prebuild` (runs before `npm run build`) | `dist/`, `.vite/`, root-level `*.tsbuildinfo` |
| `main` | `prebuild:main` (runs before `npm run build:main`) | `dist/main/`, `dist/tsconfig.main.tsbuildinfo` |
| `all` | `clean` | Everything in build scope plus `release/`, `out/`, `coverage/`, `playwright-report/`, `test-results/` |

The clean script only deletes the artifacts listed above. It never touches `node_modules/`, `src/`, `build/`, `.github/`, databases, logs, environment files, or any user directory. You can invoke the scopes directly for diagnostics:

```sh
node scripts/clean.cjs build
node scripts/clean.cjs main
node scripts/clean.cjs all
```

`npm run clean` deletes reproducible installers and test reports (in `release/`, `coverage/`, `playwright-report/`, `test-results/`); these can be regenerated by rebuilding. The clean script refuses to delete anything outside the project root and validates every target before removing any file.

## Local commands

```sh
npm test
npm run test:shell-smoke
npm run test:windows-cli-smoke # real Windows only; PowerShell stdin pipeline
npm run test:wsl-smoke       # real Windows only; explicit SKIP elsewhere
npm run typecheck
npm run build
npm run package:dir
npm run package:mac
npm run package:win
npm run package:appimage
npm run package:linux
```

`npm test` intentionally excludes `src/main/shellSmoke.test.ts`, including when that path is passed as a filter. Use `npm run test:shell-smoke` to run it. The smoke suite uses the host's real Shell, `node-pty`, and child-process implementation, so run it on the same operating system as the package being validated. On Windows, `npm run build:main` also builds `dist/native/cliloom-cli.exe`; `npm run test:windows-cli-smoke` verifies that it remains a Console application and that a multiline Unicode PowerShell pipeline reaches the assistant bridge intact. User-facing Shell selection and troubleshooting are documented in [SHELLS.md](SHELLS.md).

### Windows WSL smoke

Run the dedicated smoke on every Windows architecture being released and record its final metadata line:

```powershell
$env:CLILOOM_WSL_DISTRO = 'Ubuntu'
$env:CLILOOM_WSL_PROJECT = 'C:\work\cliloom' # optional; defaults to this checkout
$env:CLILOOM_WSL_ASSISTANT_COMMAND = 'codex'  # optional WSL-native CLI check
npm run test:wsl-smoke
```

The command builds the main process and Console CLI, first pipes multiline Unicode JSON from WSL through `cliloom-cli.exe` into a real assistant bridge, then re-enters Electron's Node runtime for native-module compatibility. It uses the current trusted-launcher implementation and actual `node-pty`/`ProcessRunner`, and validates catalog discovery, default user/login Shell, Windows and WSL path round-trips, `WSLENV`, helper isolation from user `PATH`/`HOME`/`XDG_RUNTIME_DIR`, `--cd`, Windows interop, Hook execution, historical retry, timeout, immediate stop, `killAll`, cgroup cleanup of a background process that clears its environment and creates a new Linux session, and next-validation recovery after a session leader is killed. Reliable containment requires a working systemd user scope on cgroup v2; a distribution without that capability must fail validation rather than use PID/session heuristics. On non-Windows the command prints `SKIP` and explicitly states that no WSL behavior was validated; that result must never be recorded as a WSL pass. Run the matrix on WSL 1 and WSL 2 when available, on default and non-default distributions, with both drive and WSL-native project paths, and on x64/ARM64 for every published architecture. Store-serviced WSL must continue to work through `%SystemRoot%\System32\wsl.exe` (or `Sysnative` for a future 32-bit host), not a user WindowsApps alias.

`package:dir` creates an unpacked application for the current platform and architecture. Platform commands also default to the current host architecture. `package:appimage` creates only the portable Linux AppImage, while `package:linux` creates AppImage, DEB, and RPM outputs. A Linux unpacked directory is a build intermediate, not an installable release: before launching it, configure `release/linux-unpacked/chrome-sandbox` as root-owned mode `4755` (run `chown` before `chmod`, because changing ownership clears the SUID bit), or use a host with permitted unprivileged user namespaces. DEB/RPM installation configures the packaged helper ownership and mode automatically; AppImage cannot install a privileged helper and therefore requires usable user namespaces. To select an architecture explicitly on matching hardware, append the electron-builder flag:

```sh
npm run package:mac -- --x64
npm run package:mac -- --arm64
npm run package:win -- --x64
npm run package:win -- --arm64
npm run package:appimage -- --x64
npm run package:appimage -- --arm64
npm run package:linux -- --x64
npm run package:linux -- --arm64
```

Native dependencies make builds most reliable when each architecture is built on matching hardware; the GitHub Actions workflow does this automatically.

## Package matrix

| Platform | Architectures | Formats |
| --- | --- | --- |
| macOS | x64, ARM64 | DMG, ZIP |
| Windows | x64, ARM64 | NSIS installer, Portable EXE |
| Linux | x64, ARM64 | AppImage, DEB, RPM |

Artifacts use the application version from `package.json` and include the target architecture in their file names.

Linux packages identify `CLILoom Team <laurentwu@users.noreply.github.com>` as their maintainer.

## Stable application identity

The public application identity is fixed as follows:

| Field | Value |
| --- | --- |
| GitHub repository | `laurentwu/CLILoom` |
| Package name and executable slug | `cliloom` |
| Product name | `CLILoom` |
| Application ID / Windows AUMID | `io.github.laurentwu.cliloom` |
| Linux desktop name | `io.github.laurentwu.cliloom.desktop` |
| User data directory name | `CLILoom` |
| Windows NSIS installer GUID | `2af5650f-5c23-520c-b262-debedf73652c` |

The NSIS GUID is the UUID v5 that electron-builder 26.15.3 derives from the application ID using its namespace `50e065bc-3134-11e6-9bab-38c9862bdaf3`. It is also declared explicitly so upgrades and uninstall records retain the same identity if build tooling changes. Neither the application ID nor the installer GUID may change after release.

The user data directory is intentionally independent of the product name. Installed and portable builds both use the operating system's application-data root followed by `CLILoom`: `%APPDATA%\CLILoom` on Windows, `~/Library/Application Support/CLILoom` on macOS, and normally `~/.config/CLILoom` on Linux. Changing a display name must not relocate existing user data.

On POSIX systems the application repairs the user data directory to mode `0700` and the SQLite database to mode `0600` whenever it opens the database. Windows uses the ACL inherited from the per-user application-data directory. The database is plaintext rather than application-encrypted; the complete trust, retention, and deletion model is documented in [SECURITY_MODEL.md](SECURITY_MODEL.md).

## Versioning

CLILoom follows Semantic Versioning 2.0.0. `package.json` is the version source of truth and contains the bare version, such as `0.1.0`; Git tags add the `v` prefix, such as `v0.1.0`. Published versions and tags must never be reused or replaced.

- Patch releases such as `0.1.1` contain compatible fixes and small improvements.
- Minor releases such as `0.2.0` contain new functionality or any breaking change made before `1.0.0`.
- Prereleases use identifiers such as `0.2.0-alpha.1`, `0.2.0-beta.1`, and `0.2.0-rc.1`.
- `1.0.0` marks a stable compatibility contract for persisted data, workflow configuration, and user-facing CLI behavior. After `1.0.0`, incompatible changes increment the major version, compatible features increment the minor version, and compatible fixes increment the patch version.

The source is distributed under the Apache License 2.0 in `LICENSE`. The license file and generated `THIRD_PARTY_NOTICES.md` dependency inventory are included in packaged applications. Run `npm run licenses:generate` after dependency changes and review the diff; `npm run licenses:check` and the build lifecycle reject stale notices.

## Verification

Run in order on the host before packaging:

```sh
npm ci
npm ls --depth=0
npm ls electron electron-builder better-sqlite3 node-pty @types/node @types/better-sqlite3
npm ls js-yaml
npm audit --registry=https://registry.npmjs.org
npm run licenses:check
npm test
npm run typecheck
npm run build
npm run test:e2e
npm run test:shell-smoke
# On a real Windows WSL host:
npm run test:wsl-smoke
npm run package:dir
```

The dependency checks confirm: direct dependencies match `package.json` with no invalid/extraneous entries; Electron stays at 43.3.0 with `better-sqlite3` 13.0.3, `node-pty` 1.1.0, and `@types/node` 24.x; and `js-yaml` resolves to the overridden 4.3.1 under `@mdxeditor/editor` (never the vulnerable 4.3.0). The audit must be run against the official `https://registry.npmjs.org` endpoint, because mirrors without an audit endpoint can return a 404 that must not be mistaken for "0 vulnerabilities", and it must report `found 0 vulnerabilities`.

### Bounded `electron:dev` smoke

`npm run electron:dev` is the only command that exercises the `concurrently` 10 and `wait-on` 9 chain end to end, so it should be smoke-tested once on a clean install before packaging:

1. Run `npm run electron:dev`. Its Linux sandbox preflight must pass; within 60 seconds Vite must report its local URL and the Electron main window must open.
2. Send a single Ctrl+C to the parent command. Within 10 seconds the parent command must return, the Electron window must close, and there must be no leftover Vite, `wait-on`, or Electron processes.
3. Confirm the development port is released: `npm exec wait-on -- --reverse --timeout 10000 http://127.0.0.1:5173` should exit 0.

Startup timeout, a window that never opens, failure to exit on a single Ctrl+C, a held 5173 port, or any residual child process is a release blocker.

### Host packaging acceptance

After satisfying the Linux sandbox prerequisite above, launch the `package:dir` unpacked application and verify:

- An existing project database opens correctly (projects, tasks, workflows, skins, terminal history).
- Creating a new project/task and launching an interactive terminal works (PTY input, resize, exit, close).
- On Windows, both a drive-backed project and a matching `\\wsl$` / `\\wsl.localhost` project run in the explicitly selected distribution without a manual `wsl` prefix; stopping the task leaves unrelated distribution processes alive.
- The frameless assistant window opens, drags, and closes normally.
- Directory selection and skin import accept the Electron 43 default of starting from Downloads (or home if Downloads is absent) when no `defaultPath` is supplied.
- Skin export suggests the file name `cliloom-skin.json` and writes successfully to a user-chosen target.
- On Linux, both X11 and Wayland sessions launch without crashing or black screens.

### Packaging structure acceptance

- `app.asar.unpacked/node_modules/better-sqlite3/prebuilds/` contains the `.node` file matching the target platform/architecture (for example `linux-x64.node`).
- `app.asar.unpacked/node_modules/node-pty/` contains the target platform's native binding and runtime helper files.
- Windows unpacked applications contain `cliloom-cli.exe` with PE subsystem `IMAGE_SUBSYSTEM_WINDOWS_CUI`, while `CLILoom.exe` remains `IMAGE_SUBSYSTEM_WINDOWS_GUI`. A PowerShell pipe and a WSL pipe must both deliver non-empty Unicode workflow JSON to the bridge.
- The ASAR file list does not contain project declaration files (`dist/**/*.d.ts`, `dist/**/*.d.ts.map`, `dist/**/*.tsbuildinfo`).
- The ASAR file list contains `LICENSE` and `THIRD_PARTY_NOTICES.md`, and the Electron runtime still contains its upstream `LICENSE` and `LICENSES.chromium.html` files.
- Installed Linux DEB/RPM packages contain a root-owned `chrome-sandbox` with mode `4755`.
- Linux AppImages launch without `--no-sandbox`, render both production entries, and report sandboxed renderer processes.
- All six platform/architecture combinations produce their DMG/ZIP, portable EXE, and AppImage/DEB/RPM file names.

## GitHub Actions

The `Package` workflow runs manually through `workflow_dispatch` or when a `v*` tag is pushed. Tag names must exactly match `v${package.json.version}`. The workflow:

1. **Validates the source** on Ubuntu: runs tests, type checks, builds the application, then runs Electron end-to-end tests.
2. **Runs native shell smoke** on Windows, macOS, and Linux: cleanup contract tests first (`scripts/clean.test.ts`), then real Shell/PTY smoke tests.
3. **Packages all six combinations** on native runners: after `npm ci`, runs the database/PTY smoke test on the target architecture, then builds and packages. Windows jobs verify the final unpacked Console CLI with a real PowerShell stdin pipeline. Linux jobs first launch the generated AppImage, then install the generated DEB, and exercise both under Xvfb. The checks assert that neither the browser nor renderer process has `--no-sandbox`, both real production entries render without CSP violations, and renderer sandboxing remains enabled. AppImage, DEB, and RPM files are retained as workflow artifacts.

Node setup uses `node-version: 24` (satisfying `>=24.15.0 <25`, matching `.nvmrc`) for all orchestration. The host Node version is distinct from Electron's embedded Node 24. Packaging waits for both source validation and all three native smoke jobs.

The workflow does not create a GitHub Release.

## Signing

Packages are currently unsigned:

- macOS users may need to approve the application in Privacy & Security because it is not signed or notarized.
- Windows may display a SmartScreen warning because the executable has no trusted publisher signature.

Production distribution should add Apple Developer ID signing/notarization and a Windows code-signing certificate through encrypted CI secrets.

## Troubleshooting

- **Electron download fails**: check proxy/mirror/cache, run `npx install-electron --no` on a networked machine, then retry. Preserve the original error.
- **`node-pty` rebuild fails**: verify the C++20 toolchain (VS 2022 on Windows, current Xcode CLT on macOS, C++20 GCC/Clang on Linux), then run `npm run electron:rebuild`.
- **Native module `MODULE_NOT_FOUND` or ABI mismatch**: this is a release blocker. Fix the rebuild or `asarUnpack` configuration; never catch and degrade to an empty database or disabled terminal.
- **Linux sandbox preflight or AppImage launch fails**: follow the printed SUID helper commands for development, use a host policy that allows Chromium user namespaces, or install the DEB/RPM release. Ubuntu 23.10+ users should normally choose DEB rather than globally weakening AppArmor. Never add `--no-sandbox`.
- **`better-sqlite3` cannot open an existing database**: the application preserves the existing database and shows the error. It never deletes the target database on failure.
- **Clean fails on a locked file**: the script retries three times. If the file is still locked, the command fails so you do not package with mixed stale output.
- **Rollback**: the dependency upgrade (manifest, lockfile, Node/TypeScript/Vite/Vitest configuration, xterm 6 styles, tests, workflow, and this document) must be rolled back as one atomic generation — do not downgrade only React, Vite, Vitest, TypeScript, or xterm while keeping the newer configuration. Revert code and lockfile together, clean reproducible `dist/`, `.vite/`, `coverage/`, `release/`, `out/`, and `*.tsbuildinfo`, then run `npm ci` against the previous lockfile and re-run the old baseline `npm test`, `typecheck`, `build`, and shell-smoke. No database downgrade is needed because no schema migration is involved. Back up the user database before rolling back to avoid accidental loss.
