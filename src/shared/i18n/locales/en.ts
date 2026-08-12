export default {
  common: {
    app: {
      name: 'CLILoom'
    },
    action: {
      cancel: 'Cancel',
      delete: 'Delete',
      save: 'Save',
      confirm: 'Confirm',
      close: 'Close',
      copy: 'Copy',
      paste: 'Paste',
      retry: 'Retry',
      stop: 'Stop',
      add: 'Add',
      rename: 'Rename',
      ok: 'OK',
      run: 'Run',
      continue: 'Continue',
      switchAndRestart: 'Switch and restart'
    },
    instanceHandoff: {
      title: 'Switch to another CLILoom build?',
      message: 'Another CLILoom portable build was just started.',
      detail: 'Current build: {{current}}\nRequested build: {{incoming}}\n\nCLILoom will safely stop the current workflows and assistant before starting the portable application you just opened. The assistant workspace and user data will be preserved and synchronized.',
      unavailableTitle: 'Another CLILoom build was detected',
      unavailableMessage: 'CLILoom cannot switch to the application that was just started automatically.',
      unavailableDetail: 'Requested build: {{incoming}}\n\nExit the current CLILoom instance, then open the requested application again.',
      launchFailedTitle: 'Could not start the new CLILoom build',
      launchFailedMessage: 'The current application stopped safely, but the requested portable application could not be started. Open it again manually.\n\n{{detail}}'
    },
    status: {
      failed: 'Failed',
      running: 'Running',
      completed: 'Completed',
      unsaved: 'Unsaved'
    },
    aria: {
      resizeProjectRail: 'Resize project rail',
      resizeTaskSidebar: 'Resize task sidebar'
    },
    empty: {
      noData: 'No data'
    }
  },
  errors: {
    exit: {
      unsafeTitle: 'CLILoom cannot exit safely',
      unsafeMessage: 'Some child processes could not be confirmed terminated. Resolve them and try again.\n\n{{detail}}',
      treesNotTerminated: '{{count}} process tree(s) could not be confirmed terminated'
    },
    startup: {
      failedTitle: 'CLILoom failed to start'
    },
    session: {
      invalidId: 'Invalid terminal session ID',
      notReady: 'Terminal session is not ready, cannot stop the current process',
      notFound: 'Terminal session not found',
      stillRunning: 'The terminal is still running and cannot be retried',
      neutralCommandInvalid: 'Invalid shell-neutral command format',
      commandContainsNul: 'Terminal command must not contain a NUL character',
      historyInvalid: 'Historical terminal record is invalid, rerun the workflow',
      retryDataInvalid: 'Terminal retry data is invalid, rerun the workflow',
      executionTargetUnsupported: 'This historical execution target is no longer supported and cannot be retried',
      retryCommandInvalid: 'Terminal retry command is invalid, rerun the workflow',
      retryReadFailed: 'Could not read historical terminal retry data, rerun the workflow',
      retryBindingMissing: 'Historical terminal variable binding is missing, cannot retry safely, rerun the workflow',
      retryBindingIncomplete: 'Historical terminal variable binding is incomplete, cannot retry safely, rerun the workflow',
      retryBindingUnmatched: 'Historical terminal contains variable bindings that cannot be matched, cannot retry safely, rerun the workflow',
      retryEnvInvalid: 'Terminal retry environment is invalid, rerun the workflow',
      retryParamsInvalid: 'Terminal retry parameters are invalid, rerun the workflow'
    },
    assistant: {
      invalidAction: 'Invalid assistant settings action',
      missingInitCommand: 'Configure the initialization command first'
    },
    sender: {
      mainInvalid: 'Invalid main window sender',
      assistantInvalid: 'Invalid assistant window sender',
      settingsInvalid: 'Invalid settings window sender'
    },
    appearance: {
      unsupportedSkin: 'Unsupported skin',
      unsupportedLanguage: 'Unsupported interface language'
    },
    windowState: {
      mainInvalid: 'Invalid main window state',
      assistantInvalid: 'Invalid assistant window state'
    },
    publicSetting: {
      inaccessible: 'Setting does not exist or is not accessible',
      notMutable: 'Setting does not exist or is not mutable',
      valueMustBeString: 'Setting value must be a string'
    },
    workflow: {
      revisionMissing: 'Missing workflow revision, refresh and retry',
      saveNoResult: 'Saving the workflow returned no result'
    },
    shell: {
      invalidSelection: 'Invalid shell selection',
      mustBeDetected: 'Only currently detected and supported shells can be selected',
      noneDetectedPlatform: 'No supported shell detected on the current platform ({{platform}}). Install one and redetect.',
      noneDetectedPlatformShort: 'No supported shell detected on the current platform ({{platform}})',
      unavailable: 'The selected shell is unavailable: {{name}} ({{path}}). Redetect or choose another shell.',
      unavailableShort: 'The selected shell is unavailable: {{name}} ({{path}})',
      stageParse: 'parse',
      stageDetect: 'detect',
      stageStart: 'start',
      stageWrite: 'write',
      unparsed: 'unparsed',
      stageFailed: 'Platform {{platform}}, shell {{shell}}, failed during {{stage}}: {{detail}}. Redetect the shell or choose another in Settings.',
      neutralInvalid: 'Invalid shell-neutral command format',
      invalidBindingName: 'Invalid shell binding name',
      nulInValue: 'Workflow variables must not contain a NUL character',
      envNulOrEquals: 'Environment variable names and values must not contain a NUL character, and names must not contain an equals sign',
      invalidSegment: 'Invalid shell command segment',
      commandNul: 'Terminal commands must not contain a NUL character',
      invalidBindingSegment: 'Invalid shell command binding segment',
      commandInvalid: 'The terminal command must be a valid string and must not contain a NUL character',
      cmdBang: 'cmd command templates must not contain !; this character is reserved by CLILoom for safe variable binding. Use PowerShell instead.',
      cmdNewline: 'cmd command templates must not contain newlines. Use PowerShell instead.',
      cmdEnvExpansion: 'cmd command templates must not use %NAME% environment variable expansion; use workflow variable bindings or PowerShell instead.',
      cmdValueNewline: 'cmd variable values must not contain newlines. Use PowerShell instead.',
      cmdValueTooLarge: 'cmd variable value exceeds the {{limit}} character limit',
      cmdEnvTooLarge: 'cmd environment variable {{name}} exceeds the {{limit}} character limit',
      cmdCommandTooLarge: 'cmd command exceeds the {{limit}} character limit after expansion',
      cmdEnvBlockTooLarge: 'cmd environment block exceeds the {{limit}} character limit'
    },
    assistantCommand: {
      absolutePath: 'Initialization commands with a path must use an absolute path',
      unavailable: 'Initialization command is unavailable: {{executable}}',
      notFound: 'Could not find the initialization command: {{executable}}',
      unknownCommand: 'Unknown command: {{command}}',
      workflowNotFound: 'Workflow not found or has been deleted',
      invalidWorkflowSubcommand: 'Invalid workflow subcommand',
      invalidProjectSubcommand: 'Invalid project subcommand',
      invalidSettingsSubcommand: 'Invalid settings subcommand',
      stdinDuplicate: '--stdin cannot be repeated',
      fileRelative: '--file requires a relative path',
      revisionPositive: '--expected-revision must be a positive integer',
      unknownArgument: 'Unknown argument: {{argument}}',
      stdinOrFile: 'Choose exactly one of --stdin or --file',
      workflowJsonEmpty: 'Workflow JSON is empty',
      workflowJsonParse: 'Workflow JSON could not be parsed',
      argCount: 'Invalid argument count, expected {{count}}',
      initMustBeString: 'The initialization command must be a string',
      initEmpty: 'The initialization command must not be empty',
      initTooLong: 'The initialization command cannot exceed {{limit}} characters',
      initNul: 'The initialization command must not contain a NUL character',
      initUnterminatedEscape: 'The initialization command ends with an unfinished escape',
      initCommandSubstitution: 'The initialization command must not contain command substitution',
      initControlOperator: 'The initialization command must not contain the control operator {{operator}}',
      initRedirection: 'The initialization command must not contain I/O redirection',
      initUnclosedQuote: 'The initialization command contains an unclosed quote',
      initNoExecutable: 'The initialization command must contain an executable',
      cmdPercent: 'Under cmd.exe the initialization command and path must not contain %. Install PowerShell or adjust the command.',
      cmdInvalidChars: 'Under cmd.exe the initialization command and path must not contain quotes, newlines, or NUL characters'
    },
    bridge: {
      revoked: 'Assistant command bridge revoked',
      notFound: 'Bridge path not found',
      unauthorized: 'Bridge authentication failed',
      invalidContentType: 'Only application/json is accepted',
      noPort: 'Could not obtain the assistant command bridge port',
      responseTooLarge: 'Assistant command response exceeds the {{limit}} byte limit',
      invalidJson: 'Invalid bridge request JSON',
      requestNotObject: 'The bridge request must be an object',
      invalidVersionOrCommand: 'Invalid bridge request version or command',
      invalidArgs: 'Invalid bridge command arguments',
      stdinTooLarge: 'Standard input exceeds the limit',
      bodyTooLarge: 'The bridge request exceeds the size limit'
    },
    database: {
      unsupportedSchemaDetected: 'A database from a different release was detected; opening was refused to avoid reading or modifying non-current data: {{path}}',
      unsupportedSchema: 'Unsupported database schema version: {{version}}',
      invalidWorkflowJson: 'Invalid workflow JSON in the database',
      revisionConflict: 'The workflow has been modified by another operation; refresh and retry',
      workflowNotFoundForUpdate: 'Workflow not found; cannot update by old revision',
      workflowExistsNoRevision: 'Workflow already exists; an expected revision must be provided when updating',
      revisionPositive: 'expected revision must be a positive integer',
      workflowNotFound: 'Workflow not found or has been deleted',
      missingVersionTasks: 'This workflow has {{count}} historical task(s) missing a workflow version; delete the related tasks first',
      activeTasksInUse: 'This workflow is still in use by {{count}} active task(s); stop or delete the related tasks first',
      projectNotFound: 'Project not found or has been deleted',
      projectPathInvalid: 'The project path is invalid or is not absolute',
      projectPathNotDirectory: 'The selected project path is not an accessible directory',
      projectPathUnsupported: 'This project path is not supported',
      invalidWorkspace: 'The recently opened project and task are invalid',
      taskNotFound: 'Task not found or does not belong to this project',
      taskTitleInvalid: 'Task name must be a string',
      taskTitleEmpty: 'Task name must not be empty'
    },
    workflowConfig: {
      cancelled: 'The operation was cancelled by the user',
      workflowIdLabel: 'Workflow ID',
      projectIdLabel: 'Project ID',
      designerWorkflowIdLabel: 'Designer workflow ID',
      invalidDesignerState: 'Invalid designer state',
      invalidDesignerWorkflowId: 'Invalid designer workflow ID',
      dirtyInDesigner: 'This workflow is being edited in the designer with unsaved changes; save or close the designer first',
      labelInvalid: 'Invalid {{label}}'
    },
    workflowRuntime: {
      stillRunning: 'The workflow for the current task is still running or waiting for input',
      retryAlreadyQueued: 'A terminal retry is already queued or running',
      nodeStateChanged: 'Node state has changed; cannot retry the current terminal',
      shutdownFailed: 'Workflow runtime shutdown failed: {{detail}}',
      shuttingDown: 'The application is exiting; workflows cannot be started or resumed'
    },
    assistantWorkspace: {
      invalidPath: 'Invalid file path',
      fileRelativeOnly: '--file only accepts relative paths inside the assistant workspace',
      noParentTraversal: 'The --file path must not contain ..',
      outsideWorkspace: 'The --file path is outside the assistant workspace',
      fileNotFound: 'File not found: {{path}}',
      readFileOutside: '--file cannot read files outside the assistant workspace',
      notAFile: 'The --file target must be a regular file',
      fileTooLarge: 'File exceeds the {{limit}} byte limit',
      notADirectory: 'The managed assistant directory is not a regular directory: {{path}}',
      managedNotAFile: 'The managed assistant file is not a regular file: {{path}}',
      buildIdentityInvalid: 'The assistant workspace build identity is invalid',
      unsafeLauncherPath: 'The application path cannot be written safely to the Windows launcher'
    },
    assistantTerminal: {
      stageParse: 'parse',
      stageSync: 'synchronize workspace',
      stageDetect: 'detect',
      stageStart: 'start',
      startCancelled: 'Assistant terminal start was cancelled',
      treeNotTerminated: 'The assistant process tree could not be confirmed terminated',
      cleanupFailed: 'Assistant cleanup failed: {{detail}}',
      autoRecommendedUnparsed: 'Automatic recommendation (unparsed)',
      stageFailed: 'Platform {{platform}}, shell {{shell}}, failed during {{stage}}: {{detail}}. Redetect the shell or choose another in the main window settings.'
    },
    runtime: {
      workflowVersionMismatch: 'Workflow version does not match the run state: {{actual}} !== {{expected}}',
      executionTargetUnsupported: 'This workflow uses a historical execution target that is no longer supported',
      branchNotFound: 'Branch not found: {{id}}',
      nodeNotFound: 'Node not found: {{id}}',
      executionLimit: 'Workflow execution count exceeded the limit ({{limit}}); there may be an infinite loop',
      startHookFailed: 'startHook failed',
      endHookFailed: 'endHook failed',
      missingVariables: 'Missing required variables: {{names}}',
      noSatisfiedBranch: 'No branch satisfied the conditions',
      nestedSplitUnsupported: 'Nested split inside a branch is not supported',
      parallelBranchFailed: 'Parallel branch failed',
      parallelJoinUnmet: 'Parallel join unmet: required incoming edges have not all arrived',
      hookFailed: '{{hookType}}Hook failed: {{detail}}'
    },
    termination: {
      invalidPid: 'Invalid process PID',
      taskkillNotFound: 'Could not locate Windows taskkill.exe via SystemRoot',
      taskkillStartFailed: 'taskkill failed to start: {{detail}}',
      taskkillTimeout: 'taskkill timed out',
      taskkillExecFailed: 'taskkill failed: {{detail}}',
      taskkillResultUnknown: 'Could not confirm the taskkill result: {{detail}}',
      taskkillExitCode: 'taskkill returned exit code {{code}}: {{detail}}'
    },
    expression: {
      unterminatedString: 'String is missing a closing quote',
      unrecognizedChar: 'Unrecognized expression character: {{char}}',
      syntaxExpected: 'Expression syntax error, expected {{type}}',
      syntaxUnexpectedToken: 'Expression syntax error, unexpected token: {{token}}',
      unsupportedFunction: 'Unsupported function: {{name}}',
      functionArity: '{{name}} expects {{expected}} argument(s) but received {{received}}',
      unsupportedOperator: 'Unsupported operator: {{operator}}'
    },
    clipboard: {
      unavailable: 'System clipboard is unavailable',
      writeFailed: 'Could not write to the system clipboard',
      readFailed: 'Could not read the system clipboard'
    },
    terminal: {
      notInputtable: 'The terminal is not accepting input right now'
    },
    boundary: {
      title: 'The application hit an error',
      description: 'The interface cannot continue rendering. Reload and try again.',
      reload: 'Reload'
    },
    workflowValidation: {
      workflow: 'Workflow',
      workflowId: 'Workflow ID',
      workflowName: 'Workflow name',
      workflowDescription: 'Workflow description',
      nodes: 'Workflow nodes',
      edges: 'Workflow edges',
      duplicateNodeId: 'Duplicate node ID: {{id}}',
      duplicateEdgeId: 'Duplicate edge ID: {{id}}',
      fromNodeMissing: '{{id}}: source node does not exist',
      toNodeMissing: '{{id}}: target node does not exist',
      nodeLabel: 'Node {{index}}',
      unsupportedNodeType: '{{id}}: unsupported node type',
      nodeName: '{{id}}: node name',
      gatewayMode: '{{id}}: mode must be split or join',
      variableType: '{{label}}[{{index}}]: type must be text or number',
      failPolicy: '{{label}}: failPolicy must be continue or fail-node',
      edgeLabel: 'Edge {{index}}',
      edgeIdLabel: 'Edge {{index}} ID',
      layout: 'Workflow layout',
      layoutNodes: 'Workflow layout nodes',
      tooManyLayoutNodes: 'Too many workflow layout nodes',
      layoutNodeMissing: 'Workflow layout references a missing node: {{id}}',
      layoutPosition: '{{id}}: layout position',
      tooManyEntries: 'Too many {{label}} entries',
      invalidKey: '{{label}} contains an invalid key',
      mustBeObject: '{{label}} must be an object',
      mustBeArray: '{{label}} must be an array',
      arrayTooLong: '{{label}} count exceeds the limit of {{maxLength}}',
      mustBeString: '{{label}} must be a string',
      mustNotContainNul: '{{label}} must not contain a NUL character',
      mustNotBeEmpty: '{{label}} must not be empty',
      tooLong: '{{label}} is too long',
      mustBeBoolean: '{{label}} must be a boolean',
      mustBeInteger: '{{label}} must be an integer between {{min}} and {{max}}',
      mustBeFinite: '{{label}} must be a finite number',
      mustBePrimitive: '{{label}} must be a string, number, boolean, or null',
      variableKeyEmpty: 'Variable name must not be empty',
      variableKeyPattern: 'Variable names may only contain letters, digits, and underscores, and cannot start with a digit',
      variableKeySysPrefix: 'User variables cannot use the sys_ prefix',
      variableOrderInvalid: '{{label}}: variable order must be an integer greater than or equal to 1',
      variableKeyDuplicate: '{{key}}: duplicate variable name',
      workflowVariableNul: 'Workflow variables must not contain a NUL character',
      terminalCommandNul: 'Terminal commands must not contain a NUL character',
      singleStartNode: 'The workflow must have exactly one start node',
      startNeedsOutgoingEdge: 'The start node needs at least one outgoing edge',
      startHasIncomingEdge: 'The start node cannot have incoming edges',
      endHasOutgoingEdge: '{{name}}: end nodes cannot have outgoing edges',
      missingIncomingEdge: '{{name}}: missing incoming edge',
      missingOutgoingEdge: '{{name}}: missing outgoing edge',
      normalNodeSingleOutgoingEdge: '{{name}}: regular nodes may only have one outgoing edge',
      singleDefaultBranch: '{{name}}: there can only be one default branch',
      invalidDefaultEdgeId: '{{name}}: defaultEdgeId must reference one of the gateway outgoing edges',
      splitNeedsTwoOutgoingEdges: '{{name}}: split nodes need at least two outgoing edges',
      joinNeedsIncomingEdgeIds: '{{name}}: join nodes must configure joinIncomingEdgeIds',
      joinIncomingEdgeIdsDuplicate: '{{name}}: joinIncomingEdgeIds must not contain duplicates',
      joinIncomingEdgeIdsMissingEdge: '{{name}}: joinIncomingEdgeIds references a missing edge',
      joinIncomingEdgeIdsMustTargetJoin: '{{name}}: joinIncomingEdgeIds may only reference edges targeting this join',
      joinIncomingEdgeIdsSharedByMultipleJoins: '{{name}}: joinIncomingEdgeIds cannot be shared by multiple join nodes',
      terminalCommandEmpty: '{{name}}: terminal command must not be empty',
      workingDirEmpty: '{{name}}: working directory must not be empty'
    }
  },
  workflow: {
    delete: {
      title: 'Delete workflow',
      confirm: 'Delete workflow "{{name}}"?',
      detailId: 'Workflow ID: {{id}}',
      detailDefaultProjects: 'Projects using it as the default: {{count}}',
      detailHistoricalTasks: 'Related historical tasks: {{count}}',
      detailActiveTasks: 'Active tasks: {{count}}',
      description: 'The workflow definition and all its edges will be permanently deleted; historical tasks keep the workflow version they started with.',
      defaultProjectsNote: 'Projects using it as the default will automatically switch to another available workflow.',
      confirmButton: 'Delete workflow',
      tooltip: 'Delete workflow'
    },
    nodeType: {
      start: 'Start',
      interactiveTerminal: 'Interactive terminal',
      nonInteractiveTerminal: 'Non-interactive terminal',
      input: 'Manual input',
      exclusiveGateway: 'Exclusive gateway',
      parallelGateway: 'Parallel gateway',
      end: 'End'
    },
    systemVariable: {
      sys_task_id: 'Current task ID',
      sys_project_dir: 'Project root path',
      sys_workflow_id: 'Current workflow ID',
      sys_current_node_id: 'Current node ID',
      sys_last_node_id: 'Node ID of the last executed command (terminal nodes only; input/gateway excluded)',
      sys_last_command_stdout: 'Standard output of the last command',
      sys_last_command_stderr: 'Standard error of the last command',
      sys_last_command_exit_code: 'Exit code of the last command',
      sys_branch_id: 'Current parallel branch ID (only inside a parallel branch)',
      sys_branch_split_node_id: 'Split node ID that triggered the current branch (only inside a parallel branch)',
      sys_branch_entry_edge_id: 'Edge ID entering the current branch (only inside a parallel branch)',
      sys_join_split_node_id: 'Split node ID of the most recent join (available after join)',
      sys_join_node_id: 'Most recently reached join node ID (available after join)',
      sys_join_results_json: 'Parallel branch structured results JSON string (available after join, used to read branch outputs)'
    },
    empty: {
      name: 'No workflow',
      addFirst: 'Add a workflow first',
      noWorkflowsDescription: 'No workflow is available. Open the workflow designer from the project rail to add one.'
    },
    newName: 'New workflow',
    copySuffix: '{{name}} copy',
    add: 'Add workflow',
    toast: {
      saved: 'Workflow saved'
    },
    select: {
      aria: 'Select workflow'
    },
    deletedSuffix: '{{name}} (deleted)',
    summary: '{{nodes}} nodes · {{edges}} edges',
    parallelRoutes: 'Parallel {{count}} routes',
    view: {
      aria: 'Workflow view',
      node: 'Node view',
      nodeLabel: 'Node',
      graph: 'Flow graph view',
      graphLabel: 'Flow graph'
    },
    invalidConfigTitle: 'Invalid workflow configuration',
    saveFailedTitle: 'Cannot save the workflow',
    switchConfirm: {
      title: 'Switch workflow?',
      description: 'Switching will clear the variables entered in the current task and use the new workflow defaults. This cannot be undone.',
      confirm: 'Confirm switch'
    },
    copy: {
      tooltip: 'Copy workflow'
    },
    actions: {
      aria: 'Workflow actions {{name}}'
    }
  },
  project: {
    action: {
      openProject: 'Open project {{name}}',
      deleteProject: 'Delete project {{name}}',
      addFolder: 'Add project folder'
    },
    tooltip: {
      deleteProject: 'Delete project'
    },
    delete: {
      title: 'Delete project "{{name}}"?',
      description: 'The project record and all its historical tasks will be removed. The actual project files will not be deleted.',
      confirm: 'Delete project'
    },
    addFolderPrompt: 'Add a project folder first',
    noSelection: 'No project selected',
    settings: {
      aria: 'Project settings'
    }
  },
  designer: {
    action: {
      open: 'Workflow designer'
    },
    variables: {
      title: 'Available variables',
      clickHint: 'Click a variable to copy it.',
      userVariables: 'User variables',
      systemVariables: 'System variables',
      empty: 'No variables available',
      copyTitle: 'Click to copy {{value}}'
    },
    inspector: {
      emptyTitle: 'Nothing selected',
      emptyDescription: 'Select a node or edge on the canvas to edit its properties here.',
      edgeMissingTitle: 'Edge not found',
      nodeMissingTitle: 'Node not found',
      missingDescription: 'It may have been removed from the workflow.',
      edgeTitle: 'Edge properties',
      edgeDescription: 'Configure routing rules between nodes.',
      nodeDescription: 'Configure node execution behavior and data.',
      deleteEdge: 'Delete edge',
      deleteNode: 'Delete node',
      from: 'Source',
      to: 'Target',
      defaultBranch: 'Default branch',
      conditionExpression: 'Condition expression',
      name: 'Name'
    },
    title: 'Workflow designer',
    description: 'Drag in nodes, connect paths, and configure execution parameters.',
    workflowName: {
      aria: 'Workflow name'
    },
    arrange: {
      aria: 'Auto-arrange workflow nodes',
      tooltip: 'Arrange left-to-right by flow order; parallel nodes share a column; 100px spacing.',
      label: 'Auto-arrange'
    },
    saveWorkflow: 'Save workflow',
    close: {
      aria: 'Close workflow designer'
    },
    discardConfirm: {
      title: 'Discard unsaved changes?',
      description: 'The current workflow has unsaved changes that will be lost when you close the designer.',
      keepEditing: 'Keep editing',
      discard: 'Discard changes'
    },
    edge: {
      delete: {
        aria: 'Delete edge',
        tooltip: 'Delete edge'
      }
    },
    palette: {
      flowControl: 'Flow control',
      terminal: 'Terminal',
      data: 'Data'
    },
    nodeConfig: {
      command: 'Command',
      commandLabel: 'Command',
      commandPlaceholder: 'Enter the command to run…',
      workingDir: 'Working directory',
      interactiveMode: 'Interactive mode',
      interactiveModeDescription: 'A terminal starts automatically and stays open after the command runs so you can keep working; closing it continues the workflow.',
      options: 'Options',
      successExitCodes: 'Success exit codes',
      exitCodesHint: 'Separate multiple exit codes with commas, spaces, or newlines.',
      timeoutMs: 'Timeout (ms)',
      unlimited: 'No limit',
      mode: 'Mode',
      modeSplit: 'Parallel branch (split)',
      modeJoin: 'Join (join)',
      joinIncoming: 'Join incoming edges',
      joinIncomingDescription: 'After connecting branches to this join node, select the incoming edges to wait for here.'
    },
    env: {
      title: 'Environment variables',
      keyAria: 'Environment variable key',
      keyPlaceholder: 'Key',
      valueAria: 'Environment variable value',
      valuePlaceholder: 'Value',
      delete: {
        aria: 'Delete environment variable'
      },
      add: 'Add environment variable'
    },
    hooks: {
      startHookTitle: 'Start hook',
      startHookDescription: 'Runs before this node executes.',
      endHookTitle: 'End hook',
      endHookDescription: 'Runs after this node completes.',
      enable: 'Enabled',
      commandLabel: 'Command',
      commandPlaceholder: 'Command to run…',
      workingDir: 'Working directory',
      failPolicy: 'Failure policy',
      failPolicyContinue: 'Continue on failure',
      failPolicyFailNode: 'Fail the node on failure',
      failPolicyHint: 'What happens when the hook exits non-zero or fails to start.'
    },
    variableEditor: {
      title: 'Variable definitions',
      orderHint: 'Set an order; lower numbers come first; unset variables go last.',
      defaultLabel: 'Variable {{index}}',
      delete: {
        aria: 'Delete variable',
        tooltip: 'Delete variable'
      },
      key: 'Key',
      keyPlaceholder: 'Variable name',
      label: 'Label',
      labelPlaceholder: 'Display name',
      order: 'Order',
      orderUnset: 'Not set',
      type: 'Type',
      typeText: 'Text',
      typeNumber: 'Number',
      required: 'Required',
      defaultValue: 'Default value',
      add: 'Add variable'
    }
  },
  assistant: {
    action: {
      open: 'Open assistant',
      settings: 'Assistant settings',
      hide: 'Hide assistant',
      close: 'Close assistant',
      detect: 'Detect command',
      saveAndStart: 'Save and start',
      restart: 'Restart',
      saveOnly: 'Save only',
      saveAndRestart: 'Save and restart'
    },
    label: {
      window: 'CLILoom Assistant',
      windowTitle: 'CLILoom Assistant'
    },
    config: {
      title: 'Configure the assistant CLI',
      description: 'You must configure a working initialization command before first use. CLILoom launches it in a dedicated user directory.'
    },
    validation: {
      commandAvailable: 'Command available: {{detail}}'
    },
    shell: {
      errorHint: '{{error}} Return to the main window settings to redetect or choose another terminal environment.',
      unavailableTitle: 'Global terminal environment unavailable',
      redirectOnly: 'Return to the main window settings to redetect or choose another terminal environment.'
    },
    operationFailedTitle: 'Assistant operation failed',
    settings: {
      title: 'Assistant settings',
      description: 'Edit the initialization command. Saving alone will not interrupt the current terminal session.'
    },
    globalShell: 'Global terminal environment',
    globalShellDescription: 'Set in the main window; changes take effect the next time the assistant starts or restarts.',
    initializationCommand: 'Initialization command',
    command: {
      placeholder: 'Enter the AI CLI launch command you usually use (such as codex or opencode) to help you use this app',
      hint: 'Supports commands and arguments, including quoted paths with spaces; pipes, redirects, and command chaining are not supported.'
    },
    status: {
      idle: 'Not started',
      starting: 'Starting…',
      running: 'Running',
      failed: 'Start failed',
      ended: 'Ended (exit code {{code}})',
      unknownExitCode: 'unknown exit code'
    }
  },
  terminal: {
    shell: {
      unavailable: '{{name}} (unavailable)'
    },
    kind: {
      interactive: 'Interactive terminal',
      nonInteractive: 'Non-interactive terminal'
    },
    retry: {
      aria: 'Retry terminal command',
      tooltip: 'Clear the screen and rerun the current command',
      tooltipTarget: 'Clear the screen and rerun in {{target}}'
    },
    environment: {
      label: 'Environment: {{target}}'
    },
    menu: {
      showInRichEditor: 'Show in rich text editor'
    },
    toast: {
      copiedSelection: 'Copied selected text',
      copiedContent: 'Copied terminal content',
      copiedMarkdown: 'Copied Markdown'
    },
    transcript: {
      loadingHistory: 'Loading terminal history…',
      historyLoadFailed: 'Could not load terminal history.',
      errorPrefix: '[Error] {{message}}',
      treeKillFailed: 'Failed to terminate the process tree: {{detail}}',
      invalidCommand: '[invalid command]',
      selectedBranch: 'Selected branch: {{id}}',
      timeout: 'Process timed out after {{ms}} ms'
    },
    markdown: {
      codeBlockLanguage: 'Code block language',
      codeBlockSelectLanguage: 'Select code block language',
      editableMarkdown: 'Editable Markdown',
      linkCancelTooltip: 'Cancel changes',
      linkSaveTooltip: 'Save link',
      linkText: 'Link text',
      linkTextTooltip: 'Text shown in the link',
      linkTitle: 'Link title',
      linkTitleTooltip: 'Title shown on hover',
      linkUrlPlaceholder: 'Enter or paste a URL',
      dialogClose: 'Close dialog',
      blockTypePlaceholder: 'Block type',
      blockTypeSelectTooltip: 'Select block type',
      blockTypeHeading: 'Heading {{level}}',
      blockTypeParagraph: 'Paragraph',
      blockTypeQuote: 'Quote',
      blockTypePlainText: 'Plain text',
      bold: 'Bold',
      bulletedList: 'Bulleted list',
      checkList: 'Check list',
      codeBlockInsert: 'Insert code block',
      inlineCode: 'Inline code',
      italic: 'Italic',
      linkCreate: 'Create link',
      numberedList: 'Numbered list',
      redo: 'Redo {{shortcut}}',
      removeBold: 'Remove bold',
      removeInlineCode: 'Remove inline code',
      removeItalic: 'Remove italic',
      removeStrikethrough: 'Remove strikethrough',
      richText: 'Rich text',
      source: 'Markdown source',
      strikethrough: 'Strikethrough',
      table: 'Insert table',
      thematicBreak: 'Insert thematic break',
      toggleGroup: 'Formatting tools',
      undo: 'Undo {{shortcut}}',
      dialog: {
        title: 'Terminal content',
        description: 'Edit Markdown temporarily; closing will not save or write back to the terminal.'
      },
      parseWarningTitle: 'Could not parse some content as rich text',
      parseWarningDescription: 'The original text is preserved; use the Markdown source view on the right of the toolbar to keep editing.',
      placeholder: 'The terminal has nothing to show',
      copyMarkdown: 'Copy Markdown'
    }
  },
  node: {
    status: {
      withExitCode: '{{label}} · exit {{code}}'
    },
    terminal: {
      selectSession: 'Select terminal session',
      sessionLabel: 'Session {{index}} · {{status}}'
    },
    output: {
      empty: 'No output yet.'
    },
    variable: {
      emptyTitle: 'This node has no variables',
      emptyDescription: 'Add variable definitions for the node in the workflow designer.'
    },
    gateway: {
      decisionCompleted: 'Decision completed',
      decisionPending: 'Waiting for the decision to run',
      branchPending: 'Waiting for branch status',
      parallelDefault: 'Parallel gateway'
    },
    end: {
      completedTitle: 'Task completed',
      pendingTitle: 'Waiting for the workflow to finish',
      completedDescription: 'All nodes in the workflow have finished running.',
      pendingDescription: 'Waiting for the flow to reach the end node.'
    },
    zoom: {
      flowGraph: 'Flow graph',
      backToGateway: 'Back to parallel gateway',
      zoomIn: 'Zoom into node'
    },
    parallel: {
      viewingSingle: 'Viewing a single branch node',
      routesCount: '{{count}} routes running in parallel',
      viewFullGraphAria: 'View full flow graph'
    }
  },
  settings: {
    menu: {
      label: 'Settings',
      skin: 'Skin',
      defaultShell: 'Terminal Shell',
      globalShell: 'Global terminal environment'
    },
    shell: {
      automatic: 'Automatic',
      automaticHint: 'Picks a mainstream native shell for the current platform',
      noneDetected: 'No available terminal environment detected',
      redetect: 'Redetect environments',
      unavailableShort: 'Unavailable',
      nativeGroup: 'This system',
      windowsGroup: 'Windows'
    },
    language: {
      label: 'Language',
      en: 'English',
      zh: '中文'
    }
  },
  status: {
    task: {
      draft: 'Creating',
      pending: 'Pending',
      running: 'Running',
      waitingInput: 'Waiting for input',
      completed: 'Completed',
      failed: 'Failed',
      stopped: 'Stopped',
      interrupted: 'Interrupted'
    },
    terminal: {
      closed: 'Ended'
    },
    shell: {
      notDetected: 'Shell not yet detected'
    },
    runtime: {
      userStopped: 'User stopped',
      exitCode: 'Exit code {{code}}',
      nodeExitCode: '{{name}}: exit code {{code}}'
    }
  },
  task: {
    new: 'New task',
    defaultTitle: 'New task',
    selectOrCreate: 'Select or create a task',
    defaultWorkflow: 'Default workflow',
    noWorkflows: 'No workflows available',
    viewAll: 'View all {{count}} tasks',
    actionsAria: 'Task actions {{name}}',
    action: {
      rename: 'Rename'
    },
    empty: {
      noTasks: 'No tasks started yet',
      selectOrCreate: 'Select or create a task',
      openOrCreateDescription: 'Open a past task from the left, or start a new task to run the workflow.'
    },
    rename: {
      title: 'Rename task',
      description: 'Enter a name that is easy to find in the task history. Press Ctrl/⌘ + Enter to save.',
      nameAria: 'Task name',
      save: 'Save name'
    },
    delete: {
      title: 'Delete task "{{name}}"?',
      description: 'The task run record, terminal sessions, and logs will be permanently deleted.',
      confirm: 'Delete task'
    }
  },
  skin: {
    builtin: {
      light: {
        neutral: 'Neutral light'
      },
      dark: {
        neutral: 'Neutral dark'
      }
    },
    mode: {
      light: 'Light',
      dark: 'Dark'
    },
    group: {
      preset: 'Preset skins',
      mySkins: 'Custom skins'
    },
    section: {
      colors: 'Colors',
      typography: 'Interface typography',
      codeFont: 'Code & terminal',
      radius: 'Radius',
      spacing: 'Spacing',
      background: 'Background'
    },
    token: {
      background: 'Background',
      foreground: 'Foreground',
      card: 'Card',
      cardForeground: 'Card foreground',
      popover: 'Popover',
      popoverForeground: 'Popover foreground',
      primary: 'Primary',
      primaryForeground: 'Primary foreground',
      secondary: 'Secondary',
      secondaryForeground: 'Secondary foreground',
      muted: 'Muted',
      mutedForeground: 'Muted foreground',
      accent: 'Accent',
      accentForeground: 'Accent foreground',
      destructive: 'Destructive',
      border: 'Border',
      input: 'Input',
      ring: 'Ring',
      chart1: 'Chart 1',
      chart2: 'Chart 2',
      chart3: 'Chart 3',
      chart4: 'Chart 4',
      chart5: 'Chart 5',
      sidebar: 'Sidebar',
      sidebarForeground: 'Sidebar foreground',
      sidebarPrimary: 'Sidebar primary',
      sidebarPrimaryForeground: 'Sidebar primary foreground',
      sidebarAccent: 'Sidebar accent',
      sidebarAccentForeground: 'Sidebar accent foreground',
      sidebarBorder: 'Sidebar border',
      sidebarRing: 'Sidebar ring'
    },
    action: {
      customize: 'Customize…',
      new: 'New skin',
      duplicate: 'Duplicate to edit',
      rename: 'Rename',
      delete: 'Delete',
      reset: 'Reset to default',
      import: 'Import…',
      export: 'Export…',
      confirm: 'Save',
      cancel: 'Cancel'
    },
    delete: {
      title: 'Delete skin "{{name}}"?',
      description: 'This custom skin will be permanently deleted. If it is active, the interface will automatically switch to the default skin. This cannot be undone.',
      confirm: 'Delete skin'
    },
    background: {
      solid: 'Solid',
      gradient: 'Gradient',
      angle: 'Angle',
      addStop: 'Add color stop'
    },
    font: {
      family: 'Font family',
      available: 'Available fonts',
      bundled: 'Bundled',
      unavailable: 'Not installed',
      searchPlaceholder: 'Search installed fonts',
      searchHint: 'Type to search fonts installed on this device. JetBrains Mono is used as the fallback.',
      noResults: 'No matching fonts found',
      loading: 'Loading system fonts…',
      loadFailed: 'Could not load system fonts.',
      retry: 'Retry',
      unavailableHint: 'The selected font is not installed. JetBrains Mono is being used as the fallback.',
      size: 'UI font size',
      lineHeight: 'UI line height'
    },
    name: {
      label: 'Skin name',
      placeholder: 'Skin name'
    },
    hint: {
      realtimePreview: 'Changes preview live. Save to keep them.',
      emptyCustom: 'No custom skins yet.'
    },
    error: {
      invalidId: 'Unknown skin id',
      nameRequired: 'Skin name is required',
      libraryFull: 'Skin library is full',
      parseFailed: 'Could not import this skin file',
      dirtyConfirm: 'Discard unsaved changes?'
    }
  }
} as const
