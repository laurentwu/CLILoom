<p align="center">
  <img src="docs/images/cliloom-brand-lockup.png" width="560" alt="CLILoom">
</p>

<p align="center">
  <strong>English</strong> | <a href="README.zh-CN.md">简体中文</a>
</p>

## 1. Overview

CLILoom is a cross-platform desktop app for visually orchestrating, running, and managing AI CLI development tasks.

## 2. Why CLILoom

- **Visual workflows:** Clearly arrange commands, conditions, and parallel tasks, then reuse them.
- **Natural-language workflow customization:** Tell your AI CLI assistant what you need to easily create or adjust your own workflow.
- **Parallel real terminals:** View live terminal output from multiple parallel branches on one page.
- **Automation with human input:** Run commands automatically, then provide input or enter an interactive terminal when needed.
- **Full task context:** Retain workflow versions, runtime status, terminal sessions, and historical output.
- **Your preferred AI CLI:** Launch Codex and other installed CLI assistants with a custom command.
- **Cross-platform, local storage:** Use macOS, Windows, or Linux while keeping workspace data on your machine.

## 3. Interface Preview

### Main workspace

![CLILoom main workspace showing projects, task history, and a visual workflow](docs/images/en/main-workspace.png)

Manage projects, previous tasks, workflow execution, and terminal output from one workspace.

### Workflow designer

![CLILoom workflow designer with a parallel quality-check workflow](docs/images/en/workflow-designer.png)

Build reusable workflows by arranging nodes, connecting paths, and editing execution settings.

### AI CLI assistant

![CLILoom assistant CLI configuration window](docs/images/en/assistant.png)

Configure your preferred AI CLI and run it in a dedicated interactive terminal window.

## 4. Features

- **Visual workflow designer**
  - Create, copy, edit, and automatically arrange workflows.
  - Drag nodes onto the canvas, connect paths, and validate configurations before saving.

- **Purpose-built node types**
  - Start, end, manual input, interactive terminal, and non-interactive terminal nodes.
  - Exclusive gateways for conditional routing and parallel gateways for concurrent branches and joins.

- **Real terminal execution**
  - Interactive PTY sessions with keyboard input and responsive resizing.
  - Per-node working directories, environment variables, timeouts, and accepted exit codes.
  - Persisted terminal output and safe retries for historical commands.
  - Native-shell target snapshots shared by terminals, hooks, retries, and the AI CLI assistant.

- **Variables and hooks**
  - Text and number variables with labels, defaults, ordering, and required rules.
  - Consistent `${variable}` bindings across supported shells without directly concatenating values into shell source.
  - Start and end hooks with configurable failure behavior.

- **Traceable projects and tasks**
  - Project-specific default workflows and retained task history.
  - Persisted workflow versions, task status, terminal sessions, and runtime state.

- **Configurable AI CLI assistant**
  - Validate and launch a custom initialization command.
  - Start, stop, and restart the assistant in its own terminal window.
  - Share shell, language, and appearance settings with the main application.

- **Cross-platform and customizable**
  - Build targets for macOS, Windows, and glibc-based Linux on x64 and ARM64.
  - English and Simplified Chinese interfaces.
  - Built-in light and dark themes plus custom skin import and export.

## 5. Download and Installation

Use the stable [latest GitHub Release](https://github.com/laurentwu/CLILoom/releases/latest) page to check for published installers. If GitHub reports that no release exists, installation packages are not currently available.

| Operating system | Architecture | Package formats | Release page |
| --- | --- | --- | --- |
| macOS | Apple Silicon | DMG, ZIP | [Check latest release](https://github.com/laurentwu/CLILoom/releases/latest) |
| macOS | Intel | DMG, ZIP | [Check latest release](https://github.com/laurentwu/CLILoom/releases/latest) |
| Windows | ARM64 | Installer, portable EXE | [Check latest release](https://github.com/laurentwu/CLILoom/releases/latest) |
| Windows | x64 | Installer, portable EXE | [Check latest release](https://github.com/laurentwu/CLILoom/releases/latest) |
| Linux | ARM64 | AppImage, DEB, RPM | [Check latest release](https://github.com/laurentwu/CLILoom/releases/latest) |
| Linux | x64 | AppImage, DEB, RPM | [Check latest release](https://github.com/laurentwu/CLILoom/releases/latest) |

CLILoom checks for updates only when you choose **Settings → Check for updates**; it never checks automatically at startup or in the background. Windows installer and Linux AppImage builds download a discovered update and wait for you to confirm **Restart and update**. Windows Portable, macOS, DEB, and RPM builds instead open the corresponding GitHub Release for manual installation. A Windows installation made available to all users may show a Windows UAC prompt when an explicitly confirmed update starts; current-user installations do not require elevation. CLILoom never runs a system package manager for an update.

### macOS

Download the DMG, open it, and drag CLILoom into the Applications folder. The ZIP package can be extracted and moved manually instead.

CLILoom release builds are currently not Apple-signed or notarized. On first launch, macOS may require approval under **System Settings → Privacy & Security**. macOS 12 Monterey or newer is required.

### Windows

The installer opens a guided setup. It defaults to the current user, while an all-users installation is also available and requires Windows administrator approval. You can choose the installation directory and whether to create a desktop shortcut; a Start menu shortcut is always created. The final page lets you choose whether to launch CLILoom immediately. Use the portable EXE instead to run CLILoom without installing it.

Windows release builds are currently unsigned, so Microsoft Defender SmartScreen may display an unknown-publisher warning. Confirm that the file came from the CLILoom GitHub Releases page before continuing.

### Linux

Choose the package for your distribution:

```sh
# Portable AppImage
chmod +x ./CLILoom-*.AppImage
./CLILoom-*.AppImage

# Debian or Ubuntu
sudo apt install ./CLILoom-*.deb

# Fedora or another RPM-based distribution
sudo dnf install ./CLILoom-*.rpm
```

Linux packages require glibc; Ubuntu 24.04 or an equivalent environment is recommended. Alpine Linux and other musl-based distributions are not supported. The AppImage is portable and requires the host to permit Chromium's user-namespace sandbox. Ubuntu 23.10 and newer block that capability for downloaded applications by default; use the DEB package there unless you have explicitly configured an AppArmor policy for the AppImage. DEB and RPM install Electron's root-owned SUID sandbox helper. CLILoom never falls back to `--no-sandbox`.

## 6. Security and local data

CLILoom intentionally executes workflow commands and configured assistant CLIs with your operating-system account. Those processes are not contained by the Electron renderer sandbox. The local SQLite database is not application-encrypted and can retain commands, variables, configured environment values, and terminal transcripts in plaintext.

Review executable inputs before running them, avoid placing long-lived credentials directly in persisted workflows, and use full-disk encryption when the device handles sensitive data. See the [security model](SECURITY_MODEL.md) for trust boundaries, local-data permissions, retention, and deletion guidance.

## Friendly Links

- [LINUX DO](https://linux.do/)
