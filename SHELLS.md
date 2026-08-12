# 终端环境设置与故障排查

CLILoom 在 Windows、macOS 和 Linux 上使用一个全局终端环境设置。新工作流会在启动时固定该目标，交互终端、非交互终端和节点 Hook 都继承同一快照；独立助手在下一次启动或重启时使用新设置。工作流命令不会在 Bash、PowerShell、cmd 和 WSL 之间自动翻译。

## 选择终端环境

在主窗口打开“设置 → 默认终端环境”：

- “自动推荐”会选择当前平台检测到的原生 Shell。在 Windows 上，自动模式不会选择 WSL。
- 也可以从检测结果中固定选择一个原生 Shell；Windows 上还可显式选择具体 WSL 发行版。应用不接受手工输入的可执行文件或发行版名称。
- “重新检测终端环境”用于刷新 Shell、PATH 和已注册 WSL 发行版。
- 修改设置不会迁移或终止已启动的工作流、Hook、终端或助手。

默认顺序如下：

| 平台 | 自动推荐顺序 |
| --- | --- |
| Windows | PowerShell 7 → Windows PowerShell → Command Prompt |
| macOS | zsh → 受支持的登录 Shell → sh |
| Linux | bash → 受支持的登录 Shell → sh |

原生环境支持 PowerShell 7、Windows PowerShell、cmd、sh、bash、zsh 和 Git for Windows 提供的 Git Bash，不支持任意自定义 Shell 路径。Windows WSL 目标支持发行版自身配置的 bash、zsh 或 sh 默认登录 Shell；fish、nushell、csh/tcsh、缺失或不可执行的默认 Shell 会阻止启动，CLILoom 不会改用 `/bin/sh` 或其他发行版。

新格式历史会话始终使用原会话保存的终端环境和实际工作目录重试；只有没有目标快照的旧格式会话才使用重试时的全局设置。

## Windows WSL

选择 WSL 发行版后，节点命令直接填写 `npm test`、`bash script.sh` 等 Linux 命令，不要再添加 `wsl` 或 `wsl -d`。CLILoom 会验证可信的 Windows 系统 `wsl.exe` 入口、具体发行版、普通默认用户、登录 Shell、路径转换、`WSLENV` 传输和会话级终止能力。可靠终止使用 systemd 用户 scope 与 cgroup v2；发行版必须启用可用的 systemd 用户管理器，CLILoom 不会代为修改 `/etc/wsl.conf`、安装 systemd 或提权。发行版被注销或能力验证失败时会明确报错，不会静默回退到 PowerShell、cmd、Git Bash 或另一个发行版。

添加项目时可分别选择：

- “选择 Windows 文件夹”：盘符目录会通过目标发行版的 `wslpath` 转换，不假设固定挂载点。
- “选择 WSL 文件夹”：从当前发行版的主目录打开选择器，接受当前系统实际提供的 `\\wsl$` 或 `\\wsl.localhost` 形式，并通过 Linux → Windows round-trip 校验。

普通网络 UNC、相对工作目录和属于另一发行版的 UNC 会被拒绝。`${sys_project_dir}`、节点 `cwd` 和 Hook `cwd` 在执行前转换为 Linux 路径；命令中的其他字面路径和普通环境变量不会被猜测或改写。Linux 工具大量访问文件时，建议把仓库放在 WSL 原生文件系统；Windows 工具为主时可继续使用盘符目录。

验证 WSL 目标时，CLILoom 会通过发行版的交互登录 Shell 读取有效 `PATH`，按首次出现顺序去重，再把它用于工作流、Hook 和助手会话。因此通过 nvm、`~/.local/bin`、`~/bin` 或发行版配置加入的 Linux 命令可直接执行；节点显式配置的 `PATH` 仍优先覆盖该值。传入 Linux Shell 的 `PATH` 不会通过 `WSLENV` 反向覆盖 Win32 子进程的 Windows `Path`；如果默认捕获值会让 Windows 环境块超限，会话会保留 WSL 生成的初始 `PATH`，不会改用 helper 的固定路径。systemd scope、能力探针和会话清理不会使用用户 `PATH`，而是继续使用固定的系统工具路径，避免用户配置影响进程边界。修改 WSL Shell 启动文件后，使用“重新检测终端环境”刷新缓存。

WSL 中的 AI CLI 必须真正安装在所选发行版的 Linux 文件系统，不能只命中 Windows PATH、`.cmd`/`.bat` shim 或 PE 可执行文件。助手通过一个不含令牌的 WSL shim 调用 Windows 主应用，bridge 仍只监听 Windows `127.0.0.1`。WSL interop 被禁用时，助手会停止启动并显示错误。

停止、超时、正常/非零退出和应用关闭会先清空该次 CLILoom systemd scope 的 cgroup，再清理宿主 `wsl.exe` 代理；即使后代清空环境并创建新 session，也仍留在该边界内。遗留 marker 会在下一次目标验证时按 scope、leader PID 与 `/proc` starttime 清理。CLILoom 不调用 `wsl --terminate` 或 `wsl --shutdown`，不会关闭整个发行版。

## 工作流命令与变量

`${variable}` 模板语法在所有受支持 Shell 中保持不变。CLILoom 会在启动前把变量值放入隔离的环境变量，再按所选 Shell 生成引用，避免把变量值直接拼入 Shell 源码。

一份工作流不保证能跨平台复用。例如，Bash 命令不会自动转换为 PowerShell 命令；工作流作者需要确保命令适合运行它的操作系统和全局终端环境。

cmd 使用延迟环境变量展开来隔离工作流值，因此有额外限制：

- 命令模板中的字面 `!` 和多行命令会在启动前被拒绝；建议改用 PowerShell。
- 命令模板中的 `%NAME%`（包括 `%NAME:...%` 修饰语）会被拒绝，避免继承或请求环境值重新进入命令解析；工作流变量必须使用 CLILoom 的隔离绑定。
- 变量值不能包含 CR/LF 或 NUL。
- 完整 cmd 启动命令行（含可执行文件和 `/d /v:on /s /c` 包装）、单个环境变量和环境块会在启动前进行长度检查。

变量值中的 `& | < > ^ % ! " ' ( )` 等字符不会作为新的命令源码执行。若需要复杂的 Windows 命令语法，优先选择 PowerShell。

## 终端环境不可用

如果固定选择的 Shell 被移动、卸载或失去执行权限，CLILoom 会保留原选择及路径、阻止新进程启动，并且不会静默切换到其他 Shell。处理方法：

1. 在主窗口打开“设置 → 默认终端环境”。
2. 点击“重新检测终端环境”。
3. 重新选择一个可用候选项，或切回“自动推荐”。

如果刚安装的 Shell 没有出现，请确认：

- Windows 的安装目录已加入 PATH；Git Bash 来自可验证的 Git for Windows 安装目录。
- WSL 已由 Windows 正常安装、至少注册了一个发行版，且所选发行版可由其普通默认用户启动。
- WSL 的默认登录 Shell 是可执行的 bash、zsh 或 sh；路径所属发行版与当前选择一致。
- macOS/Linux 的 shell 文件存在、是普通文件且具有执行权限。
- 从桌面环境启动应用时，登录 Shell 能返回正确的 PATH；查询失败时 CLILoom 会保留 Electron 原始环境。

独立助手窗口的设置页会显示当前全局终端环境。`cliloom doctor` 也会报告应用构建 ID、助手工作区格式和同步状态，以及平台、选择模式、实际终端环境、路径和可用性，但不会输出助手桥接令牌。

Windows 便携版启动另一份不同构建时会请求安全切换，并在确认后保留用户数据、同步助手工作区。首次从尚未实现该交接协议的旧包升级时，旧进程无法理解切换请求，仍需先完整退出一次；此后的便携包替换可自动交接。

## 开发验证

专用原生冒烟测试会使用真实 Shell、真实 PTY 和真实子进程：

```sh
npm run test:shell-smoke
```

GitHub Actions 会在 Windows、macOS 和 Linux 上分别运行该命令；全部通过后才会进入平台打包任务。

真实 WSL 验证必须在 Windows 主机上另行运行；非 Windows 只会明确报告跳过，不代表验证通过：

```powershell
$env:CLILOOM_WSL_DISTRO = 'Ubuntu'
# 可选：验证发行版内实际安装的助手 CLI
$env:CLILOOM_WSL_ASSISTANT_COMMAND = 'codex'
npm run test:wsl-smoke
```

该命令记录发行版、WSL 版本、架构、默认登录 Shell 及宿主/目标项目路径，并通过实际 `node-pty`/`ProcessRunner` 验证真实路径转换、字面环境传输、helper 环境隔离、Windows interop、Hook、历史重试、超时、立即停止和 `killAll`，以及清空环境并创建新 Linux session 后仍受 cgroup 约束的会话级终止、leader 异常退出后的下次验证清理。
