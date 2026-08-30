!include LogicLib.nsh
!macro NSIS_HOOK_POSTINSTALL
  ${If} ${Silent}
    Exec '"$INSTDIR\Auralith Reborn Preview.exe"'
  ${EndIf}
!macroend
