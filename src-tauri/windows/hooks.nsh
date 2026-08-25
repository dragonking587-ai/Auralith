!macro NSIS_HOOK_POSTINSTALL
  ; Register Auralith Virtual Camera (DirectShow softcam.dll) system-wide when possible.
  ; Requires elevated installer for HKLM filter registration.
  IfFileExists "$INSTDIR\softcam.dll" 0 auralith_vcam_skip
    nsExec::ExecToLog 'regsvr32 /s "$INSTDIR\softcam.dll"'
  auralith_vcam_skip:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  IfFileExists "$INSTDIR\softcam.dll" 0 auralith_vcam_unreg_skip
    nsExec::ExecToLog 'regsvr32 /s /u "$INSTDIR\softcam.dll"'
  auralith_vcam_unreg_skip:
!macroend
