; Override electron-builder's hidden details after its common header is loaded.
!macro customHeader
  ShowInstDetails show
!macroend

; The install section resets detail output to 'none' before this hook.
; Re-enable it and retain electron-builder's original process checks.
!include "getProcessInfo.nsh"
Var pid
!macro customCheckAppRunning
  SetDetailsPrint both
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
!macroend
