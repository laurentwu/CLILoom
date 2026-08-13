!ifndef BUILD_UNINSTALLER
!include "nsDialogs.nsh"

Var DesktopShortcutPage
Var DesktopShortcutCheckbox
Var CreateDesktopShortcut
Var SkipDesktopShortcutPage

; 自定义脚本早于 NSIS 语言宏加载，使用明确 LCID 避免未定义的语言常量。
LangString desktopShortcutPageDescription 1033 "Choose whether Setup should create a desktop shortcut."
LangString desktopShortcutPageDescription 2052 "选择安装程序是否创建桌面快捷方式。"
LangString desktopShortcutCheckboxLabel 1033 "Create a desktop shortcut"
LangString desktopShortcutCheckboxLabel 2052 "创建桌面快捷方式"

!macro customInit
  ; 新安装和静默安装默认创建快捷方式；交互式安装可在选项页取消。
  StrCpy $CreateDesktopShortcut ${BST_CHECKED}
  StrCpy $SkipDesktopShortcutPage "false"
  ${If} ${isUpdated}
  ${OrIf} ${Silent}
    StrCpy $SkipDesktopShortcutPage "true"
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Function createDesktopShortcutPage
    ; 更新沿用既有快捷方式状态，不重复询问或改写用户之前的选择。
    StrCmp $SkipDesktopShortcutPage "true" 0 +2
    Abort

    !insertmacro MUI_HEADER_TEXT "$(chooseInstallationOptions)" "$(desktopShortcutPageDescription)"
    nsDialogs::Create 1018
    Pop $DesktopShortcutPage
    ${If} $DesktopShortcutPage == error
      Abort
    ${EndIf}

    ${NSD_CreateCheckbox} 0u 20u 100% 12u "$(desktopShortcutCheckboxLabel)"
    Pop $DesktopShortcutCheckbox
    ${NSD_Check} $DesktopShortcutCheckbox

    nsDialogs::Show
  FunctionEnd

  Function leaveDesktopShortcutPage
    ${NSD_GetState} $DesktopShortcutCheckbox $CreateDesktopShortcut
  FunctionEnd

  Page custom createDesktopShortcutPage leaveDesktopShortcutPage
!macroend

!macro customInstall
  ; electron-builder 的内置快捷方式开关无法展示复选框，因此在用户确认后创建。
  ${IfNot} ${isUpdated}
  ${AndIfNot} ${isNoDesktopShortcut}
  ${AndIf} $CreateDesktopShortcut == ${BST_CHECKED}
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${EndIf}
!macroend
!endif

!macro customUnInstall
  ; 应用更新通过 --keep-shortcuts 保留现状，普通卸载才移除桌面快捷方式。
  ${IfNot} ${isKeepShortcuts}
    WinShell::UninstShortcut "$oldDesktopLink"
    Delete "$oldDesktopLink"
  ${EndIf}
!macroend
