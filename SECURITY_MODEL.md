# CLILoom security model

CLILoom is a local desktop workflow runner for a single interactive operating-system user. Its security controls reduce the impact of untrusted web content reaching an Electron renderer; they do not turn terminal commands or AI command-line tools into sandboxed workloads.

## Trust boundaries

- Production renderer windows load only packaged application files. Development windows accept only the fixed HTTP origin on `127.0.0.1` configured by the repository launcher.
- Renderer processes use Chromium sandboxing, context isolation, no Node.js integration, a restrictive Content Security Policy, blocked navigation/new-window creation, and a small preload API.
- Linux DEB/RPM releases install a `chrome-sandbox` helper that is root-owned with mode `4755`. A SUID helper cannot elevate from an AppImage mount, so the portable launcher explicitly disables only the unusable setuid sandbox and requires Chromium's primary user-namespace sandbox. CLILoom never falls back to `--no-sandbox`; the AppImage fails closed when local policy prevents it from creating the required namespace. Ubuntu 23.10 and newer apply that restriction to downloaded applications by default, so users should install the DEB package unless they deliberately provide an AppArmor policy for the AppImage.
- Main-process IPC accepts messages only from the expected window's current main frame at its fixed document URL. Permission requests are denied by default; only clipboard read and sanitized clipboard write are allowed for a trusted main document.
- Project directories are authorized by a main-process folder dialog, canonicalized, checked as directories, and stored before use. Workflow start accepts the project id as identity and re-reads the database path; a renderer-provided path cannot replace the execution directory. WSL UNC paths are also checked against the selected distribution with a controlled `wslpath` round-trip.
- The Electron renderer boundary protects privileged application APIs from web content. It does not protect the user from commands they configure and run.

## Commands and assistant tools

Workflow terminal nodes, hooks, retries, interactive terminals, and the assistant initialization command intentionally execute local programs with the same operating-system account and filesystem access as CLILoom. They are not placed in a container, virtual machine, restricted user account, or filesystem/network sandbox. Chromium's renderer sandbox does not apply to these child processes.

On Windows, a selected WSL target runs with that distribution's regular default user. WSL is an execution environment, not a CLILoom security sandbox: Linux commands may access mounted Windows files, distribution files, the network, and any other resources available to that user. CLILoom never elevates with `sudo`, switches to root, installs packages, or changes WSL configuration.

Treat every workflow, imported workflow definition, pasted command, project directory, shell initialization file, and assistant CLI configuration as executable input. Review them before running. Third-party CLIs can read files available to your user, modify projects, start processes, and access the network according to their own behavior and configuration.

## Local data and plaintext storage

CLILoom stores application state in a SQLite database under the operating system's per-user application-data directory:

- Windows: `%APPDATA%\CLILoom`
- macOS: `~/Library/Application Support/CLILoom`
- Linux: normally `~/.config/CLILoom`

The database and its SQLite journal/WAL files are **not encrypted by CLILoom**. Depending on use, plaintext records can include project paths, task titles and variables, workflow definitions and commands, configured working directories and environment values, assistant initialization commands, settings, terminal transcripts, command output, and runtime error details. Exported skins and files created by commands are also plaintext at their chosen locations.

On POSIX systems, CLILoom creates or repairs the application-data directory to mode `0700` and the main database plus SQLite journal/WAL/shared-memory files to mode `0600`. On Windows, access is governed by the ACL inherited from the user's application-data directory. These controls help separate normal local accounts, but they do not protect against administrators/root, malware running as the same user, exposed backups, or offline access to an unencrypted disk.

Use full-disk encryption and an appropriate backup policy on devices that handle sensitive data. Prefer the credential store provided by an AI CLI or the operating system instead of placing long-lived secrets directly in workflow definitions, command arguments, or persisted environment values. Remember that a tool can echo credentials into a retained terminal transcript even when the credential originated elsewhere.

For WSL execution, CLILoom passes only explicit workflow overrides, isolated variable bindings, and short-lived session metadata through staged per-process `WSLENV` names. User `PATH`, `HOME`, and `XDG_RUNTIME_DIR` overrides are applied only inside the login-shell child, after the trusted scope/marker helpers have started; they cannot redirect the marker or helper lookup. Environment values remain literal and are not inserted into the fixed wrapper command line, but configured values may still be retained in the plaintext database as described above.

The WSL assistant bridge remains bound to Windows `127.0.0.1`. Its random token and port travel through the assistant process environment across WSL interop; the generated shim contains no token, and closing the bridge revokes it. CLILoom does not expose the bridge on a LAN interface to work around WSL networking or disabled interop.

Each WSL process launch uses a private session UUID, a systemd user scope/cgroup, and a Linux marker containing the unit, cgroup, leader identity, and `/proc` start time. Clearing the environment or creating another Linux session does not escape the cgroup. Cleanup checks distribution running state first, terminates and confirms every member of only that cgroup, and only then ends the host proxy. Stale markers are inspected and safely cleaned during the next uncached target validation. CLILoom does not call `wsl --terminate` or `wsl --shutdown`; if cgroup identity or cleanup cannot be proven, it reports failure rather than widening the kill scope or claiming success.

## Retention and deletion

Project, task, workflow, and terminal history remains in the local database until the application removes it or the user deletes the application-data directory. Normal row deletion is not a cryptographic erase: SQLite free pages, WAL files, filesystem snapshots, and backups may retain prior bytes.

To remove all CLILoom application state, quit CLILoom and delete the platform-specific `CLILoom` application-data directory listed above. This does not delete project directories or files created outside that directory. If secure erasure is required, also follow the operating system, storage device, synchronization service, and backup provider procedures.

## Assumptions and limits

The model assumes the installed CLILoom package and its dependencies are authentic, the operating system is maintained, and the current user account is trusted. It does not defend against a compromised main process, a compromised operating system, malicious native dependencies, hostile commands approved by the user, or physical/offline attacks without platform encryption.
