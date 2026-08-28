export default {
  common: {
    app: {
      name: 'CLILoom'
    },
    action: {
      cancel: '取消',
      delete: '删除',
      save: '保存',
      confirm: '确认',
      close: '关闭',
      copy: '复制',
      paste: '粘贴',
      retry: '重试',
      stop: '停止',
      add: '添加',
      rename: '重命名',
      ok: '确定',
      run: '运行',
      continue: '继续',
      switchAndRestart: '切换并重启'
    },
    instanceHandoff: {
      title: '切换到另一个 CLILoom 构建？',
      message: '检测到你启动了另一个 CLILoom 便携版构建。',
      detail: '当前构建：{{current}}\n待切换构建：{{incoming}}\n\n确认后会先安全停止当前工作流和助手，再启动刚刚打开的便携版。助手目录和用户数据会保留并自动同步。',
      unavailableTitle: '检测到另一个 CLILoom 构建',
      unavailableMessage: '无法自动切换到刚刚启动的应用。',
      unavailableDetail: '目标构建：{{incoming}}\n\n请先退出当前 CLILoom，再重新打开目标应用。',
      launchFailedTitle: '无法启动新的 CLILoom 构建',
      launchFailedMessage: '当前应用已安全停止，但目标便携版未能启动。请手动重新打开它。\n\n{{detail}}'
    },
    status: {
      failed: '失败',
      running: '运行中',
      completed: '已完成',
      unsaved: '未保存'
    },
    aria: {
      resizeProjectRail: '调整项目栏宽度',
      resizeTaskSidebar: '调整任务栏宽度'
    },
    empty: {
      noData: '暂无数据'
    }
  },
  errors: {
    exit: {
      unsafeTitle: 'CLILoom 无法安全退出',
      unsafeMessage: '仍有子进程未能确认终止，请处理后重试。\n\n{{detail}}',
      treesNotTerminated: '{{count}} 个进程树未能确认终止'
    },
    update: {
      installUnavailable: '更新尚未准备好安装。',
      installCoordinationFailed: 'CLILoom 尝试安全清理后仍无法启动更新。应用将保持打开，请处理仍在运行的进程后重试。'
    },
    startup: {
      failedTitle: 'CLILoom 启动失败'
    },
    session: {
      invalidId: '终端会话 ID 无效',
      notReady: '终端会话尚未就绪，无法停止当前进程',
      notFound: '终端会话不存在',
      stillRunning: '终端仍在运行，无法重试',
      neutralCommandInvalid: 'Shell 中立命令格式无效',
      commandContainsNul: '终端命令不能包含 NUL 字符',
      historyInvalid: '历史终端记录格式无效，请重新运行工作流',
      retryDataInvalid: '终端重试数据无效，请重新运行工作流',
      executionTargetUnsupported: '该历史执行目标已不再受支持，无法重试',
      retryCommandInvalid: '终端重试命令无效，请重新运行工作流',
      retryReadFailed: '无法读取历史终端重试数据，请重新运行工作流',
      retryBindingMissing: '历史终端变量绑定缺失，无法安全重试，请重新运行工作流',
      retryBindingIncomplete: '历史终端变量绑定不完整，无法安全重试，请重新运行工作流',
      retryBindingUnmatched: '历史终端包含无法关联的变量绑定，无法安全重试，请重新运行工作流',
      retryEnvInvalid: '终端重试环境无效，请重新运行工作流',
      retryParamsInvalid: '终端重试参数无效，请重新运行工作流'
    },
    assistant: {
      invalidAction: '助手设置操作无效',
      missingInitCommand: '请先配置初始化命令'
    },
    sender: {
      mainInvalid: '主窗口 sender 无效',
      assistantInvalid: '助手窗口 sender 无效',
      settingsInvalid: '设置窗口 sender 无效'
    },
    appearance: {
      unsupportedSkin: '不支持的主题',
      unsupportedLanguage: '不支持的界面语言'
    },
    windowState: {
      mainInvalid: '主窗口状态无效',
      assistantInvalid: '助手窗口状态无效'
    },
    publicSetting: {
      inaccessible: '设置项不存在或不允许访问',
      notMutable: '设置项不存在或不允许修改',
      valueMustBeString: '设置值必须是字符串'
    },
    workflow: {
      revisionMissing: '缺少工作流修订号，请刷新后重试',
      saveNoResult: '保存工作流时未返回结果'
    },
    shell: {
      invalidSelection: 'Shell 选择无效',
      mustBeDetected: '只能选择当前检测到且受支持的 Shell',
      noneDetectedPlatform: '当前平台 {{platform}} 未检测到受支持的 Shell，请安装后重新检测',
      noneDetectedPlatformShort: '当前平台 {{platform}} 未检测到受支持的 Shell',
      unavailable: '所选 Shell 不可用：{{name}} ({{path}})，请重新检测或选择其他 Shell',
      unavailableShort: '所选 Shell 不可用：{{name}} ({{path}})',
      stageParse: '解析',
      stageDetect: '检测',
      stageStart: '启动',
      stageWrite: '写入',
      unparsed: '未解析',
      stageFailed: '平台 {{platform}}，Shell {{shell}}，{{stage}}阶段失败：{{detail}}。请重新检测 Shell 或在设置中选择其他 Shell',
      neutralInvalid: 'Shell 中立命令格式无效',
      invalidBindingName: 'Shell 绑定名称无效',
      nulInValue: '工作流变量不能包含 NUL 字符',
      envNulOrEquals: '环境变量名称和值不能包含 NUL，名称不能包含等号',
      invalidSegment: 'Shell 命令片段无效',
      commandNul: '终端命令不能包含 NUL 字符',
      invalidBindingSegment: 'Shell 命令绑定片段无效',
      commandInvalid: '终端命令必须是有效字符串且不能包含 NUL 字符',
      cmdBang: 'cmd 命令模板不能包含 !；该字符由 CLILoom 的安全变量绑定保留，请改用 PowerShell',
      cmdNewline: 'cmd 命令模板不能包含换行，请改用 PowerShell',
      cmdEnvExpansion: 'cmd 命令模板不能使用 %NAME% 环境变量展开；请使用工作流变量绑定或改用 PowerShell',
      cmdValueNewline: 'cmd 变量值不能包含换行，请改用 PowerShell',
      cmdValueTooLarge: 'cmd 变量值超过 {{limit}} 字符限制',
      cmdEnvTooLarge: 'cmd 环境变量 {{name}} 超过 {{limit}} 字符限制',
      cmdCommandTooLarge: 'cmd 命令展开后超过 {{limit}} 字符限制',
      cmdEnvBlockTooLarge: 'cmd 环境块超过 {{limit}} 字符限制'
    },
    assistantCommand: {
      absolutePath: '带路径的初始化命令必须使用绝对路径',
      unavailable: '初始化命令不可用：{{executable}}',
      notFound: '找不到初始化命令：{{executable}}',
      unknownCommand: '未知命令：{{command}}',
      workflowNotFound: '工作流不存在或已被删除',
      invalidWorkflowSubcommand: 'workflow 子命令无效',
      invalidProjectSubcommand: 'project 子命令无效',
      invalidSettingsSubcommand: 'settings 子命令无效',
      stdinDuplicate: '--stdin 不能重复',
      fileRelative: '--file 需要一个相对路径',
      revisionPositive: '--expected-revision 必须是正整数',
      unknownArgument: '未知参数：{{argument}}',
      stdinOrFile: '必须且只能选择 --stdin 或 --file',
      workflowJsonEmpty: '工作流 JSON 为空',
      workflowJsonParse: '无法解析工作流 JSON',
      argCount: '参数数量无效，需要 {{count}} 个',
      initMustBeString: '初始化命令必须是字符串',
      initEmpty: '初始化命令不能为空',
      initTooLong: '初始化命令不能超过 {{limit}} 个字符',
      initNul: '初始化命令不能包含 NUL 字符',
      initUnterminatedEscape: '初始化命令以未完成的转义结尾',
      initCommandSubstitution: '初始化命令不能包含命令替换',
      initControlOperator: '初始化命令不能包含控制操作符 {{operator}}',
      initRedirection: '初始化命令不能包含输入输出重定向',
      initUnclosedQuote: '初始化命令包含未闭合的引号',
      initNoExecutable: '初始化命令必须包含可执行文件',
      cmdPercent: 'cmd.exe 模式下初始化命令和路径不能包含 %，请安装 PowerShell 或调整命令',
      cmdInvalidChars: 'cmd.exe 模式下初始化命令和路径不能包含引号、换行或 NUL 字符'
    },
    bridge: {
      revoked: '助手命令桥已撤销',
      notFound: '桥接路径不存在',
      unauthorized: '桥接认证失败',
      invalidContentType: '只接受 application/json',
      noPort: '无法获取助手命令桥端口',
      responseTooLarge: '助手命令响应超过 {{limit}} 字节限制',
      invalidJson: '桥接请求 JSON 无效',
      requestNotObject: '桥接请求必须是对象',
      invalidVersionOrCommand: '桥接请求版本或命令无效',
      invalidArgs: '桥接命令参数无效',
      stdinTooLarge: '标准输入超过限制',
      bodyTooLarge: '桥接请求超过大小限制'
    },
    database: {
      unsupportedSchemaDetected: '该文件的数据库标识与 CLILoom 不匹配。为避免读取或修改无关数据，已拒绝打开：{{path}}',
      unsupportedSchema: '数据库 schema 版本不受支持：{{version}}',
      invalidWorkflowJson: '数据库中的工作流 JSON 无效',
      revisionConflict: '工作流已被其他操作修改，请刷新后重试',
      workflowNotFoundForUpdate: '工作流不存在，无法使用旧修订号更新',
      workflowExistsNoRevision: '工作流已存在，更新时必须提供预期修订号',
      revisionPositive: '预期修订号必须为正整数',
      workflowNotFound: '工作流不存在或已被删除',
      missingVersionTasks: '缺少工作流版本的历史任务数：{{count}}。请先删除相关任务。',
      activeTasksInUse: '正在使用该工作流的活动任务数：{{count}}。请先停止或删除相关任务。',
      projectNotFound: '项目不存在或已被删除',
      projectNameInvalid: '项目名称必须是字符串',
      projectNameEmpty: '项目名称不能为空',
      projectPathInvalid: '项目路径无效或不是绝对路径',
      projectPathNotDirectory: '所选项目路径不是可访问的文件夹',
      projectPathUnsupported: '不支持该项目路径',
      invalidWorkspace: '最近打开的项目和任务无效',
      taskNotFound: '任务不存在或不属于该项目',
      taskTitleInvalid: '任务名称必须是字符串',
      taskTitleEmpty: '任务名称不能为空',
      taskDraftInvalid: '新建任务草稿无效'
    },
    workflowConfig: {
      cancelled: '用户取消了操作',
      workflowIdLabel: '工作流 ID',
      projectIdLabel: '项目 ID',
      designerWorkflowIdLabel: '设计器中的工作流 ID',
      invalidDesignerState: '设计器状态无效',
      invalidDesignerWorkflowId: '设计器中的工作流 ID 无效',
      dirtyInDesigner: '该工作流正在设计器中编辑且有未保存的更改，请先保存或关闭设计器',
      labelInvalid: '{{label}} 无效'
    },
    workflowRuntime: {
      stillRunning: '当前任务的工作流仍在运行或等待输入',
      retryAlreadyQueued: '终端重试已在排队或运行',
      nodeStateChanged: '节点状态已变化，无法重试当前终端',
      shutdownFailed: '工作流运行时关闭失败：{{detail}}',
      shuttingDown: '应用正在退出，不能启动或恢复工作流'
    },
    assistantWorkspace: {
      invalidPath: '文件路径无效',
      fileRelativeOnly: '--file 只接受助手工作区内的相对路径',
      noParentTraversal: '--file 路径不能包含 ..',
      outsideWorkspace: '--file 路径超出助手工作区',
      fileNotFound: '文件不存在：{{path}}',
      readFileOutside: '--file 不能读取助手工作区之外的文件',
      notAFile: '--file 目标必须是普通文件',
      fileTooLarge: '文件超过 {{limit}} 字节限制',
      notADirectory: '受管助手路径必须是目录且不能是符号链接：{{path}}',
      managedNotAFile: '受管助手路径必须是普通文件且不能是符号链接：{{path}}',
      buildIdentityInvalid: '助手工作区的应用构建身份无效',
      unsafeLauncherPath: '应用路径不能安全写入 Windows 启动器'
    },
    assistantTerminal: {
      stageParse: '解析',
      stageSync: '同步工作区',
      stageDetect: '检测',
      stageStart: '启动',
      startCancelled: '助手终端启动已取消',
      treeNotTerminated: '助手进程树未能确认终止',
      cleanupFailed: '助手清理失败：{{detail}}',
      autoRecommendedUnparsed: '自动推荐（未解析）',
      stageFailed: '平台 {{platform}}，Shell {{shell}}，{{stage}}阶段失败：{{detail}}。请重新检测 Shell 或在主窗口设置中选择其他 Shell'
    },
    runtime: {
      workflowVersionMismatch: '工作流版本与运行状态不匹配：{{actual}} !== {{expected}}',
      executionTargetUnsupported: '该工作流使用了已不再受支持的历史执行目标',
      branchNotFound: '分支不存在: {{id}}',
      nodeNotFound: '节点不存在: {{id}}',
      executionLimit: '工作流执行次数超限 ({{limit}})，可能存在无限循环',
      startHookFailed: 'startHook 失败',
      endHookFailed: 'endHook 失败',
      missingVariables: '缺少必填变量: {{names}}',
      noSatisfiedBranch: '没有满足条件的分支',
      nestedSplitUnsupported: '分支内暂不支持嵌套 split',
      parallelBranchFailed: '并行分支失败',
      parallelJoinUnmet: '并行 join 未满足: 必需入边未全部到达',
      hookFailed: '{{hookType}}Hook 失败：{{detail}}'
    },
    termination: {
      invalidPid: '进程 PID 无效',
      taskkillNotFound: '无法从 SystemRoot 定位 Windows taskkill.exe',
      taskkillStartFailed: 'taskkill 启动失败：{{detail}}',
      taskkillTimeout: 'taskkill 执行超时',
      taskkillExecFailed: 'taskkill 执行失败：{{detail}}',
      taskkillResultUnknown: '无法确认 taskkill 结果：{{detail}}',
      taskkillExitCode: 'taskkill 返回退出码 {{code}}：{{detail}}'
    },
    expression: {
      unterminatedString: '字符串缺少结束引号',
      unrecognizedChar: '无法识别的表达式字符: {{char}}',
      syntaxExpected: '表达式语法错误，期望 {{type}}',
      syntaxUnexpectedToken: '表达式语法错误，意外 token: {{token}}',
      unsupportedFunction: '不支持的函数: {{name}}',
      functionArity: '{{name}} 需要 {{expected}} 个参数，但收到 {{received}} 个',
      unsupportedOperator: '不支持的操作符: {{operator}}'
    },
    clipboard: {
      unavailable: '系统剪贴板不可用',
      writeFailed: '无法写入系统剪贴板',
      readFailed: '无法读取系统剪贴板'
    },
    terminal: {
      notInputtable: '终端当前不接受输入',
      transcriptApiUnavailable: '终端历史记录不可用'
    },
    boundary: {
      title: '应用出现错误',
      description: '界面无法继续渲染，请重新加载后重试。',
      reload: '重新加载'
    },
    workflowValidation: {
      workflow: '工作流',
      workflowId: '工作流 ID',
      workflowName: '工作流名称',
      workflowDescription: '工作流描述',
      nodes: '工作流节点',
      edges: '工作流连线',
      duplicateNodeId: '节点 ID 重复：{{id}}',
      duplicateEdgeId: '连线 ID 重复：{{id}}',
      fromNodeMissing: '{{id}}: 起点节点不存在',
      toNodeMissing: '{{id}}: 终点节点不存在',
      nodeLabel: '节点 {{index}}',
      unsupportedNodeType: '{{id}}: 不支持的节点类型',
      nodeName: '{{id}}: 节点名称',
      gatewayMode: '{{id}}: mode 必须是 split 或 join',
      variableType: '{{label}}[{{index}}]: type 必须是 text 或 number',
      failPolicy: '{{label}}: failPolicy 必须是 continue 或 fail-node',
      edgeLabel: '连线 {{index}}',
      edgeIdLabel: '连线 {{index}} ID',
      layout: '工作流布局',
      layoutNodes: '工作流布局节点',
      tooManyLayoutNodes: '工作流布局节点数量过多',
      layoutNodeMissing: '工作流布局引用了不存在的节点：{{id}}',
      layoutPosition: '{{id}}: 布局位置',
      tooManyEntries: '{{label}} 项目过多',
      invalidKey: '{{label}} 包含无效键名',
      mustBeObject: '{{label}} 必须是对象',
      mustBeArray: '{{label}} 必须是数组',
      arrayTooLong: '{{label}} 数量超过限制 {{maxLength}}',
      mustBeString: '{{label}} 必须是字符串',
      mustNotContainNul: '{{label}} 不能包含 NUL 字符',
      mustNotBeEmpty: '{{label}} 不能为空',
      tooLong: '{{label}} 过长',
      mustBeBoolean: '{{label}} 必须是布尔值',
      mustBeInteger: '{{label}} 必须是 {{min}} 到 {{max}} 之间的整数',
      mustBeFinite: '{{label}} 必须是有限数字',
      mustBePrimitive: '{{label}} 必须是字符串、数字、布尔值或 null',
      variableKeyEmpty: '变量名不能为空',
      variableKeyPattern: '变量名只能包含字母、数字和下划线，且不能以数字开头',
      variableKeySysPrefix: '用户变量不能使用 sys_ 前缀',
      variableOrderInvalid: '{{label}}: 变量顺序必须是大于等于 1 的整数',
      variableKeyDuplicate: '{{key}}: 变量名重复',
      workflowVariableNul: '工作流变量不能包含 NUL 字符',
      terminalCommandNul: '终端命令不能包含 NUL 字符',
      singleStartNode: '工作流必须有且只有一个 start 节点',
      startNeedsOutgoingEdge: 'start 节点至少需要一条出边',
      startHasIncomingEdge: 'start 节点不能有入边',
      endHasOutgoingEdge: '{{name}}: end 节点不能有出边',
      missingIncomingEdge: '{{name}}: 缺少入边',
      missingOutgoingEdge: '{{name}}: 缺少出边',
      normalNodeSingleOutgoingEdge: '{{name}}: 普通节点只能有一条出边',
      singleDefaultBranch: '{{name}}: 默认分支只能有一条',
      invalidDefaultEdgeId: '{{name}}: defaultEdgeId 必须引用当前网关的一条出边',
      splitNeedsTwoOutgoingEdges: '{{name}}: split 节点至少需要两条出边',
      joinNeedsIncomingEdgeIds: '{{name}}: join 节点必须配置 joinIncomingEdgeIds',
      joinIncomingEdgeIdsDuplicate: '{{name}}: joinIncomingEdgeIds 不能重复',
      joinIncomingEdgeIdsMissingEdge: '{{name}}: joinIncomingEdgeIds 引用了不存在的边',
      joinIncomingEdgeIdsMustTargetJoin: '{{name}}: joinIncomingEdgeIds 只能引用指向当前 join 的入边',
      joinIncomingEdgeIdsSharedByMultipleJoins: '{{name}}: joinIncomingEdgeIds 不能被多个 join 节点重复引用',
      terminalCommandEmpty: '{{name}}: 终端命令不能为空',
      workingDirEmpty: '{{name}}: 工作目录不能为空'
    }
  },
  workflow: {
    runtimeAction: {
      stop: '停止工作流'
    },
    delete: {
      title: '删除工作流',
      confirm: '删除工作流“{{name}}”？',
      detailId: '工作流 ID：{{id}}',
      detailDefaultProjects: '将其设为默认工作流的项目数：{{count}}',
      detailHistoricalTasks: '关联历史任务：{{count}}',
      detailActiveTasks: '进行中任务：{{count}}',
      description: '当前工作流定义和全部连线将被永久删除，历史任务仍保留启动时使用的工作流版本。',
      defaultProjectsNote: '将它设为默认工作流的项目会自动改用其他可用工作流。',
      confirmButton: '删除工作流',
      tooltip: '删除工作流'
    },
    nodeType: {
      start: '开始',
      interactiveTerminal: '交互终端',
      nonInteractiveTerminal: '非交互终端',
      input: '人工输入',
      exclusiveGateway: '条件网关',
      parallelGateway: '并行网关',
      end: '结束'
    },
    systemVariable: {
      sys_task_id: '当前任务 ID',
      sys_project_dir: '项目根目录路径',
      sys_workflow_id: '当前工作流 ID',
      sys_current_node_id: '当前节点 ID',
      sys_last_node_id: '最近执行命令的节点 ID（仅终端节点，input / gateway 等不计入）',
      sys_last_command_stdout: '最近一条命令的标准输出',
      sys_last_command_stderr: '最近一条命令的标准错误输出',
      sys_last_command_exit_code: '最近一条命令的退出码',
      sys_branch_id: '当前并行分支 ID（仅在并行分支内可用）',
      sys_branch_split_node_id: '触发当前分支的 split 节点 ID（仅在并行分支内可用）',
      sys_branch_entry_edge_id: '进入当前分支的边 ID（仅在并行分支内可用）',
      sys_join_split_node_id: '最近汇合对应的 split 节点 ID（join 后可用）',
      sys_join_node_id: '最近到达的 join 节点 ID（join 后可用）',
      sys_join_results_json: '并行分支结构化结果 JSON 字符串（join 后可用，用于读取分支产物）'
    },
    empty: {
      name: '暂无工作流',
      addFirst: '请先添加工作流',
      noWorkflowsDescription: '当前没有可用工作流，请从左侧项目栏打开工作流设计器进行添加。'
    },
    newName: '新工作流',
    copySuffix: '{{name}} 副本',
    add: '添加工作流',
    toast: {
      saved: '工作流已保存'
    },
    select: {
      aria: '选择工作流'
    },
    deletedSuffix: '{{name}}（已删除）',
    summary: '{{nodes}} 个节点 · {{edges}} 条连线',
    parallelRoutes: '并行 {{count}} 路',
    view: {
      aria: '工作流视图',
      node: '节点视图',
      nodeLabel: '节点',
      graph: '流程图视图',
      graphLabel: '流程图'
    },
    invalidConfigTitle: '工作流配置无效',
    saveFailedTitle: '无法保存工作流',
    switchConfirm: {
      title: '切换工作流？',
      description: '切换后将清除当前任务中已填写的变量，并使用新工作流的默认值。此操作无法撤销。',
      confirm: '确认切换'
    },
    copy: {
      tooltip: '复制工作流'
    },
    actions: {
      aria: '工作流操作 {{name}}'
    }
  },
  project: {
    action: {
      openProject: '打开项目 {{name}}',
      deleteProject: '删除项目 {{name}}',
      addFolder: '添加项目文件夹'
    },
    tooltip: {
      deleteProject: '删除项目'
    },
    rename: {
      title: '重命名项目',
      description: '仅更改项目的显示名称，项目文件夹路径不会改变。',
      nameAria: '项目名称',
      save: '保存名称'
    },
    delete: {
      title: '删除项目“{{name}}”？',
      description: '项目记录和全部历史任务会被删除，但实际项目文件不会被删除。',
      confirm: '删除项目'
    },
    addFolderPrompt: '请先添加项目文件夹',
    noSelection: '未选择项目',
    settings: {
      aria: '项目设置'
    }
  },
  designer: {
    action: {
      open: '工作流设计器'
    },
    variables: {
      title: '可用变量',
      clickHint: '点击变量即可复制。',
      userVariables: '用户变量',
      systemVariables: '系统变量',
      empty: '暂无可用变量',
      copyTitle: '点击复制 {{value}}'
    },
    inspector: {
      emptyTitle: '尚未选择内容',
      emptyDescription: '选择画布中的节点或连线后，在这里编辑属性。',
      edgeMissingTitle: '连线不存在',
      nodeMissingTitle: '节点不存在',
      missingDescription: '它可能已经从工作流中删除。',
      edgeTitle: '连线属性',
      edgeDescription: '配置节点之间的路由规则。',
      nodeDescription: '配置节点执行行为和数据。',
      deleteEdge: '删除连线',
      deleteNode: '删除节点',
      from: '起点',
      to: '终点',
      defaultBranch: '默认分支',
      conditionExpression: '条件表达式',
      name: '名称'
    },
    title: '工作流设计器',
    description: '添加节点、连接路径并配置执行方式。',
    workflowName: {
      aria: '工作流名称'
    },
    arrange: {
      aria: '一键整理工作流节点',
      tooltip: '按流程顺序从左到右排列，并行节点同列展示，节点间隔 100px',
      label: '一键整理'
    },
    saveWorkflow: '保存工作流',
    close: {
      aria: '关闭工作流设计器'
    },
    discardConfirm: {
      title: '放弃未保存的更改？',
      description: '当前工作流的更改尚未保存，关闭设计器后这些更改会丢失。',
      keepEditing: '继续编辑',
      discard: '放弃更改'
    },
    edge: {
      delete: {
        aria: '删除连线',
        tooltip: '删除连线'
      },
      defaultLabel: '默认'
    },
    palette: {
      flowControl: '流程控制',
      terminal: '终端',
      data: '数据'
    },
    nodeConfig: {
      command: '命令',
      commandLabel: '命令',
      commandPlaceholder: '输入要执行的命令…',
      workingDir: '工作目录',
      interactiveMode: '交互模式',
      interactiveModeDescription: '终端会自动启动，命令执行后保持打开供继续操作；关闭终端后工作流继续。',
      options: '选项',
      successExitCodes: '成功退出码',
      exitCodesHint: '多个退出码使用逗号、空格或换行分隔。',
      timeoutMs: '超时时间（毫秒）',
      unlimited: '不限',
      mode: '模式',
      modeSplit: '并行分支 (split)',
      modeJoin: '汇合 (join)',
      joinIncoming: '需要等待的入边',
      joinIncomingDescription: '将分支连接到此汇合节点后，选择该节点需要等待的入边。'
    },
    env: {
      title: '环境变量',
      keyAria: '环境变量键',
      keyPlaceholder: '键',
      valueAria: '环境变量值',
      valuePlaceholder: '值',
      delete: {
        aria: '删除环境变量'
      },
      add: '添加环境变量'
    },
    hooks: {
      startHookTitle: '前置 Hook',
      startHookDescription: '在此节点执行之前运行。',
      endHookTitle: '后置 Hook',
      endHookDescription: '在此节点完成后运行。',
      enable: '启用',
      commandLabel: '命令',
      commandPlaceholder: '输入要执行的命令…',
      workingDir: '工作目录',
      failPolicy: '失败策略',
      failPolicyContinue: '失败后继续',
      failPolicyFailNode: '失败则中止节点',
      failPolicyHint: '当 hook 非零退出或启动失败时的处理方式。'
    },
    variableEditor: {
      title: '变量定义',
      orderHint: '可设置排列顺序；数字越小越靠前，未设置的变量排在最后。',
      defaultLabel: '变量 {{index}}',
      delete: {
        aria: '删除变量',
        tooltip: '删除变量'
      },
      key: '键名',
      keyPlaceholder: '变量名',
      label: '标签',
      labelPlaceholder: '显示名称',
      order: '排列顺序',
      orderUnset: '未设置',
      type: '类型',
      typeText: '文本',
      typeNumber: '数字',
      required: '必填',
      defaultValue: '默认值',
      add: '添加变量'
    }
  },
  assistant: {
    action: {
      open: '打开助手',
      settings: '助手设置',
      hide: '隐藏助手',
      close: '关闭助手',
      detect: '检测命令',
      saveAndStart: '保存并启动',
      restart: '重新启动',
      saveOnly: '仅保存',
      saveAndRestart: '保存并重启'
    },
    label: {
      window: 'CLILoom 助手',
      windowTitle: 'CLILoom 助手'
    },
    config: {
      title: '配置助手 CLI',
      description: '首次使用必须配置一个可用的初始化命令。CLILoom 会在专用用户目录中启动它。'
    },
    validation: {
      commandAvailable: '命令可用：{{detail}}'
    },
    shell: {
      errorHint: '{{error}}\n\n请返回主窗口设置，重新检测或选择其他终端环境。',
      unavailableTitle: '全局终端环境不可用',
      redirectOnly: '请回到主窗口设置并重新检测或选择终端环境。'
    },
    operationFailedTitle: '助手操作失败',
    settings: {
      title: '助手设置',
      description: '修改初始化命令。仅保存不会中断当前终端会话。'
    },
    globalShell: '全局终端环境',
    globalShellDescription: '由主窗口设置；更改后将在下次启动或重启助手时生效。',
    initializationCommand: '初始化命令',
    command: {
      placeholder: '输入常用的 AI CLI 启动命令，如 codex 或 opencode',
      hint: '支持命令及参数，包括带空格的引用路径；不支持管道、重定向或命令串联。'
    },
    status: {
      idle: '未启动',
      starting: '正在启动…',
      running: '运行中',
      failed: '启动失败',
      ended: '已结束（退出码：{{code}}）',
      unknownExitCode: '未知'
    }
  },
  terminal: {
    action: {
      endAndContinue: '结束终端并继续',
      rerunCommand: '重新运行命令',
      stopCommand: '停止命令'
    },
    shell: {
      unavailable: '{{name}}（不可用）'
    },
    kind: {
      interactive: '交互终端',
      nonInteractive: '非交互终端'
    },
    retry: {
      aria: '重试终端命令',
      workflowTooltip: '重试此节点并继续原工作流',
      rerunTooltip: '独立重新运行这条历史命令，不改变原工作流',
      rerunTooltipTarget: '在 {{target}} 中独立重新运行这条历史命令，不改变原工作流'
    },
    environment: {
      label: '环境：{{target}}'
    },
    menu: {
      showInRichEditor: '在富文本编辑器中显示'
    },
    toast: {
      copiedSelection: '已复制选中文本',
      copiedContent: '已复制终端内容',
      copiedMarkdown: '已复制 Markdown'
    },
    transcript: {
      loadingHistory: '正在加载终端历史…',
      historyLoadFailed: '无法加载终端历史。',
      errorPrefix: '[错误] {{message}}',
      treeKillFailed: '终止进程树失败：{{detail}}',
      invalidCommand: '[无效命令]',
      selectedBranch: '选择分支: {{id}}',
      timeout: '{{ms}} 毫秒后进程超时'
    },
    markdown: {
      codeBlockLanguage: '代码块语言',
      codeBlockSelectLanguage: '选择代码块语言',
      editableMarkdown: '可编辑 Markdown',
      linkCancelTooltip: '取消更改',
      linkSaveTooltip: '保存链接',
      linkText: '链接文字',
      linkTextTooltip: '链接中显示的文字',
      linkTitle: '链接标题',
      linkTitleTooltip: '鼠标悬停时显示的标题',
      linkUrlPlaceholder: '输入或粘贴 URL',
      dialogClose: '关闭对话框',
      blockTypePlaceholder: '块类型',
      blockTypeSelectTooltip: '选择块类型',
      blockTypeHeading: '标题 {{level}}',
      blockTypeParagraph: '正文',
      blockTypeQuote: '引用',
      blockTypePlainText: '纯文本',
      bold: '粗体',
      bulletedList: '无序列表',
      checkList: '任务列表',
      codeBlockInsert: '插入代码块',
      inlineCode: '行内代码',
      italic: '斜体',
      linkCreate: '创建链接',
      numberedList: '有序列表',
      redo: '重做 {{shortcut}}',
      removeBold: '取消粗体',
      removeInlineCode: '取消行内代码',
      removeItalic: '取消斜体',
      removeStrikethrough: '取消删除线',
      richText: '富文本',
      source: 'Markdown 源码',
      strikethrough: '删除线',
      table: '插入表格',
      thematicBreak: '插入分隔线',
      toggleGroup: '格式工具',
      undo: '撤销 {{shortcut}}',
      dialog: {
        title: '终端内容',
        description: '临时编辑 Markdown；关闭后不会保存或回写终端。'
      },
      parseWarningTitle: '无法以富文本解析部分内容',
      parseWarningDescription: '原文仍然保留，请使用工具栏右侧的 Markdown 源码视图继续编辑。',
      placeholder: '终端没有可展示的内容',
      copyMarkdown: '复制 Markdown'
    }
  },
  node: {
    action: {
      retry: '重试节点'
    },
    status: {
      withExitCode: '{{label}} · exit {{code}}'
    },
    terminal: {
      selectSession: '选择终端会话',
      sessionLabel: '会话 {{index}} · {{status}}'
    },
    output: {
      empty: '尚无输出。'
    },
    variable: {
      emptyTitle: '此节点没有变量',
      emptyDescription: '可在工作流设计器中为节点添加变量定义。'
    },
    gateway: {
      decisionCompleted: '已完成决策',
      decisionPending: '等待执行决策',
      branchPending: '等待分支状态',
      parallelDefault: '并行网关'
    },
    end: {
      completedTitle: '任务已完成',
      pendingTitle: '等待流程结束',
      completedDescription: '工作流已到达结束节点。',
      pendingDescription: '等待流程到达结束节点。'
    },
    zoom: {
      flowGraph: '流程图',
      backToGateway: '返回并行网关',
      zoomIn: '放大节点'
    },
    parallel: {
      viewingSingle: '正在查看单个分支节点',
      routesCount: '{{count}} 条并行路线',
      viewFullGraphAria: '查看完整流程图'
    }
  },
  settings: {
    menu: {
      label: '设置',
      skin: '主题',
      defaultShell: '终端 Shell',
      globalShell: '全局终端环境'
    },
    shell: {
      automatic: '自动推荐',
      automaticHint: '按当前平台选择主流原生 Shell',
      noneDetected: '未检测到可用终端环境',
      redetect: '重新检测终端环境',
      unavailableShort: '不可用',
      nativeGroup: '当前系统',
      windowsGroup: 'Windows'
    },
    language: {
      label: '语言',
      en: 'English',
      zh: '中文'
    },
    update: {
      check: '检查更新',
      checking: '正在检查更新',
      available: '发现新版本',
      downloading: '正在下载更新',
      downloadingPercent: '正在下载更新（{{percent}}%）',
      restart: '重启并更新',
      viewRelease: '查看更新',
      retry: '重试检查更新',
      currentVersion: 'v{{version}}',
      upToDate: 'CLILoom v{{version}} 已是最新版。',
      availableTitle: 'CLILoom v{{version}} 可用',
      readyTitle: 'CLILoom v{{version}} 已准备好',
      currentAndLatest: '当前版本：v{{current}} · 最新版本：v{{latest}}',
      automaticDownload: '更新将自动下载，下载期间可以继续使用 CLILoom。',
      downloadProgress: '已下载 {{percent}}%',
      readyDescription: '更新已下载完成。准备好安装时，请重启 CLILoom。',
      manualDescription: '当前包型不能原地更新。请打开经过校验的 GitHub Release，手动安装对应包。',
      portableDescription: '便携版需手动替换，CLILoom 不会覆盖当前正在运行的外层可执行文件。',
      macUnsignedDescription: '在 CLILoom 完成签名和公证前，macOS 更新仅提供下载提示。',
      linuxPackageDescription: 'CLILoom 不会请求 root 权限或运行包管理器；请通过系统的常规流程安装 DEB 或 RPM。',
      unsignedWindowsWarning: '当前 Windows 构建尚未代码签名，可能触发 SmartScreen 警告。请确认安装包来自 CLILoom GitHub Release。',
      releaseNotes: '版本说明',
      noReleaseNotes: '此版本未提供说明。',
      later: '稍后',
      error: {
        unsupportedBuild: '当前构建不支持检查更新。',
        checkFailed: '无法检查更新，请重试。',
        downloadFailed: '更新下载失败，请重试。',
        invalidRelease: '更新信息无效。',
        installUnavailable: '更新尚未准备好安装。',
        installFailed: '无法启动更新安装程序。',
        openReleaseFailed: '无法打开 GitHub Release 页面。'
      }
    }
  },
  status: {
    task: {
      draft: '新建中',
      pending: '待执行',
      running: '运行中',
      waitingInput: '等待输入',
      completed: '已完成',
      failed: '失败',
      stopped: '已停止',
      interrupted: '已中断'
    },
    terminal: {
      closed: '已结束'
    },
    shell: {
      notDetected: '尚未检测 Shell'
    },
    runtime: {
      userStopped: '用户停止',
      exitCode: '退出码 {{code}}',
      nodeExitCode: '{{name}}: 退出码 {{code}}'
    }
  },
  task: {
    new: '新建任务',
    defaultTitle: '新建任务',
    selectOrCreate: '选择或新建任务',
    defaultWorkflow: '默认工作流',
    noWorkflows: '暂无可用工作流',
    viewMore: '查看更多',
    actionsAria: '任务操作 {{name}}',
    action: {
      rename: '重命名'
    },
    empty: {
      noTasks: '暂无已发起任务',
      selectOrCreate: '请选择或新建任务',
      openOrCreateDescription: '从左侧打开历史任务，或新建任务后开始运行工作流。'
    },
    rename: {
      title: '重命名任务',
      description: '输入一个便于在历史任务中识别的名称，可使用 Ctrl/⌘ + Enter 保存。',
      nameAria: '任务名称',
      save: '保存名称'
    },
    delete: {
      title: '删除任务“{{name}}”？',
      description: '任务运行记录、终端会话和日志都会被永久删除。',
      confirm: '删除任务'
    }
  },
  skin: {
    builtin: {
      light: {
        neutral: '中性浅色'
      },
      dark: {
        neutral: '中性深色'
      }
    },
    mode: {
      light: '浅色',
      dark: '深色'
    },
    group: {
      preset: '预设主题',
      mySkins: '自定义主题'
    },
    section: {
      colors: '界面颜色',
      surfaces: '页面与容器',
      interaction: '操作与状态',
      structure: '边框与输入',
      navigation: '左侧导航栏',
      charts: '图表数据系列',
      typography: '界面排版',
      codeFont: '代码与终端',
      radius: '圆角',
      spacing: '间距',
      background: '窗口/工作区背景效果'
    },
    token: {
      background: '页面基础背景色',
      foreground: '页面默认文字与图标色',
      card: '卡片容器背景色',
      cardForeground: '卡片容器文字与图标色',
      popover: '弹出层背景色',
      popoverForeground: '弹出层文字与图标色',
      primary: '主要操作与激活元素背景色',
      primaryForeground: '主要操作与激活元素文字与图标色',
      secondary: '次要操作控件背景色',
      secondaryForeground: '次要操作控件文字与图标色',
      muted: '弱化区域背景色',
      mutedForeground: '辅助说明文字与图标色',
      accent: '悬停或选中项背景色',
      accentForeground: '悬停或选中项文字与图标色',
      destructive: '危险操作与错误强调色',
      border: '通用边框与分隔线色',
      input: '输入控件边框与底色',
      ring: '键盘焦点环色',
      chart1: '图表数据系列 1 颜色',
      chart2: '图表数据系列 2 颜色',
      chart3: '图表数据系列 3 颜色',
      chart4: '图表数据系列 4 颜色',
      chart5: '图表数据系列 5 颜色',
      sidebar: '左侧导航栏背景色',
      sidebarForeground: '左侧导航栏默认文字与图标色',
      sidebarPrimary: '左侧导航栏主要操作背景色',
      sidebarPrimaryForeground: '左侧导航栏主要操作文字与图标色',
      sidebarAccent: '左侧导航栏悬停或选中项背景色',
      sidebarAccentForeground: '左侧导航栏悬停或选中项文字与图标色',
      sidebarBorder: '左侧导航栏边框与分隔线色',
      sidebarRing: '左侧导航栏键盘焦点环色'
    },
    tokenDescription: {
      background: '用于页面、工作区和一般区域的基础底色。',
      foreground: '用于未指定容器或状态时的默认文字和图标。',
      card: '用于卡片、工作流画布和缩略图等容器的底色。',
      cardForeground: '用于卡片容器内的默认文字和图标。',
      popover: '用于对话框、下拉菜单、选择器、命令面板和弹出层的底色。',
      popoverForeground: '用于各类弹出层内的默认文字和图标。',
      primary: '用于主按钮、已激活滑块和流程连接等主要强调元素。',
      primaryForeground: '用于主要操作和激活元素中的文字与图标。',
      secondary: '用于次要按钮、徽章等次级控件的底色。',
      secondaryForeground: '用于次要控件中的文字与图标。',
      muted: '用于未激活项、空状态和辅助区域等低强调表面。',
      mutedForeground: '用于说明、路径、元数据和占位文字等辅助内容。',
      accent: '用于列表行和菜单项的悬停或选中背景。',
      accentForeground: '用于悬停或选中项中的文字与图标。',
      destructive: '用于删除操作、错误提示和其他危险状态的强调。',
      border: '用于普通边框、分栏线和画布边界。',
      input: '用于输入框、选择器、复选框等表单控件的边框或底色。',
      ring: '用于键盘导航时控件周围的焦点高亮。',
      chart1: '预留给图表中的第 1 个数据系列。',
      chart2: '预留给图表中的第 2 个数据系列。',
      chart3: '预留给图表中的第 3 个数据系列。',
      chart4: '预留给图表中的第 4 个数据系列。',
      chart5: '预留给图表中的第 5 个数据系列。',
      sidebar: '用于项目栏、任务栏和设计器导航栏的底色。',
      sidebarForeground: '用于左侧导航栏中的默认文字和图标。',
      sidebarPrimary: '预留给左侧导航栏中的主要操作控件。',
      sidebarPrimaryForeground: '用于左侧导航栏主要操作控件中的文字和图标。',
      sidebarAccent: '预留给左侧导航栏项目的悬停或选中背景。',
      sidebarAccentForeground: '用于左侧导航栏悬停或选中项目中的文字和图标。',
      sidebarBorder: '用于左侧导航栏的边界和分隔线。',
      sidebarRing: '用于左侧导航栏控件的键盘焦点高亮。'
    },
    action: {
      customize: '自定义…',
      new: '新建主题',
      duplicate: '复制并编辑',
      rename: '重命名',
      delete: '删除',
      reset: '恢复默认',
      import: '导入…',
      export: '导出…',
      confirm: '保存',
      apply: '应用主题',
      cancel: '取消'
    },
    delete: {
      title: '删除主题“{{name}}”？',
      description: '该自定义主题将被永久删除；如果它正在使用，界面会自动切换到默认主题。此操作无法撤销。',
      confirm: '删除主题'
    },
    background: {
      description: '控制窗口和工作区最外层的背景效果，与“页面基础背景色”不同。',
      solid: '单色背景',
      gradient: '渐变背景',
      stop: '渐变色点',
      angle: '渐变方向',
      addStop: '新增渐变色点'
    },
    font: {
      family: '字体',
      available: '可选字体',
      bundled: '内置',
      unavailable: '未安装',
      searchPlaceholder: '搜索已安装字体',
      searchHint: '输入以搜索本机已安装字体；不可用时回退到 JetBrains Mono。',
      noResults: '未找到匹配的字体',
      loading: '正在读取系统字体…',
      loadFailed: '无法读取系统字体。',
      retry: '重试',
      unavailableHint: '当前字体未安装，正在使用 JetBrains Mono 回退字体。',
      size: '界面字号',
      lineHeight: '界面行高'
    },
    name: {
      label: '主题名称',
      placeholder: '主题名称'
    },
    hint: {
      realtimePreview: '修改会实时预览，保存后才会保留。',
      emptyCustom: '暂无自定义主题。'
    },
    error: {
      invalidId: '未知的主题 id',
      nameRequired: '主题名称不能为空',
      libraryFull: '主题数量已达上限',
      parseFailed: '无法导入该主题文件',
      dirtyConfirm: '放弃未保存的修改？'
    }
  }
} as const
