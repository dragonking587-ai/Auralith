!macro NSIS_HOOK_POSTINSTALL
  ; Locate softcam.dll (Tauri may place resources under $INSTDIR or $INSTDIR\resources)
  StrCpy $0 "$INSTDIR\softcam.dll"
  IfFileExists "$0" auralith_vcam_have 0
  StrCpy $0 "$INSTDIR\resources\softcam.dll"
  IfFileExists "$0" auralith_vcam_have 0
  Goto auralith_vcam_skip

  auralith_vcam_have:
    ; Keep a stable copy next to Auralith.exe for in-app registration
    CopyFiles /SILENT "$0" "$INSTDIR\softcam.dll"
    ; Attempt silent register. currentUser installs may lack HKLM rights —
    ; in that case the in-app "Install Virtual Camera" button elevates via UAC.
    nsExec::ExecToLog '"$SYSDIR\regsvr32.exe" /s "$INSTDIR\softcam.dll"'
  auralith_vcam_skip:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  IfFileExists "$INSTDIR\softcam.dll" 0 auralith_vcam_unreg_skip
    nsExec::ExecToLog '"$SYSDIR\regsvr32.exe" /s /u "$INSTDIR\softcam.dll"'
  auralith_vcam_unreg_skip:
!macroend
