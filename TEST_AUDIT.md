# 全量测试质量审查台账（TEST_AUDIT）

本轮审查与整改基于 Plan.md 的目标与边界执行，并按 `CodeReview-Codex.md` 评审意见完成第二轮核验与修正：只修改测试、测试辅助代码、测试配置及 typecheck 入口；未修改 `src` 产品实现、产品接口、持久化格式、UI、文案或助手能力；未调整覆盖率阈值、测试框架版本、依赖或发布工作流；未提交任何变更；评审文件保留未删。

- 环境：Linux（本项目 E2E 支持的平台），Node 24.19.0，npm + package-lock（`npm ci`，正常执行安装脚本，未使用 `--ignore-scripts`；Electron 二进制与原生模块 better-sqlite3/node-pty 均通过既有入口重建）。
- 可用宿主能力：`dbus-run-session`、`xvfb-run`、`Xvfb`、`DISPLAY` 均存在；真实 D-Bus/Xvfb 子进程用例实际执行。
- 宿主环境注记：本会话持久 shell 后半段携带 `CLILOOM_INTERNAL_VALUE_0/1`（外部沙箱注入），已据此加固 shellSmoke 的绑定名断言（见 §2.2 R10）；该注入不影响其他用例（其余断言不依赖具体绑定索引）。
- macOS/Windows 专属用例在本环境未执行（见“剩余限制”）。

## 1. 审查方法与分类

- 逐文件静态复核（触发条件、隔离与清理、异步确定性、依赖与 mock、覆盖职责、检查入口），叠加实际运行（`npm test`、typecheck、build、E2E、shell smoke、覆盖率、顺序打乱）。
- 分类沿用 Plan.md 第 3 节：**已确认缺陷（已整改）**、**待验证风险（验证后修复或保留）**、**合理保留**、**无本轮问题证据**。“无本轮问题证据”表示完成了规定复核与运行，不是全面正确性证明。
- 台账登记维度（§6）：层次、主要行为与异步完成条件、共享状态/资源及其所有者、处置与验证依据。

## 2.1 已确认缺陷整改结果（F01–F14，第一轮）

| 编号 | 整改内容 | 验证证据 |
| --- | --- | --- |
| F01 | `scripts/playwrightElectron.test.ts` 的 `locates executables across every PATH entry` 重写：临时目录内创建两个 PATH 目录 + 受控可执行夹具（普通文件 chmod 0755，不指向宿主 /usr/bin，不启动），用 `path.delimiter` 组合 PATH；断言首目录优先命中精确路径、后目录命中、同名遮蔽、全部缺失为 null | 单文件运行通过；反证：将 `findExecutableOnPath` 对目标工具临时置 null，新断言失败（`expected null to be '/tmp/.../second-only...'`），已撤回 |
| F02 | `src/main/assistantCommandInput.test.ts` `keeps file access inside the workspace`：父目录与绝对路径目标均真实创建且内容唯一；提供合法读取正例；五类拒绝（`..` 遍历/绝对路径/目录/缺失文件/越界符号链接）分别断言具体原因；超限断言精确到 `File exceeds the N byte limit`；显式 `initMainI18n('en')` 固定主进程语言 | 单文件 6/6 通过；反证：把遍历断言换成 `/File not found/` 立即失败并给出真实原因，已撤回 |
| F03 | `src/shared/assistantCapabilities.test.ts`：`namedJsonBlock` 从生成文档定位命名示例区块并比对**完整序列化 JSON**（仅归一化换行缩进），区块查找限定在各自章节（处理 `disabledKeepsStrategy` 跨章节同名）；两个示例常量全量逐块断言 | 单文件 15/15 通过；反证：区块读取丢尾行（等价于保留左花括号但移除示例尾部）断言失败，已撤回 |
| F04 | `src/renderer/designer/DesignerNodeConfig.test.tsx`：split 网关用例参数化 en/zh，语言与查询一致；beforeEach/afterEach `await i18n.changeLanguage('en')`；交互/非交互终端共同字段参数化，保留独有配置与 cron 草稿隔离 | 8/8 通过；shuffle 种子运行通过 |
| F05 | 新增 `e2e/support/cspProbe.ts`（installCspProbe / monitorPage→disposer / assertNoCspViolations / ensureCspProbeCoverage / resetCspProbeFailures）：探针带安装标记与违规数组，缺失即失败；init script 覆盖后续导航；已加载首页在准备期做一次受控 reload；断言前不清空已捕获错误。三个生产入口 E2E 迁移 | E2E 全量 18 通过；application E2E 有界自检用例：删除标记后断言必 reject |
| F06 | `e2e/task-project-isolation.e2e.ts` 改 test-scoped：每用例独立数据根目录、项目目录、注册与任务数据；注册提取为夹具（dialog 替换 finally 恢复）；第二用例自行注册 Project A；同用例内 关闭→改库→重启 复用本用例数据 | 整改前单跑第二用例因 `E2E project A was not registered` 失败（复现证据）；整改后两用例各自单跑通过、两文件 `--repeat-each=3` 12/12 通过 |
| F07 | 全部 6 个 E2E 迁移到 `test-support/resources.ts` 清理栈：目录创建后立即 defer；Electron 句柄按次启动登记（闭包持有）；terminal-auto-retry 项目夹具目录纳入清理（基线运行后实测残留 `/tmp/cliloom-auto-retry-projects-*` 即缺陷证据，已清理）；terminal.e2e 剪贴板恢复经资源栈聚合（见 §2.2 R5） | 运行后 `find /tmp -name 'cliloom-*' -newermt <本轮开始>` 无新增残留 |
| F08 | 新增 `test-support/resources.ts`（defer/逆序 dispose/逐项 await/单项失败仍继续/带标签 AggregateError/幂等/dispose 后登记报错）+ `scripts/testResources.test.ts` 机制回归；`processRunner.test.ts`：createRunner 立即登记 db 与 runner，afterEach 统一 `killAll('interrupted')` 后按 `db.open` 关闭；`processRunner.pty.test.ts`：统一处置 helper（见 §2.2 R2）；`database.test.ts`：目录先登记、句柄后绑定、聚合清理（见 §2.2 R3） | 机制测试 6/6；processRunner 两文件、database 全部通过；残留检查通过 |
| F09 | `scripts/clean.test.ts`：6 处“链接创建失败即 return”改为模块级能力探测 + `it.skipIf`；`database.test.ts` 3 处 `win32` 早退改为 `it.skipIf` | Linux 实跑全部执行、0 静默跳过；Windows 上显示为 skip |
| F10 | launch plan 逻辑用例改用受控夹具（可执行 `dbus-run-session`/`xvfb-run`），断言精确路径与参数顺序；真实子进程用例保留真实工具，条件拆分为 dbus/xvfb/DISPLAY 分别判定 | 单文件 11/11 通过（真实子进程用例实际执行）；无 /usr/bin 符号链接依赖 |
| F11 | `App.test.tsx` 防抖用例：fake timers 下 299ms 未保存、300ms 阈值恰好一次及最终参数、再推进 5s 无重复；`workflowRuntimeService.test.ts`：`flushUntil`/`waitForAutoRetryPhase` 以持久化状态与 retry 调用数为终点，负向断言改为 `retryCalls` 计数（见 §2.2 R6） | App 69 用例、workflowRuntimeService 40 用例通过；shuffle 通过 |
| F12 | 新增 `tsconfig.scripts.json`（allowJs/checkJs:false/allowImportingTsExtensions:true/noEmit），纳入 `scripts/**/*.test.ts` 与 `test-support/**/*.ts`；typecheck 追加该配置 | `--listFilesOnly` 核实全部进入程序；暴露并修复 3 处 CJS 类导入类型错误；无 lock 变化 |
| F13 | `CronExpressionAssistantDialog.test.tsx`：记录 `scrollIntoView` 原始描述符并精确恢复（原先不存在则 delete）；`processTermination.test.ts`：process.kill spy 不透传真实系统调用，afterEach 统一恢复 | 两文件 20/20 通过 |
| F14 | 精简与覆盖映射见 §4 | 覆盖率对照见 §5 |

## 2.2 评审意见核验与处置（`CodeReview-Codex.md`，逐条）

| # | 意见摘要 | 核验结论 | 处置与验证 |
| --- | --- | --- | --- |
| R1 | playwrightElectron 非可执行文件检查在 Windows 必失败（X_OK=存在性） | **属实**（Node 文档确认） | 将该断言拆为 `it.runIf(process.platform !== 'win32')` 独立 POSIX 用例；跨平台 PATH 查找断言保留。单文件 12 用例通过 |
| R2 | pty.test teardown 只关库；中途失败后 5s 残留定时器抛 `database connection is not open` | **属实**（`SESSION_PERSIST_INTERVAL_MS=5000` 的 flushTimer 在 db 关闭后触发，`db.prepare` 在 try 外） | 新增 `disposeProcessRunnerFixtures`：先逐 runner `killAll('interrupted')`（结束会话=清空队列并清除定时器）再按 `db.open` 关库，错误带标签聚合；“不可杀 PTY”用例改为首次失败/后续确认的 terminateTree 夹具；新增回归用例 `disposes mid-flight fixtures without late flush errors`（中途失败状态→处置→断言 `hasActiveProcesses()` 为 false 且无 flush 报错）。反证：临时移除 killAll，回归用例失败（`expected true to be false`），已撤回。46/46 通过 |
| R3 | database.test 目录清理首项失败跳过其余并覆盖关闭错误 | **属实** | 清理提取为 `disposeDatabaseFixtures`：逐项 try/catch、AggregateError 聚合全部关闭与删除失败；新增回归用例：首个目录删除失败仍删除其余目录、错误可辨认（含目录标签）。35/35 通过 |
| R4 | workflowRuntimeService createDb 成功后才登记目录；teardown 无服务关闭且异常中断后续 | **属实** | createDb 改为先登记目录再开库；新增 `createService` 跟踪全部 39 个构造点并在 afterEach 先 `await service.shutdown()`（关库前），替身自动补全 `killAll`（Plan §7.1 要求）；关闭/删除逐项聚合。40/40 通过 |
| R5 | terminal.e2e 剪贴板空 catch 吞掉清理失败 | **属实** | 移除 try/catch：资源栈本身单项失败仍继续其余清理并聚合报告（`testResources.test.ts` 已固化该机制），剪贴板恢复失败不再被吞。全量 E2E 18 通过 |
| R6 | 取消/停止用例的“无重试”断言无效（检查普通函数 `.mock`） | **属实**（注入额外重试不失败） | 两处均改为推进完整 120s 窗口后断言 `retryCalls` 为 0（真实调用计数）。40/40 通过 |
| R7 | 以 transcript 中 `recovered` 计数证明只重试一次无效（retry 复用 session 并重写 transcript） | **属实**（processRunner 的 in-place retry 会重置 transcript） | 夹具命令改为每次执行追加一行到 `exec-log`（独立于 session/transcript 的持久执行记录）；断言初始失败 + 恢复重试恰好 2 行，transcript 仅作 `recovered` 可见性检查。terminal-auto-retry 单文件与 3 次重复通过 |
| R8 | ProjectRail 精简删除了“右键菜单不触发 onSelectProject”唯一断言 | **属实**（注入右键选中行为 8 用例仍过） | 恢复该断言（注册 onSelectProject spy，菜单打开后零调用）。8/8 通过 |
| R9 | 删除 quote/thematicBreak/table 插件断言后真实渲染无对应内容，覆盖不等价 | **属实**（夹具无 blockquote/table/thematic-break） | 恢复 quote/thematicBreak/table 三项装配断言（headings/lists/link 有真实渲染对应物，维持删除）。13 用例通过（两文件） |
| R10 | （复审运行中发现，非评审文件条目）shellSmoke 启动回显用例硬编码 `CLILOOM_INTERNAL_VALUE_1`，宿主环境携带保留名时索引漂移而失败 | **属实**（本会话 shell 后半段被外部注入 `CLILOOM_INTERNAL_VALUE_0/1`，复现失败） | 断言改为：执行命令仍携带某个 `CLILOOM_INTERNAL_VALUE_n` 中性绑定（原始值不内联）且不使用被保留的 `_0`（碰撞重命名路径确实触发）；有/无环境注入两种条件下均通过 |
| R11 | TEST_AUDIT 全量 E2E 计数错误（17→18、9→12），台账行缺少 Plan §3 维度 | **属实**（此前 9-passed 的 repeat 运行实为 12 总量 3 失败被 tail 截断，随后已修复并重跑；全量含新自检用例为 18） | 本版更正全部运行记录（§5），§6 台账逐文件补齐层次/行为与完成条件/共享状态与资源所有者/验证依据 |

**驳回说明**：本轮无驳回意见；9 条评审意见全部核验属实并采纳（R10 为复审中额外发现并修复）。

## 3. 风险池处置

| 风险池 | 处置 |
| --- | --- |
| 异常断言（11 文件 70 处无参数 toThrow） | 逐条复核。升级为稳定公开契约（AppError + `EXPRESSION_INVALID`/`WORKFLOW_INVALID` code、cron-parser 传播消息）的参数化池：`expression.test.ts`（3）、`terminalAutoRetry.test.ts`（10+1）、`workflow.test.ts`（13）。其余保留：均为“从有效夹具只改变待验证字段”的非法输入参数化，公开契约为“拒绝该非法形状”且触发路径明确，符合 Plan 6.2 保留条件 |
| 类型逃逸（16 文件 as never/as any） | 逐项复核：安全事件替身、故意非法输入、测试适配边界（ProcessRunner getWindow）均属合理保留；未新增全局 any |
| 语言状态（18 个 renderer 测试导入共享 i18n） | 本轮修改的文件统一显式设置/await 恢复；其余已有恢复模式，shuffle 种子运行未发现跨文件串扰证据 |
| 内部结构断言（className/classList/源码读取） | 逐条判定为真实契约保留：ProjectRail 标记点类名与截断布局、Xterm 滚动条几何、clean/packagingConfig/securityConfig 对打包产物与 CSP 的源级契约 |
| 资源（29 文件临时目录 + 数据库/进程/桥接/监听器/原型） | 修复见 F07/F08/F13 与 §2.2 R2–R5；其余文件复核为已有可靠 finally/afterEach，照常保留 |
| 时间性能（terminalStartupEcho 3 个 2 秒上限） | 保留（防算法退化职责）；原始条件通过；未改假时间、未放宽上限 |

## 4. 精简与覆盖映射（F14，按第 10 节验收）

1. **ProjectRail**：`railProps()` 工厂（`ComponentProps<typeof ProjectRail>`，每次新建数组/Set/回调/shellSnapshot），用例显式列出关键差异，rerender 复用本用例回调身份；全部 8 个行为用例保留（含 R8 恢复的右键零选中断言），仅准备代码去重。
2. **DesignerNodeConfig**：共同字段参数化，独有配置与 cron 草稿隔离保留；与 F04 合并完成；无断言删除。
3. **ReleaseNotesView**：mock 链接拦截 → 真实渲染 `prevents rendered links from navigating`（真实组件点击处理器）；remount 次数断言 → 真实渲染更新用例（本轮再补“旧内容消失”）；mock 测试保留编辑器配置、terminalMarkdown 装配、翻译回退、解析失败与恢复；headings/lists/link 插件纯调用次数删除（真实渲染有对应元素）；quote/thematicBreak/table 装配断言按 R9 恢复（真实渲染夹具无对应内容）。转换细节由 `releaseNotesMarkdown.test.ts` 保留。
4. **ProcessRunner**：两份最小 schema 提取到 `test-support/processRunnerDatabase.ts`；`database.test.ts` 真实迁移与 schema 契约未替代。
5. **E2E 监测与资源**：仅复用 `cspProbe.ts` 与 `resources.ts`；未建万能启动器。
6. **其他文件**：未发现满足“相同前提、相同行为、相同故障检测能力”的重复，未删除其他用例。

## 5. 运行证据

| 命令 | 结果 |
| --- | --- |
| 基线 `npm test`（HEAD） | 104 文件 / 1201 用例通过 |
| 基线 typecheck / build / `test:e2e`（HEAD） | 通过；E2E 17 用例通过（当时无自检用例） |
| 基线复现 F06 / F07 残留 | 第二用例单跑失败；`/tmp/cliloom-auto-retry-projects-*` 泄漏（证据已清理） |
| 反证检查（第一轮，临时替换后立即撤回） | ① PATH 置 null 失败；② 无关拒绝原因失败；③ 示例区块丢尾行失败；④ 探针标记缺失拒绝（application 自检用例固化）；⑤ 清理失败仍继续且聚合（机制测试固化）；⑥ R2 移除 killAll 后回归用例失败 |
| 整改后 `npm test`（两轮修改后最终） | **105 文件 / 1210 用例全部通过**（= 基线 1201 + 资源机制 6 + pty 处置回归 1 + database 处置回归 1 + PATH 用例拆分净增 1） |
| 整改后 `npm run typecheck` / `npm run build` | 通过（typecheck 含 scripts 配置） |
| `npm run test:e2e`（全量，最终） | **18 通过**（= 原 17 + application 探针自检用例） |
| `npm run test:e2e -- e2e/task-project-isolation.e2e.ts --grep "edits a failed workflow terminal command once through the real runtime chain"` | 1 通过（F06 独立性） |
| `npm run test:e2e -- e2e/task-project-isolation.e2e.ts e2e/terminal-auto-retry.e2e.ts --repeat-each=3`（最终，exec-log 证据版） | **12/12 通过**（4 用例 × 3） |
| 各顶层用例按名独立运行 | task-project-isolation 两用例、terminal-auto-retry 两用例均单独通过 |
| `npm run test:shell-smoke` | 7 通过 / 2 跳过（win32 专属，报告可辨认；Git Bash 缺失为带原因的 `context.skip`）；在携带与清除 `CLILOOM_INTERNAL_VALUE_*` 环境注入两种条件下均通过（R10） |
| 顺序打乱（共享状态文件） | `--sequence.shuffle --sequence.seed=20260922`，8 文件 153 用例通过（首轮无顺序问题，未用第二 seed） |
| `npm run test:coverage` | 主覆盖阶段 105 文件 1210 通过，指标 ≥ stash 基线（lines 78.56→78.58、statements 75.65→75.66、functions 68.75→68.79、branches 72.55→72.58；基线报告存于系统临时目录未提交）。**终端覆盖阶段在本轮与 HEAD 基线均以 branches 87.93% < 90% 失败（数字完全一致，XtermTerminal.tsx 83.41% 拖累）**——先于本轮存在的基线问题，按边界未改阈值，另案处理 |
| 中断说明 | 一次全量 E2E 因外部中断出现 `XIO: fatal IO error`（X 连接被杀）1 失败/17 通过，重跑 18/18 通过，判定为运行环境中断而非测试回归 |
| 运行后残留 | 本轮运行产生的临时目录/进程已全部清理；系统内既有他人/前次残留（Sep 21 及更早）与在运行的打包版进程不属于本轮资源，未触碰 |

## 6. 全量文件台账（112 个测试文件 + 3 个新增辅助）

列定义：**层次**（E2E=Playwright Electron / 脚本=Vitest 跑 scripts / 主进程、共享、渲染器=Vitest）；**主要行为与完成条件**（验证什么、等待什么）；**共享状态/资源（所有者）**；**处置与验证依据**。处置图例：修复=已确认缺陷整改；加固=风险修复；保留=复核通过照常保留；新增=本轮新增。

| 文件 | 层次 | 主要行为与完成条件 | 共享状态/资源（所有者） | 处置与验证依据 |
| --- | --- | --- | --- | --- |
| `e2e/application.e2e.ts` | E2E（生产入口，Linux） | 双入口加载无 CSP 违规（探针标记+违规数组断言）、探针自检（缺标记必拒绝）、窄列拖拽、菜单单行；等待 `#root` 渲染与几何断言 | 应用数据目录、Electron 句柄、探针监听器（资源栈，按次登记） | 修复 F05/F07；全量 E2E 通过 |
| `e2e/assistant-configuration.e2e.ts` | E2E（生产入口+真实桥接，Linux） | 助手全生命周期（schema/保存/脏守卫/设置同步/皮肤/重启）；job 结果以带上限的文件轮询等待 | 数据目录、夹具目录（jobs/results/bin）、应用句柄（资源栈） | 修复 F07；全量 E2E 通过 |
| `e2e/task-project-isolation.e2e.ts` | E2E（生产入口，Linux） | 项目隔离/未读清理、失败终端一次编辑重试链路（含重启恢复）；以 `expect.poll`+DB 状态为终点 | 每用例独立数据根/项目目录、句柄、监听器（资源栈；dialog 替换 finally 恢复） | 修复 F05/F06/F07；单用例与 3 次重复通过 |
| `e2e/terminal-auto-retry.e2e.ts` | E2E（生产入口，Linux） | 自动重试调度/取消/停止/重启恢复、开始时间显示与保留；DB 轮询为终点；“只执行一次”以 exec-log 恒久执行记录（2 行）举证（R7） | 每用例独立数据根/项目目录与 marker/exec-log（资源栈） | 修复 F05/F06/F07+R7；单文件与 3 次重复通过 |
| `e2e/terminal-startup-echo.e2e.ts` | E2E（生产入口+真实 PTY，Linux） | 启动回显单次呈现、重挂载一致；任务状态轮询+transcript/渲染文本断言 | 数据目录、项目/isolated-home 夹具、句柄（资源栈） | 修复 F07；全量 E2E 通过 |
| `e2e/terminal.e2e.ts` | E2E（harness 入口） | 复制/粘贴/Markdown 对话框/重试对话框/重排/分离挂载/滚动条几何；剪贴板恢复失败可报告（R5） | 应用数据目录、系统剪贴板（先恢复后关应用，均经资源栈） | 修复 F07+R5；全量 E2E 通过 |
| `scripts/clean.test.ts` | 脚本 | 清理范围/符号链接安全/参数拒绝/幂等；链接能力模块级探测 | 临时目录（tempRoots afterEach） | 修复 F09；纳入类型检查；53 用例（与 database 合跑）通过 |
| `scripts/generateBuildIdentity.test.ts` | 脚本 | 构建身份生成/缓存语义 | 临时目录（afterEach） | 保留；类型检查通过 |
| `scripts/linuxSandbox.test.ts` | 脚本 | AppImage 沙箱参数与 after-pack 链 | 临时目录/产物（afterEach） | 保留；类型检查通过 |
| `scripts/packagingAfterPack.test.ts` | 脚本 | after-pack 钩子文件操作契约 | 临时目录（afterEach） | 保留；类型检查通过 |
| `scripts/packagingConfig.test.ts` | 脚本 | 打包配置与产物声明（源级契约，产品契约一部分） | 只读仓库文件 | 保留；类型检查通过 |
| `scripts/playwrightElectron.test.ts` | 脚本 | PATH 查找（跨平台+POSIX 可执行位，R1）、launch plan 组装、真实子进程退出/信号链 | 临时 PATH 目录（afterAll）；真实子进程（用例内收尸） | 修复 F01/F10+R1；12 用例通过 |
| `scripts/releaseAssets.test.ts` | 脚本 | 发布清单/资产组装契约 | 临时目录（afterEach） | 保留；类型检查通过 |
| `scripts/securityConfig.test.ts` | 脚本 | CSP 严格性与开发放宽（源级契约） | 只读仓库文件 | 保留；类型检查通过（allowImportingTsExtensions） |
| `scripts/windowsConsoleLauncher.test.ts` | 脚本 | 原生启动器构建脚本契约（跨平台源级） | 只读仓库文件 | 保留；类型检查通过 |
| `scripts/testResources.test.ts` | 脚本（新增） | 清理栈机制：逆序/异步等待/单项失败仍继续/多错误可辨/幂等/dispose 后禁登记/非 Error 带标签 | 纯内存 | 新增；6/6 通过 |
| `src/main/applicationMenu.test.ts` | 主进程 | 菜单模板/角色 | 纯内存 | 保留；全量通过 |
| `src/main/assistantCli.test.ts` | 主进程 | CLI 参数解析（非法输入参数化） | 纯内存 | 保留；全量通过 |
| `src/main/assistantCommandBridge.test.ts` | 主进程 | 桥接握手/鉴权/正文限制 | 临时目录+服务（finally） | 保留；全量通过 |
| `src/main/assistantCommandHandler.test.ts` | 主进程 | 命令分派/错误码/exit code；`rejects.toThrow` 池为非法形状参数化 | 临时工作区（afterEach） | 保留（第 3 节）；全量通过 |
| `src/main/assistantCommandInput.test.ts` | 主进程 | 输入参数/stdin/文件路径拒绝原因；主进程 i18n 显式 en | 临时工作区（afterEach） | 修复 F02；6/6 通过 |
| `src/main/assistantTerminalService.test.ts` | 主进程 | 助手终端会话生命周期 | 内存对象 | 保留；全量通过 |
| `src/main/assistantWorkspace.test.ts` | 主进程 | 工作区布局/权限/链接拒绝；探测仅识别 EPERM/ENOSYS/EEXIST | 临时目录（afterEach） | 保留；全量通过 |
| `src/main/buildIdentity.test.ts` | 主进程 | 构建身份读取/校验 | 临时文件（afterEach） | 保留；全量通过 |
| `src/main/database.test.ts` | 主进程 | schema/迁移/项目/草稿/工作流/终端查询契约；处置 helper 逐项聚合（R3 回归） | 临时目录+数据库（先登记目录，`db.open` 判定清理） | 修复 F08/F09+R3；35/35 通过 |
| `src/main/databaseMaintenance.test.ts` | 主进程 | 维护任务裁剪/清理 | 临时目录（finally） | 保留；全量通过 |
| `src/main/electronRuntime.test.ts` | 主进程 | 运行时路径/环境解析 | 临时目录（afterEach） | 保留；全量通过 |
| `src/main/electronUpdaterAdapter.test.ts` | 主进程 | 更新事件适配 | 事件替身 | 保留；全量通过 |
| `src/main/executionInvocation.test.ts` | 主进程 | 执行调用组装 | 纯内存 | 保留；全量通过 |
| `src/main/idleMaintenanceScheduler.test.ts` | 主进程 | 空闲调度（fake timers 边界并恢复） | fake timers（用例内恢复） | 保留；全量通过 |
| `src/main/installedFonts.test.ts` | 主进程 | 字体列表 | 替身 | 保留；全量通过 |
| `src/main/instanceHandoff.test.ts` | 主进程 | 单实例接管/锁语义；链接探测合规 | 临时目录+锁文件（afterEach） | 保留；全量通过 |
| `src/main/instanceHandoffCoordinator.test.ts` | 主进程 | 接管协调 | 纯内存 | 保留；全量通过 |
| `src/main/processRunner.pty.test.ts` | 主进程（mock PTY） | PTY 输出/超时/终止/回显识别/平台捕获流；处置先 killAll 后关库（R2 回归） | 内存库+runner（统一登记）；mock 定时器用例内恢复 | 修复 F08/F14+R2；46/46 通过 |
| `src/main/processRunner.test.ts` | 主进程（真实 PTY） | 真实执行/绑定安全/重试语义；teardown killAll→关库 | 内存库+runner+真实进程（afterEach 统一） | 修复 F08/F14；61 用例（两文件合跑）通过 |
| `src/main/processTermination.test.ts` | 主进程 | 进程树终止语义（信号/所有权）；kill spy 不透传系统并可靠恢复 | process.kill spy（afterEach 恢复） | 修复 F13；通过 |
| `src/main/rendererDraftFlush.test.ts` | 主进程 | 渲染器草稿冲刷时序 | fake timers（恢复） | 保留；全量通过 |
| `src/main/runtimePersistence.test.ts` | 主进程 | 运行态持久化/恢复 | 临时目录（finally） | 保留；全量通过 |
| `src/main/runtimeStateStorage.test.ts` | 主进程 | 状态存储编码 | 内存对象 | 保留；全量通过 |
| `src/main/settingsService.test.ts` | 主进程 | 设置读写/广播/非法输入拒绝（含零广播副作用断言） | 临时目录+库（afterEach） | 保留（第 3 节）；全量通过 |
| `src/main/shellConfigurationService.test.ts` | 主进程 | Shell 配置持久化 | 临时目录（afterEach） | 保留；全量通过 |
| `src/main/shellEnvironment.test.ts` | 主进程 | 环境过滤/合并 | 临时目录 | 保留；全量通过 |
| `src/main/shellExecution.test.ts` | 主进程 | 命令渲染各 shell 家族 | 纯内存 | 保留；全量通过 |
| `src/main/shellService.test.ts` | 主进程 | Shell 发现/选择 | 环境替身 | 保留；全量通过 |
| `src/main/shellSmoke.test.ts` | 主进程（真实 Shell/PTY，专用命令） | 跨平台真实执行/桥接/启动回显；绑定名断言环境无关化（R10）；可选 Git Bash skip 带原因 | 临时目录/真实进程/launcher（用例内+afterEach） | 加固 8.3+R10；7 通过 2 平台跳过（两种环境条件） |
| `src/main/taskCleanup.test.ts` | 主进程 | 任务清理级联 | 临时库（finally） | 保留；全量通过 |
| `src/main/terminalAutoRetryScheduler.test.ts` | 主进程 | 到期调度 | fake timers（恢复） | 保留；全量通过 |
| `src/main/terminalSessionAccess.test.ts` | 主进程 | 会话访问隔离（明确触发路径） | 内存库 | 保留；全量通过 |
| `src/main/terminalStartupEcho.test.ts` | 主进程 | 回显识别纯逻辑（2s 防退化上限） | 纯内存 | 保留；全量通过 |
| `src/main/updateInstallCoordinator.test.ts` | 主进程 | 更新安装协调 | 替身 | 保留；全量通过 |
| `src/main/updateService.test.ts` | 主进程 | 更新检查/状态 | electron 替身 | 保留；全量通过 |
| `src/main/windowSecurity.test.ts` | 主进程 | 窗口安全（导航/新窗口阻断） | 安全替身 | 保留；全量通过 |
| `src/main/windowState.test.ts` | 主进程 | 窗口状态持久化 | 临时文件（afterEach） | 保留；全量通过 |
| `src/main/workflowConfigService.test.ts` | 主进程 | 工作流配置服务 | 临时目录（afterEach） | 保留；全量通过 |
| `src/main/workflowRuntimeService.test.ts` | 主进程 | 运行时编排/并行/自动重试/恢复；条件等待+`retryCalls` 终点；服务统一 shutdown 后关库（R4/R6） | 目录先登记+库+服务（afterEach 聚合） | 修复 F11+R4/R6；40/40 通过 |
| `src/main/workflowRuntimeService.timezone.test.ts` | 主进程 | 时区冻结语义 | 临时目录（afterEach） | 保留；全量通过 |
| `src/renderer/App.test.tsx` | 渲染器 | App 集成（项目/任务/草稿/防抖/更新）；防抖 fake timers 边界 | window API 替身（恢复）、fake timers（finally 恢复） | 修复 F11；69 用例+shuffle 通过 |
| `src/renderer/assistant/AssistantApp.test.tsx` | 渲染器 | 助手窗口集成 | window/i18n 状态（afterEach 恢复） | 保留；全量通过 |
| `src/renderer/clipboard.test.ts` | 渲染器 | 剪贴板工具 | navigator 替身（恢复） | 保留；全量通过 |
| `src/renderer/components/AppearancePanel.test.tsx` | 渲染器 | 外观面板 | window.cliLoom/scrollIntoView/ResizeObserver（descriptor 记录-恢复） | 保留；全量通过 |
| `src/renderer/components/NodeDetailPanel.test.tsx` | 渲染器 | 节点详情 | i18n 状态（恢复） | 保留；全量通过 |
| `src/renderer/components/NodeIcon.test.tsx` | 渲染器 | 节点图标 | 纯内存 | 保留；全量通过 |
| `src/renderer/components/ParallelBranchGroup.test.tsx` | 渲染器 | 并行分支组渲染/时序 | i18n（恢复） | 保留；全量通过 |
| `src/renderer/components/ProjectRail.test.tsx` | 渲染器 | 项目栏全行为（含右键零选中，R8 恢复） | i18n（设置/await 恢复）、dropdown/alert-dialog 替身 | 修复 F14+R8；8/8 通过 |
| `src/renderer/components/ReleaseNotesView.render.test.tsx` | 渲染器 | 真实渲染：HTML 惰性/链接拦截/内容更新（旧内容消失）/本地化标签 | i18n（恢复） | 修复 F14；通过 |
| `src/renderer/components/ReleaseNotesView.test.tsx` | 渲染器 | mock 编辑器配置/terminalMarkdown 装配/翻译回退/解析失败恢复；quote/thematicBreak/table 装配断言恢复（R9） | i18n（恢复）、vi.mock 模块级 | 修复 F14+R9；通过 |
| `src/renderer/components/StatusBadge.test.tsx` | 渲染器 | 状态徽标 | i18n（恢复） | 保留；全量通过 |
| `src/renderer/components/TaskSidebar.test.tsx` | 渲染器 | 侧栏行为与滚动安全区类名契约 | i18n（恢复） | 保留；全量通过 |
| `src/renderer/components/TerminalAutoRetryBanner.test.tsx` | 渲染器 | 重试横幅文案/时区渲染 | i18n/时间（恢复） | 保留；全量通过 |
| `src/renderer/components/TerminalContextMenu.test.tsx` | 渲染器 | 终端右键菜单 | i18n（恢复） | 保留；全量通过 |
| `src/renderer/components/TerminalMarkdownDialog.test.tsx` | 渲染器 | Markdown 对话框 | i18n（恢复） | 保留；全量通过 |
| `src/renderer/components/TerminalPane.interaction.test.tsx` | 渲染器 | 终端面板交互 | 事件替身 | 保留；全量通过 |
| `src/renderer/components/TerminalPane.test.tsx` | 渲染器 | 面板渲染类名契约 | i18n（恢复） | 保留；全量通过 |
| `src/renderer/components/XtermTerminal.test.tsx` | 渲染器 | xterm 封装（resize/focus/rAF） | stubGlobal/原型 spy（afterEach unstub/restore） | 保留；全量通过 |
| `src/renderer/components/ui/color-picker.test.ts` | 渲染器 | 取色器 | 纯内存 | 保留；全量通过 |
| `src/renderer/components/ui/dialog.test.tsx` | 渲染器 | 对话框可达性 | i18n/结构（恢复） | 保留；全量通过 |
| `src/renderer/components/ui/menu-layout.test.tsx` | 渲染器 | 菜单布局测量契约 | scrollIntoView 描述符记录-恢复 | 保留；全量通过 |
| `src/renderer/designer/CronExpressionAssistantDialog.test.tsx` | 渲染器 | cron 助手交互/预设/时区预览 | scrollIntoView 描述符（afterAll 精确恢复） | 修复 F13；通过 |
| `src/renderer/designer/DesignerFlowEdge.test.tsx` | 渲染器 | 流程边渲染 | 纯内存 | 保留；全量通过 |
| `src/renderer/designer/DesignerFlowNode.test.tsx` | 渲染器 | 流程节点渲染 | i18n（恢复） | 保留；全量通过 |
| `src/renderer/designer/DesignerInspector.test.tsx` | 渲染器 | 检查器 | i18n（恢复） | 保留；全量通过 |
| `src/renderer/designer/DesignerNodeConfig.test.tsx` | 渲染器 | 节点配置（en/zh 参数化、终端字段参数化、cron 草稿隔离） | i18n（beforeEach/afterEach await 恢复） | 修复 F04/F14；8/8 通过 |
| `src/renderer/designer/HookEditor.test.tsx` | 渲染器 | 钩子编辑器 | i18n（恢复） | 保留；全量通过 |
| `src/renderer/designer/TerminalAutoRetrySettings.test.tsx` | 渲染器 | 重试设置（禁用保留草稿并恢复启用断言） | i18n（await 恢复） | 加固；通过 |
| `src/renderer/designer/cronAssistant.test.ts` | 渲染器 | cron 反填纯逻辑 | 纯内存 | 保留；全量通过 |
| `src/renderer/designer/joinEdges.test.ts` | 渲染器 | join 边纯逻辑 | 纯内存 | 保留；全量通过 |
| `src/renderer/designer/layout.test.ts` | 渲染器 | 布局纯逻辑 | 纯内存 | 保留；全量通过 |
| `src/renderer/designer/snapping.test.ts` | 渲染器 | 吸附纯逻辑 | 纯内存 | 保留；全量通过 |
| `src/renderer/executionActions.test.ts` | 渲染器 | 执行动作纯逻辑 | 纯内存 | 保留；全量通过 |
| `src/renderer/fonts.test.ts` | 渲染器 | 字体加载 | 纯内存 | 保留；全量通过 |
| `src/renderer/projectTaskState.test.ts` | 渲染器 | 项目任务状态纯逻辑 | 纯内存 | 保留；全量通过 |
| `src/renderer/releaseNotesMarkdown.test.ts` | 渲染器 | HTML→Markdown 转换（细节责任层） | 纯内存 | 保留；全量通过 |
| `src/renderer/status.test.ts` | 渲染器 | 状态映射 | 纯内存 | 保留；全量通过 |
| `src/renderer/terminalMarkdown.test.tsx` | 渲染器 | 终端 Markdown 插件 | 纯内存 | 保留；全量通过 |
| `src/renderer/terminalText.test.ts` | 渲染器 | 终端文本处理 | 纯内存 | 保留；全量通过 |
| `src/renderer/theme.test.ts` | 渲染器 | 主题 CSS 合并契约 | 纯内存 | 保留；全量通过 |
| `src/renderer/utils.test.ts` | 渲染器 | 工具函数 | 纯内存 | 保留；全量通过 |
| `src/shared/assistant.test.ts` | 共享 | 助手协议/限制 | 纯内存 | 保留；全量通过 |
| `src/shared/assistantCapabilities.test.ts` | 共享 | 能力文档/schema 双语一致/示例完整区块 | 独立 i18n 实例（createI18n） | 修复 F03；15/15 通过 |
| `src/shared/cronSchedule.test.ts` | 共享 | cron 调度纯逻辑 | 纯内存 | 保留；全量通过 |
| `src/shared/expression.test.ts` | 共享 | 表达式引擎；拒绝路径断言 AppError+code | 纯内存 | 加固；通过 |
| `src/shared/i18n/i18n.test.ts` | 共享 | i18n 键一致/插值 | 独立实例 | 保留；全量通过 |
| `src/shared/projectPath.test.ts` | 共享 | 项目路径规范化 | 纯内存 | 保留；全量通过 |
| `src/shared/shell.test.ts` | 共享 | shell 命令结构纯逻辑 | 纯内存 | 保留；全量通过 |
| `src/shared/skin.test.ts` | 共享 | 皮肤校验/默认值 | 纯内存 | 保留；全量通过 |
| `src/shared/taskTitle.test.ts` | 共享 | 任务标题纯逻辑 | 纯内存 | 保留；全量通过 |
| `src/shared/terminalAutoRetry.test.ts` | 共享 | 重试配置/计划纯逻辑；拒绝路径 AppError+code | 纯内存 | 加固；通过 |
| `src/shared/terminalBuffer.test.ts` | 共享 | 缓冲上限纯逻辑 | 纯内存 | 保留；全量通过 |
| `src/shared/terminalRetry.test.ts` | 共享 | 重试语义纯逻辑 | 纯内存 | 保留；全量通过 |
| `src/shared/update.test.ts` | 共享 | 更新状态纯逻辑 | 纯内存 | 保留；全量通过 |
| `src/shared/workflow.test.ts` | 共享 | 工作流校验/绑定/示例；拒绝路径 AppError+code | 独立 i18n 实例 | 加固；通过 |
| `src/shared/workflowRuntime.test.ts` | 共享 | 运行时状态纯逻辑 | 纯内存 | 保留；全量通过 |

新增非测试辅助（不进入测试发现，不被产品模块导入）：`test-support/resources.ts`、`test-support/processRunnerDatabase.ts`、`e2e/support/cspProbe.ts`（仅 Playwright 使用，tsconfig.e2e.json 覆盖其类型检查）。

## 7. 剩余限制与未验证项

1. **终端覆盖率门槛失败为基线问题**：终端阶段（branches 90% 门槛）在本轮与 HEAD 基线均以 87.93% 失败且数字一致（`XtermTerminal.tsx` 83.41% 拖累）；按边界未改阈值、未加凑数测试，视为既有问题另案处理；主覆盖阶段通过且各指标不低于基线。
2. **macOS/Windows 专属验证未执行**：`shellSmoke.test.ts` 的 win32 用例、`test:windows-cli-smoke`、原生 launcher 真机构建需真实平台；相关用例以可辨认的 skip 呈现，不冒充通过。
3. **顺序打乱仅单 seed**：首轮（20260922）未发现顺序问题，未追加第二 seed。
4. 参数化用例数以运行器统计为准（最终 1210 = 基线 1201 + 新增 6+1+1 + 拆分净增 1，评审轮后总数 1210）。
5. 覆盖率基线报告与诊断文件保存在系统临时目录（`/tmp/opencode/`），未提交；`test-results/`、`coverage/`、`playwright-report/` 为生成物，未提交。
