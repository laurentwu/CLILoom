# 终端环境设置与故障排查

CLILoom 在 Windows、macOS 和 Linux 上使用一个全局原生终端环境。新工作流会在启动时固定该目标，交互终端、非交互终端和节点 Hook 都继承同一快照；独立助手在下一次启动或重启时使用新设置。工作流命令不会在 Bash、PowerShell 和 cmd 之间自动翻译。

## 选择终端环境

在主窗口打开“设置 → 终端 Shell”：

- “自动推荐”会选择当前平台检测到的原生 Shell。
- 也可以从检测结果中固定选择一个原生 Shell。应用不接受手工输入的可执行文件路径。
- “重新检测终端环境”用于刷新 Shell 和 PATH。
- 修改设置不会迁移或终止已启动的工作流、Hook、终端或助手。

默认顺序如下：

| 平台 | 自动推荐顺序 |
| --- | --- |
| Windows | PowerShell 7 → Windows PowerShell → Command Prompt |
| macOS | zsh → 受支持的登录 Shell → sh |
| Linux | bash → 受支持的登录 Shell → sh |

原生环境支持 PowerShell 7、Windows PowerShell、cmd、sh、bash、zsh 和 Git for Windows 提供的 Git Bash，不支持任意自定义 Shell 路径。启动进程前会重新发现并核验已保存的目标；固定 Shell 被移动、替换或卸载时，CLILoom 会失败关闭，不会静默切换到其他 Shell。

新格式历史会话始终使用原会话保存的原生终端环境和实际工作目录重试；只有没有目标快照的旧格式会话才使用重试时的全局设置。

## 项目路径

通过主进程文件夹选择器添加项目。路径在存储前会规范化并确认是目录；工作流启动时会根据项目 ID 重新读取数据库路径并再次验证。普通 Windows 本地路径、普通网络 UNC 路径以及 macOS/Linux 绝对路径保持支持。

渲染层传入的路径不能替换数据库中的项目目录。相对路径、包含 NUL 的路径和不存在的目录会在启动任何工作流进程前被拒绝。

## 工作流命令与变量

`${variable}` 模板语法在所有受支持 Shell 中保持不变。CLILoom 会在启动前把变量值放入隔离的环境变量，再按所选 Shell 生成引用，避免把变量值直接拼入 Shell 源码。

一份工作流不保证能跨平台复用。例如，Bash 命令不会自动转换为 PowerShell 命令；工作流作者需要确保命令适合运行它的操作系统和全局终端环境。

cmd 使用延迟环境变量展开来隔离工作流值，因此有额外限制：

- 命令模板中的字面 `!` 和多行命令会在启动前被拒绝；建议改用 PowerShell。
- 命令模板中的 `%NAME%`（包括 `%NAME:...%` 修饰语）会被拒绝；工作流变量必须使用 CLILoom 的隔离绑定。
- 变量值不能包含 CR/LF 或 NUL。
- 完整 cmd 启动命令行、单个环境变量和环境块会在启动前进行长度检查。

变量值中的 `& | < > ^ % ! " ' ( )` 等字符不会作为新的命令源码执行。若需要复杂的 Windows 命令语法，优先选择 PowerShell。

## 终端环境不可用

如果固定选择的 Shell 被移动、卸载或失去执行权限：

1. 在主窗口打开“设置 → 终端 Shell”。
2. 点击“重新检测终端环境”。
3. 重新选择一个可用候选项，或切回“自动推荐”。

如果刚安装的 Shell 没有出现，请确认：

- Windows 的安装目录已加入 PATH；Git Bash 来自可验证的 Git for Windows 安装目录。
- macOS/Linux 的 Shell 文件存在、是普通文件且具有执行权限。
- 从桌面环境启动应用时，登录 Shell 能返回正确的 PATH；查询失败时 CLILoom 会保留 Electron 原始环境。

独立助手窗口的设置页会显示当前全局终端环境。`cliloom doctor` 也会报告应用构建 ID、助手工作区格式和同步状态，以及平台、选择模式、实际终端环境、路径和可用性，但不会输出助手桥接令牌。

## 开发验证

专用原生冒烟测试会使用真实 Shell、真实 PTY 和真实子进程：

```sh
npm run test:shell-smoke
```

GitHub Actions 会在 Windows、macOS 和 Linux 上分别运行该命令；全部通过后才会进入平台打包任务。Windows 还可运行 `npm run test:windows-cli-smoke`，验证原生 PowerShell 管道与 Console CLI。
