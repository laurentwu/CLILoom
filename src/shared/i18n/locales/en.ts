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
      treesNotTerminated: 'Process trees not confirmed terminated: {{count}}'
    },
    update: {
      installUnavailable: 'The update is not ready to install.',
      installCoordinationFailed: 'The update could not start after CLILoom attempted a safe shutdown. The application will remain open; resolve any running-process issue and try again.'
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
      retryParamsInvalid: 'Terminal retry parameters are invalid, rerun the workflow',
      retryCommandEmpty: 'Retry command must not be blank',
      retryVariableUnknown: 'The saved command has no value for variable "{{name}}"',
      retrySavedVariableUnknown: 'Unknown saved variable "{{name}}"; reload the retry command'
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
      unsupportedSkin: 'Unsupported theme',
      unsupportedLanguage: 'Unsupported interface language'
    },
    windowState: {
      mainInvalid: 'Invalid main window state',
      assistantInvalid: 'Invalid assistant window state'
    },
    publicSetting: {
      inaccessible: 'Setting does not exist or is not accessible',
      notMutable: 'Setting does not exist or is not mutable',
      valueMustBeString: 'Setting value must be a string',
      layoutWidthInvalid: 'Layout width must be a decimal integer between {{minimum}} and {{maximum}}'
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
      cmdEnvBlockTooLarge: 'cmd environment block exceeds the {{limit}} character limit',
      selectionAppliedButUnavailable: 'The shell selection was saved, but the selected shell is currently unavailable. Run shell list or shell refresh to inspect candidates, or switch back to automatic.'
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
      revisionDuplicate: '--expected-revision cannot be repeated',
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
      cmdInvalidChars: 'Under cmd.exe the initialization command and path must not contain quotes, newlines, or NUL characters',
      invalidShellSubcommand: 'Invalid shell subcommand',
      invalidSkinSubcommand: 'Invalid skin subcommand',
      inputJsonEmpty: 'Command JSON input is empty',
      inputJsonInvalid: 'Command JSON input could not be parsed',
      inputJsonObjectRequired: 'Command JSON input must be an object',
      inputTooLarge: 'Command input exceeds the {{limit}} byte limit',
      skinNotFound: 'Skin not found',
      skinBuiltinImmutable: 'Built-in skins cannot be modified; duplicate the skin first with skin duplicate'
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
      unsupportedSchemaDetected: 'This file does not have the expected CLILoom database identity, so it was not opened to avoid reading or modifying unrelated data: {{path}}',
      unsupportedSchema: 'Unsupported database schema version: {{version}}',
      invalidWorkflowJson: 'Invalid workflow JSON in the database',
      revisionConflict: 'The workflow has been modified by another operation; refresh and retry',
      workflowNotFoundForUpdate: 'Workflow not found; it cannot be updated using the previous revision',
      workflowExistsNoRevision: 'Workflow already exists; an expected revision must be provided when updating',
      revisionPositive: 'expected revision must be a positive integer',
      workflowNotFound: 'Workflow not found or has been deleted',
      missingVersionTasks: 'Historical tasks without a workflow version: {{count}}. Delete the related tasks first.',
      activeTasksInUse: 'Active tasks using this workflow: {{count}}. Stop or delete the related tasks first.',
      projectNotFound: 'Project not found or has been deleted',
      projectNameInvalid: 'Project name must be a string',
      projectNameEmpty: 'Project name must not be empty',
      projectPathInvalid: 'The project path is invalid or is not absolute',
      projectPathNotDirectory: 'The selected project path is not an accessible directory',
      projectPathUnsupported: 'This project path is not supported',
      invalidWorkspace: 'The recently opened project and task are invalid',
      taskNotFound: 'Task not found or does not belong to this project',
      taskTitleInvalid: 'Task name must be a string',
      taskTitleEmpty: 'Task name must not be empty',
      taskDraftInvalid: 'The task draft is invalid'
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
      retryDraftChanged: 'The terminal or workflow state changed. Reload the command before retrying.',
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
      notADirectory: 'The managed assistant path must be a directory and must not be a symbolic link: {{path}}',
      managedNotAFile: 'The managed assistant path must be a regular file and must not be a symbolic link: {{path}}',
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
      functionArity: 'Argument count for {{name}}: expected {{expected}}, received {{received}}',
      unsupportedOperator: 'Unsupported operator: {{operator}}'
    },
    clipboard: {
      unavailable: 'System clipboard is unavailable',
      writeFailed: 'Could not write to the system clipboard',
      readFailed: 'Could not read the system clipboard'
    },
    terminal: {
      notInputtable: 'The terminal is not accepting input right now',
      transcriptApiUnavailable: 'Terminal history is unavailable'
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
      terminalRetryCommandNul: '{{name}}: terminal retry command must not contain a NUL character',
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
      workingDirEmpty: '{{name}}: working directory must not be empty',
      autoRetryInvalid: '{{name}}: invalid automatic retry configuration',
      autoRetryModeInvalid: '{{name}}: automatic retry mode must be recommended or cron',
      autoRetryMaxRetriesInvalid: '{{name}}: maximum automatic retries must be an integer between 1 and 9999',
      autoRetryCronInvalid: '{{name}}: invalid cron expression for automatic retry'
    },
    cronSchedule: {
      empty: 'The cron expression must not be empty',
      fieldCount: 'The cron expression must have exactly {{count}} fields: minute hour day-of-month month day-of-week',
      fieldSyntax: 'The {{field}} field only supports numbers, "*", commas, hyphens and step values',
      stepInvalid: 'The {{field}} field has an invalid step value (must be a positive integer)',
      rangeInvalid: 'The {{field}} field has a reversed range',
      rangeOutOfBounds: 'The {{field}} field must stay between {{min}} and {{max}}',
      noFutureDate: 'The cron expression has no future trigger time',
      invalid: 'Invalid cron expression'
    }
  },
  workflow: {
    runtimeAction: {
      stop: 'Stop workflow'
    },
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
      openProjectWithUnread: 'Open project {{name}}, unread task status updates',
      deleteProject: 'Delete project {{name}}',
      addFolder: 'Add project folder'
    },
    tooltip: {
      deleteProject: 'Delete project',
      unreadTaskUpdates: 'Unread task status updates'
    },
    rename: {
      title: 'Rename project',
      description: 'This only changes the project display name. The project folder path will not change.',
      nameAria: 'Project name',
      save: 'Save name'
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
    description: 'Add nodes, connect them, and configure how they run.',
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
      },
      defaultLabel: 'Default'
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
      retryCommandLabel: 'Retry command (optional)',
      retryCommandPlaceholder: 'Leave blank to replay the original command…',
      retryCommandDescription: 'Used only when retrying the node in its workflow; variables and the latest command result are available.',
      workingDir: 'Working directory',
      interactiveMode: 'Interactive mode',
      interactiveModeDescription: 'A terminal starts automatically and stays open after the command runs so you can keep working; closing it continues the workflow.',
      options: 'Options',
      successExitCodes: 'Success exit codes',
      exitCodesHint: 'Separate multiple exit codes with commas, spaces, or newlines.',
      timeoutMs: 'Timeout in milliseconds',
      unlimited: 'No limit',
      mode: 'Mode',
      modeSplit: 'Parallel branch (split)',
      modeJoin: 'Join (join)',
      joinIncoming: 'Incoming edges to wait for',
      joinIncomingDescription: 'Connect branches to this join node, then select which incoming edges it must wait for.',
      autoRetryTitle: 'Automatic retry on failure',
      autoRetryEnable: 'Enable automatic retry',
      autoRetryMode: 'Retry schedule',
      autoRetryModeRecommended: 'Recommended',
      autoRetryModeCron: 'Custom cron',
      autoRetryRecommendedHint: 'Wait 1 → 2 → 5 → 10 → 30 minutes after each failure, then keep waiting 30 minutes.',
      autoRetryMaxRetries: 'Maximum automatic retries',
      autoRetryUnlimited: 'Unlimited',
      autoRetryCountHint: 'The first execution and manual retries are not counted; a manual retry starts a new count.',
      autoRetryCronLabel: 'Cron expression',
      autoRetryCronAssistant: 'Expression assistant',
      autoRetryCronAssistantAria: 'Open the cron expression assistant',
      autoRetryCronFieldsHint: 'Five fields: minute hour day-of-month month day-of-week. When both day-of-month and day-of-week are restricted, either match triggers (Unix cron).',
      autoRetryCronPreviewTitle: 'Next 5 candidate times',
      autoRetryCronPreviewTimezone: 'Times shown in {{timezone}}; a running task uses the system time zone recorded when it started.',
      autoRetryCronPreviewHint: 'Candidate calendar triggers: only failed, waiting nodes execute them.',
      autoRetryCronInvalid: 'Invalid cron expression',
      autoRetryCronPreviewUnavailable: 'Preview unavailable'
    },
    cronAssistant: {
      title: 'Expression assistant',
      description: 'Build a simple schedule and apply it to the cron field. The main input still accepts hand-written expressions.',
      mode: 'Frequency',
      modeEveryNMinutes: 'Every N minutes',
      modeHourly: 'Hourly',
      modeDaily: 'Daily',
      modeWeekly: 'Weekly',
      everyNMinutes: 'Interval (minutes)',
      minuteOfHour: 'Minute',
      timeOfDay: 'Time',
      weekdays: 'Days of week',
      weekdayShort: {
        sun: 'Sun',
        mon: 'Mon',
        tue: 'Tue',
        wed: 'Wed',
        thu: 'Thu',
        fri: 'Fri',
        sat: 'Sat'
      },
      generated: 'Generated expression',
      scheduleDescription: 'Description',
      preview: 'Next 5 candidate times',
      previewTimezone: 'Times shown in {{timezone}}',
      unconvertible: 'The current expression cannot be converted to simple settings',
      apply: 'Use expression',
      applyUnavailable: 'Select a valid frequency to use the expression',
      noPreview: 'Preview unavailable'
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
    cli: {
      contextShellLine: 'Shell: {{selection}} (effective: {{detail}})',
      contextShellUnavailable: 'unavailable ({{error}})',
      contextSkinsLine: 'Skins: {{builtinCount}} builtin, {{userCount}} user (active: {{activeSkinId}})',
      contextCapabilitiesTitle: 'Configuration capabilities:',
      contextCapabilityWorkflowSchema: 'workflow schema — complete workflow save field documentation and valid examples',
      contextCapabilityAutoRetry: 'workflow get/save — edit nodes[].config.autoRetry to configure terminal node automatic retry (recommended or cron)',
      contextCapabilityShell: 'shell list/refresh/select — list, re-detect, and choose the global shell',
      contextCapabilitySkin: 'skin — list/get/create/update/duplicate/rename/delete/import/export/fonts',
      contextCapabilityLayout: 'settings set layout.* — project rail and task sidebar widths',
      helpSaveNote: 'workflow save takes one complete workflow definition; run `cliloom workflow schema` for the full field documentation.',
      shellSelection: 'Selection: {{selection}}',
      shellEffective: 'Effective: {{detail}}',
      shellUnavailable: 'unavailable',
      shellCandidates: 'Candidates:',
      shellNoCandidates: 'Candidates: (none detected)',
      shellSelectApplies: 'Applies to new workflows and the next assistant session; running tasks keep their shell snapshot.',
      skinCreated: 'Created skin {{id}} ({{name}}). Not activated; use settings set appearance.skin {{id}} to apply it.',
      skinUpdated: 'Updated skin {{id}} ({{name}}).',
      skinDuplicated: 'Duplicated {{sourceId}} as skin {{id}} ({{name}}). Not activated.',
      skinRenamed: 'Renamed skin {{id}} to {{name}}.',
      skinDeleted: 'Deleted skin {{id}}. Active skin: {{activeId}}.',
      skinImported: 'Imported skin {{id}} ({{name}}). Not activated.',
      skinNoFonts: 'No installed font families found.'
    },
    workflowSchema: {
      title: 'CLILoom workflow schema (schemaVersion {{version}})',
      saveTitle: 'Saving workflows (workflow save)',
      saveSemanticsTitle: 'semantics',
      workflowTitle: 'Workflow root fields',
      nodeTitle: 'Node common fields (nodes[] entries)',
      nodeConfigsTitle: 'Node config fields (nodes[].config by node type)',
      variablesTitle: 'Variable definitions (start/input config.variables[] entries)',
      hooksTitle: 'Hooks (startHook/endHook objects)',
      edgesTitle: 'Edges (edges[] entries)',
      layoutTitle: 'Layout (layout.nodes.<node-id>)',
      autoRetryTitle: 'Terminal automatic retry (config.autoRetry)',
      autoRetryFieldsTitle: 'fields',
      autoRetrySemanticsTitle: 'semantics',
      autoRetrySaveRulesTitle: 'save rules',
      autoRetryExamplesTitle: 'autoRetry field value examples',
      systemVariablesTitle: 'System variables (provided by the runtime)',
      examplesTitle: 'Complete workflow examples',
      notesTitle: 'Notes',
      save: {
        usage: 'cliloom workflow save (--stdin | --file <relative-path>) [--expected-revision <revision>] [--json]',
        input: 'Input is one complete workflow definition object: the workflow member of a workflow get --json response with your edits applied. The get response wrapper ({ version, command, workflow, revision }) is not a valid save input; submit only the workflow object.',
        create: 'Create: submit a complete definition with a new id and omit --expected-revision. The initial revision is 1.',
        update: 'Update: keep the id, include every part of the definition you want to retain, and pass the revision returned by workflow get through --expected-revision. A successful save increments the revision by one. The revision is a command option, not a field of the workflow JSON.',
        readback: 'Read back with workflow get <workflow-id> --json to confirm the normalized stored definition and the new revision.',
        semantics: {
          fullReplacement: 'Save replaces the whole definition. Optional fields omitted from the input are not retained from the stored version: get the current definition, modify it, then submit the complete JSON.',
          revisionOption: 'A missing revision for an existing id, an outdated revision, or a revision for an id that no longer exists fails with a revision conflict (exit code 5). Nothing is overwritten, merged, or retried automatically. A new id without a revision creates the workflow.',
          validateBoundary: 'validate checks only the submitted definition; it does not check the database revision or the designer state and does not guarantee that a later save succeeds.',
          noExecution: 'Reading or saving never executes the workflow. Saved definitions affect future runs only; running tasks keep the workflow version they started with, and waiting automatic-retry plans, retry counters, and history are untouched.',
          dirtyDesigner: 'If the same workflow has unsaved changes in the designer, save fails (validation error, exit code 2). Save or close the designer first; the draft is never closed or overwritten for you.',
          sizeLimits: 'Workflow input is limited to 2 MiB of UTF-8 JSON. stdin additionally shares the 2 MiB bridge request body limit including JSON escaping overhead, so not every stdin payload of exactly 2 MiB can be sent.',
          partialInput: 'Partial objects are not valid input: a bare autoRetry object is not a workflow, and a top-level null (the whole input being null) is not the same as autoRetry: null inside a node config.',
          transportFailure: 'If the transport fails after a save was submitted, the database may still have been written. Re-run workflow get to verify before retrying; do not blindly re-save.'
        }
      },
      workflow: {
        id: 'Required string, 1-512 characters, no NUL. Identifies the workflow; create and update resolve the target by this id and it is never generated automatically.',
        name: 'Required string, 1-512 characters, no NUL. Display name.',
        description: 'Optional string, 0-{{maxString}} characters, no NUL. Omitted means nothing is stored.',
        nodes: 'Required array of nodes, at most {{maxNodes}} entries. Node ids must be unique and exactly one start node must exist. See the node sections.',
        edges: 'Required array of edges, at most {{maxEdges}} entries. Edge ids must be unique and both endpoints must reference existing nodes.',
        layout: 'Optional layout object describing canvas positions only; it never affects execution order. Omitted means no layout is stored.'
      },
      node: {
        id: 'Required string, 1-512 characters, no NUL. Unique within this workflow.',
        type: 'Required. One of the seven supported node types; it determines the config shape. See the node config fields section.',
        name: 'Required string, 1-512 characters, no NUL. Node display name.',
        config: 'Required object whose shape depends on the node type; null is not accepted in place of an object. See the per-type fields.',
        startHook: 'Optional hook object executed before the node runs; omitted means no start hook. See the hooks section.',
        endHook: 'Optional hook object executed after the node completes; omitted means no end hook. See the hooks section.'
      },
      variables: {
        variables: 'Required array, may be empty, at most 1000 entries. On start nodes it defines the task starting variables; on input nodes the existing manual input flow collects them when execution reaches the node.',
        key: 'Required string, 1-512 characters matching [A-Za-z_][A-Za-z0-9_]*. The sys_ prefix is reserved and keys must be unique within the same list.',
        label: 'Required string, 1-512 characters. Display name of the input field.',
        type: "Required: 'text' or 'number'. Determines input handling and default-value conversion.",
        required: 'Required boolean. Marks the input as required at runtime; a value does not need to exist when saving the definition.',
        order: 'Optional integer 1-1000000. Lower values sort first; entries without order sort last and equal orders keep definition order.',
        defaultValue: 'Optional JSON scalar: string of at most {{maxString}} characters, finite number, boolean, or null; objects and arrays are rejected. Omitted means no default is injected, and an existing variable value is never overwritten by a default. Existing conversion: for number variables Number() conversion applies and null or unconvertible values become 0; for text variables null becomes an empty string, booleans stay booleans, and other scalars convert to strings. Prefer values matching the declared type.',
        options: 'Optional string array, at most 1000 entries of 0-10000 characters each. Currently accepted and stored, but input components and the runtime do not use it as a dropdown list and do not validate values against it.'
      },
      terminalShared: {
        command: 'Required string, 1-{{maxString}} characters, not whitespace-only, no NUL. Command template for the first execution; supports ${variable} references.',
        retryCommand: 'Optional string, at most {{maxString}} characters. Used for manual and automatic retries; omitted or whitespace-only normalizes to no configuration and retries fall back to command. A valid value must not contain NUL. It does not affect automatic retries only.',
        cwd: 'Required string, 1-4096 characters, not whitespace-only. Working-directory template; supports ${variable}, commonly ${sys_project_dir}. Saving does not require the directory to exist or be reachable at runtime.',
        env: 'Optional string-to-string map, at most 1000 entries; keys 1-512 characters without NUL, values 0-{{maxString}} characters without NUL. Omitted means no node-specific environment overrides. Values follow the existing environment passing flow; workflow template interpolation is not applied to them automatically.',
        autoRetry: 'Optional automatic retry configuration; see the terminal automatic retry section. Applies to both terminal node types only.'
      },
      interactive: {
        shell: 'Legacy compatibility field accepted only in the interactive-terminal config: string, 1-4096 characters. It does not override the actual global shell selection; use the shell commands to change it.',
        autoStart: 'Required boolean with no save default. Currently parsed and persisted only: at runtime, reaching an interactive terminal still executes directly and does not wait based on this field.'
      },
      nonInteractive: {
        timeoutMs: 'Optional integer 1-86400000 (non-interactive terminals only), in milliseconds. Omitted means no per-node timeout timer is set.',
        successExitCodes: 'Required integer array (non-interactive terminals only), at most 256 entries, each -255-255. No save default; [0] is the common value. An empty array is currently accepted and matches no exit code.'
      },
      gatewayExclusive: {
        defaultEdgeId: "Optional string, 1-512 characters. When present it must reference one of this gateway's outgoing edges at save time. The runtime default-branch lookup uses each edge's isDefault flag, so marking the edge with isDefault: true is what selects the fallback; keep both consistent if you keep defaultEdgeId. Setting defaultEdgeId alone does not guarantee the fallback branch."
      },
      gatewayParallel: {
        mode: "Required: 'split' opens parallel branches; 'join' waits for the branches carried by the listed incoming edges to merge.",
        joinIncomingEdgeIds: 'Required non-empty list in join mode; at most {{maxEdges}} ids of 1-512 characters each. Ids must be unique within the list, must reference existing edges that target this join node, and the same edge must not be listed by more than one join node. Omit in split mode: the parser may store it but never gives it join meaning there.'
      },
      endConfig: {
        config: 'Use the empty object {} as the config of end nodes.'
      },
      hooks: {
        enabled: 'Required boolean. Controls whether the hook executes.',
        command: 'Required string, 0-{{maxString}} characters, no NUL. The current structure accepts an empty string; saving does not reject it.',
        cwd: 'Optional string, 1-4096 characters; supports directory templates such as ${sys_project_dir}. Omitted uses the project directory; it does not automatically inherit the node cwd.',
        env: 'Optional string-to-string map with the same shape and size limits as the terminal env field.',
        failPolicy: "Required: 'continue' or 'fail-node'. Controls whether a hook failure fails the node. No implicit save default.",
        absence: 'Hooks are absent by default: omitted means not executed. An enabled: false hook still requires a structurally valid configuration.'
      },
      edges: {
        id: 'Required string, 1-512 characters, no NUL. Unique among edges.',
        from: 'Required string, 1-512 characters; must reference an existing node id.',
        to: 'Required string, 1-512 characters; must reference an existing node id.',
        condition: 'Optional string, 0-{{maxString}} characters. Exclusive gateways pick the first outgoing edge in edges array order whose condition holds, then fall back to the first outgoing edge marked isDefault. With no match and no default edge the run fails. Other node types do not choose paths by condition.',
        isDefault: 'Optional boolean; omitted equals unmarked. Each exclusive gateway may have at most one default outgoing edge.',
        expression: 'Condition expressions support variable names, strings, numbers, booleans, null, == != > >= < <=, and/or/not, parentheses, and contains/startsWith/endsWith. Example: environment == "production". ${...}, JavaScript &&/||, and arbitrary JavaScript execution are not supported. Save validation does not pre-check that a stored expression is evaluable.'
      },
      layout: {
        nodes: 'Required when layout is present: map of node id to position, at most {{maxNodes}} entries. It may cover only some of the existing nodes but must not reference missing ones.',
        x: 'Required finite number, absolute value at most 10000000. Negative and fractional values are allowed.',
        y: 'Required finite number, absolute value at most 10000000. Negative and fractional values are allowed.'
      },
      autoRetry: {
        storage: 'Stored at nodes[].config.autoRetry on interactive-terminal and non-interactive-terminal nodes only. Absence (field omitted or null) means the configuration is not persisted and retrying is off.',
        saveCommand: 'cliloom workflow save (--stdin | --file <relative-path>) [--expected-revision <revision>] with the complete workflow definition containing the edited config.autoRetry value. Reading uses cliloom workflow get <workflow-id> --json.',
        recommendedDelays: 'recommended mode waits {{delays}} minutes after each failure, then {{later}} minutes for every later attempt. Delays are measured from the failure, not accumulated from task start.',
        fields: {
          enabled: 'Required boolean. false disables retrying while keeping the strategy fields for later re-enable.',
          mode: "Required: 'recommended' (fixed backoff delays) or 'cron' (calendar schedule).",
          maxRetries: 'Optional integer {{min}}-{{max}}; omitted defaults to {{default}} and null means unlimited. 0, fractional numbers, and strings are invalid.',
          cron: 'Required in cron mode: string, at most {{limit}} characters, no NUL, five fields (minute hour day-of-month month day-of-week). In recommended mode the general workflow parser drops the field.'
        },
        semantics: {
          countOnly: 'maxRetries counts automatic retries only: the first execution is not counted and a manual retry starts a fresh cycle.',
          cronCalendar: 'cron mode retries at the next calendar match after the failure, not after a fixed delay. Weekdays 0-7 are accepted; when both day-of-month and weekday are restricted, classic Unix any-match semantics apply.',
          cronLimits: 'Seconds fields, @macros, English month/weekday names, and Quartz extensions are not supported.',
          cronDraft: 'An enabled cron configuration must have a computable future trigger time. A disabled one may keep an unfinished string draft, still subject to the type, length, and NUL limits.',
          timezone: 'The time zone comes from the system IANA zone captured when the task starts, with the existing UTC fallback when no valid zone is available. There is no configurable timezone field.',
          retryCommand: 'Automatic retries run retryCommand when configured, otherwise command.',
          failureScope: 'Whether hook failures, stops, and interruptions trigger a retry follows the current runtime rules; not every failure retries.',
          persistence: 'Saving a workflow does not cancel waiting plans, reset counters of running tasks, or rewrite history.'
        },
        saveRules: {
          fullReplace: 'save replaces the entire workflow: get the definition, edit config.autoRetry inside nodes, and submit the complete JSON with the current revision.',
          removal: 'Remove the configuration by deleting the autoRetry field or setting it to null; after normalization neither form is stored. This is unrelated to submitting a top-level null as the whole save input.',
          disabledKeeps: 'enabled: false keeps the strategy fields stored for later re-enable.',
          unknownKeys: 'Unknown keys inside fixed structures are ignored by the general workflow parser (cron inside recommended mode is dropped), and autoRetry under other node types is dropped rather than enabling retries. The strict unknown-key rejection of the removed dedicated command does not apply to workflow save.'
        }
      },
      notes: {
        graph: 'Graph constraints checked on save: the start node has no incoming edge and exactly one outgoing edge; end nodes have no outgoing edge and at least one incoming edge; every non-gateway node has at least one incoming edge and exactly one outgoing edge; gateways are exempt from that single-outgoing-edge limit — exclusive gateways may have several outgoing edges (at most one marked isDefault), parallel splits need at least two, and parallel joins need at least one (the validator accepts multiple outgoing edges on a join, but the runtime then continues along the first one in edges order).',
        noGlobalGuarantees: 'The validators do not guarantee that every node is reachable, that the graph is acyclic, or that an end node exists.',
        normalization: 'Normalization ignores unknown fields inside fixed structures, drops cron in recommended-mode autoRetry, and removes the autoRetry field when it is omitted or null. For other optional fields, omission leaves them unset; submitting null fails validation instead of removing the field (variables[].defaultValue is the documented scalar where null is a valid stored value).',
        templates: 'Use ${variable} in command and cwd templates; condition expressions use bare variable names (see the edges section).',
        systemVariables: 'System variables are provided by the runtime and cannot be redefined; they are not fields of the save root object. ${name} substitution applies to command and directory templates, while condition expressions use bare variable names.',
        shellLegacy: 'The legacy per-node shell field is parsed for compatibility but does not replace the global shell selection (shell select).',
        revisionHint: 'The revision is not part of the workflow JSON; pass it with --expected-revision on update. Updates require the revision read at workflow get.',
        validateHint: 'Use cliloom workflow validate before save. A valid validation alone does not mean the command ran or will save successfully.',
        exampleFileUsage: 'Prepare the definition as workflow.json inside the assistant workspace and submit it with --file workflow.json (cross-platform, no shell quoting issues); --stdin works too, but the payload must follow the host shell\u0027s quoting rules.'
      }
    },
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
      errorHint: '{{error}}\n\nReturn to the main window settings to redetect or choose another terminal environment.',
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
      placeholder: 'Enter the AI CLI launch command you normally use, such as codex or opencode',
      hint: 'Supports commands and arguments, including quoted paths with spaces; pipes, redirects, and command chaining are not supported.'
    },
    status: {
      idle: 'Not started',
      starting: 'Starting…',
      running: 'Running',
      failed: 'Start failed',
      ended: 'Ended (exit code {{code}})',
      unknownExitCode: 'unknown'
    }
  },
  terminal: {
    action: {
      endAndContinue: 'End terminal and continue',
      rerunCommand: 'Rerun command',
      stopCommand: 'Stop command'
    },
    shell: {
      unavailable: '{{name}} (unavailable)'
    },
    kind: {
      interactive: 'Interactive terminal',
      nonInteractive: 'Non-interactive terminal'
    },
    retry: {
      aria: 'Retry terminal command',
      workflowTooltip: 'Retry this node and continue the original workflow',
      rerunTooltip: 'Rerun this historical command without changing the original workflow',
      rerunTooltipTarget: 'Rerun this historical command in {{target}} without changing the original workflow',
      editAction: 'Edit command and retry',
      editDescription: 'This applies only to this execution. It does not change the workflow configuration or the next default command.',
      executionEnvironment: 'Execution environment',
      workingDirectory: 'Working directory',
      commandLabel: 'Retry command',
      workflowHint: 'Supports ${variable}; current workflow values are used when the command runs.',
      workflowSavedHint: 'retry_saved_* placeholders use values saved with the original session.',
      standaloneHint: 'Saved variables in the command use values from the original session.',
      loading: 'Loading retry command…',
      loadFailed: 'Could not load the retry command: {{detail}}',
      reload: 'Reload',
      emptyError: 'Enter a non-blank command.',
      nulError: 'The command must not contain a NUL character.',
      stateChanged: 'This terminal is no longer available for this action. Close and reopen the editor.',
      submitting: 'Submitting…',
      workflowSubmit: 'Retry and continue workflow',
      standaloneSubmit: 'Rerun command'
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
    action: {
      retry: 'Retry node'
    },
    status: {
      withExitCode: '{{label}} · exit {{code}}',
      autoRetryWaiting: 'Failed · auto retry scheduled',
      autoRetryRunning: 'Running · automatic retry',
      autoRetryExhausted: 'Failed · automatic retries exhausted ({{count}})',
      autoRetryCancelled: 'Failed · automatic retry cancelled',
      autoRetryBlocked: 'Failed · automatic retry unavailable'
    },
    autoRetry: {
      blockedReason: {
        'hook-failed': 'A hook failed, so this cycle can no longer retry automatically.',
        'interrupted': 'The execution was interrupted; retry manually to continue.',
        'missing-session': 'No retryable terminal session was recorded for this node.',
        'missing-workflow': 'The workflow version used by this task is no longer available.',
        'invalid-state': 'The saved retry state is invalid.',
        'schedule-error': 'The retry schedule could not be computed from the cron expression.',
        'user-cancelled': 'Automatic retry was cancelled for this cycle.',
        'task-stopped': 'The task was stopped, so automatic retries were cancelled.'
      },
      nextRetry: 'Automatic retry #{{attempt}} will run at {{time}}',
      statsLimited: '{{started}} / {{max}} automatic retries used · {{timezone}} · {{remaining}} left',
      statsUnlimited: '{{started}} automatic retries used · unlimited · {{timezone}}',
      attemptsOnly: '{{started}} automatic retries used',
      retryNow: 'Retry now',
      cancel: 'Cancel automatic retry',
      preparing: 'Preparing retry…',
      running: 'Automatic retry #{{attempt}} in progress',
      cancelling: 'Cancelling…',
      cancelled: 'Automatic retry cancelled. Manual retry is still available.',
      cancelledTitle: 'Automatic retry cancelled',
      outcomeTitle: 'Automatic retry unavailable',
      exhausted: 'Automatic retries exhausted ({{count}}). Manual retry starts a new count.',
      nextAttemptLabel: 'Next automatic retry'
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
      completedDescription: 'The workflow has reached the end node.',
      pendingDescription: 'Waiting for the flow to reach the end node.'
    },
    zoom: {
      flowGraph: 'Flow graph',
      backToGateway: 'Back to parallel gateway',
      zoomIn: 'Zoom into node'
    },
    parallel: {
      viewingSingle: 'Viewing a single branch node',
      routesCount: '{{count}} parallel routes',
      viewFullGraphAria: 'View full flow graph'
    }
  },
  settings: {
    menu: {
      label: 'Settings',
      skin: 'Theme',
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
    },
    update: {
      check: 'Check for updates',
      checking: 'Checking for updates',
      available: 'Update found',
      downloading: 'Downloading update',
      downloadingPercent: 'Downloading update ({{percent}}%)',
      restart: 'Restart and update',
      viewRelease: 'View update',
      retry: 'Retry update check',
      currentVersion: 'v{{version}}',
      upToDate: 'CLILoom v{{version}} is up to date.',
      availableTitle: 'CLILoom v{{version}} is available',
      readyTitle: 'CLILoom v{{version}} is ready',
      currentAndLatest: 'Current version: v{{current}} · Latest version: v{{latest}}',
      automaticDownload: 'The update will download automatically. You can keep using CLILoom while it downloads.',
      downloadProgress: 'Downloaded {{percent}}%',
      readyDescription: 'The update has downloaded. Restart CLILoom when you are ready to install it.',
      manualDescription: 'This package cannot update itself. Open the verified GitHub Release and install the matching package manually.',
      portableDescription: 'Portable builds are replaced manually so CLILoom never overwrites the executable that is currently running.',
      macUnsignedDescription: 'macOS updates are download-only until CLILoom is signed and notarized.',
      linuxPackageDescription: 'CLILoom will not request root access or run a package manager. Install the DEB or RPM through your normal system workflow.',
      unsignedWindowsWarning: 'This Windows build is not code-signed and may trigger a SmartScreen warning. Verify that the installer came from the CLILoom GitHub Release.',
      releaseNotes: 'Release notes',
      noReleaseNotes: 'No release notes were provided.',
      later: 'Later',
      error: {
        unsupportedBuild: 'This build cannot check for updates.',
        checkFailed: 'Could not check for updates. Try again.',
        downloadFailed: 'The update could not be downloaded. Try again.',
        invalidRelease: 'The update information was invalid.',
        installUnavailable: 'The update is not ready to install.',
        installFailed: 'The installer could not be started.',
        openReleaseFailed: 'The GitHub Release page could not be opened.'
      }
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
    viewMore: 'Show more',
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
      preset: 'Preset themes',
      mySkins: 'Custom themes'
    },
    section: {
      colors: 'Interface colors',
      surfaces: 'Pages & containers',
      interaction: 'Actions & states',
      structure: 'Borders & inputs',
      navigation: 'Left navigation',
      charts: 'Chart data series',
      typography: 'Interface typography',
      codeFont: 'Code & terminal',
      radius: 'Radius',
      spacing: 'Spacing',
      background: 'Window/workspace background effect'
    },
    token: {
      background: 'Page base background',
      foreground: 'Default page text and icons',
      card: 'Card surface background',
      cardForeground: 'Card surface text and icons',
      popover: 'Popover surface background',
      popoverForeground: 'Popover surface text and icons',
      primary: 'Primary action and active-element background',
      primaryForeground: 'Primary action and active-element text and icons',
      secondary: 'Secondary control background',
      secondaryForeground: 'Secondary control text and icons',
      muted: 'Low-emphasis surface background',
      mutedForeground: 'Supporting text and icons',
      accent: 'Hover or selected-item background',
      accentForeground: 'Hover or selected-item text and icons',
      destructive: 'Error and destructive-action emphasis',
      border: 'General borders and dividers',
      input: 'Input-control borders and fill',
      ring: 'Keyboard focus ring',
      chart1: 'Chart data series 1 color',
      chart2: 'Chart data series 2 color',
      chart3: 'Chart data series 3 color',
      chart4: 'Chart data series 4 color',
      chart5: 'Chart data series 5 color',
      sidebar: 'Left navigation background',
      sidebarForeground: 'Left navigation default text and icons',
      sidebarPrimary: 'Left navigation primary-action background',
      sidebarPrimaryForeground: 'Left navigation primary-action text and icons',
      sidebarAccent: 'Left navigation hover or selected-item background',
      sidebarAccentForeground: 'Left navigation hover or selected-item text and icons',
      sidebarBorder: 'Left navigation borders and dividers',
      sidebarRing: 'Left navigation keyboard focus ring'
    },
    tokenDescription: {
      background: 'The base surface for pages, workspaces, and general areas.',
      foreground: 'Default text and icons when no more specific surface or state is set.',
      card: 'The surface used by cards, the workflow canvas, and minimaps.',
      cardForeground: 'Default text and icons inside card surfaces.',
      popover: 'The surface used by dialogs, menus, selectors, command panels, and popovers.',
      popoverForeground: 'Default text and icons inside popover surfaces.',
      primary: 'Used by primary buttons, active slider tracks, and workflow connections.',
      primaryForeground: 'Text and icons inside primary actions and active elements.',
      secondary: 'The surface used by secondary buttons, badges, and similar controls.',
      secondaryForeground: 'Text and icons inside secondary controls.',
      muted: 'Low-emphasis surfaces such as inactive items, empty states, and helper areas.',
      mutedForeground: 'Supporting content such as descriptions, paths, metadata, and placeholders.',
      accent: 'The background shown when a row or menu item is hovered or selected.',
      accentForeground: 'Text and icons inside hovered or selected items.',
      destructive: 'The emphasis color for delete actions, errors, and other dangerous states.',
      border: 'General borders, column dividers, and canvas boundaries.',
      input: 'Borders or fills for text inputs, selectors, checkboxes, and other form controls.',
      ring: 'The highlight drawn around controls during keyboard focus.',
      chart1: 'Reserved for the first data series in a chart.',
      chart2: 'Reserved for the second data series in a chart.',
      chart3: 'Reserved for the third data series in a chart.',
      chart4: 'Reserved for the fourth data series in a chart.',
      chart5: 'Reserved for the fifth data series in a chart.',
      sidebar: 'The surface used by the project rail, task sidebar, and designer navigation.',
      sidebarForeground: 'Default text and icons inside left navigation areas.',
      sidebarPrimary: 'Reserved for primary controls inside left navigation areas.',
      sidebarPrimaryForeground: 'Text and icons inside primary left-navigation controls.',
      sidebarAccent: 'Reserved for hovered or selected items inside left navigation areas.',
      sidebarAccentForeground: 'Text and icons inside hovered or selected left-navigation items.',
      sidebarBorder: 'Borders and dividers inside or around left navigation areas.',
      sidebarRing: 'The keyboard-focus highlight for left-navigation controls.'
    },
    action: {
      customize: 'Customize…',
      new: 'New theme',
      duplicate: 'Duplicate to edit',
      rename: 'Rename',
      delete: 'Delete',
      reset: 'Reset to default',
      import: 'Import…',
      export: 'Export…',
      confirm: 'Save',
      apply: 'Apply theme',
      cancel: 'Cancel'
    },
    delete: {
      title: 'Delete theme "{{name}}"?',
      description: 'This custom theme will be permanently deleted. If it is active, the interface will automatically switch to the default theme. This cannot be undone.',
      confirm: 'Delete theme'
    },
    background: {
      description: 'Controls the outer window and workspace surface; it is separate from Page base background.',
      solid: 'Solid background',
      gradient: 'Gradient background',
      stop: 'Gradient stop',
      angle: 'Gradient direction',
      addStop: 'Add gradient stop'
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
      label: 'Theme name',
      placeholder: 'Theme name'
    },
    hint: {
      realtimePreview: 'Changes preview live. Save to keep them.',
      emptyCustom: 'No custom themes yet.'
    },
    error: {
      invalidId: 'Unknown theme ID',
      nameRequired: 'Theme name is required',
      libraryFull: 'Theme library is full',
      parseFailed: 'Could not import this theme file',
      dirtyConfirm: 'Discard unsaved changes?'
    }
  }
} as const
