; Auralith NSIS hooks — upgrade must NEVER hang on Softcam unregister.
;
; Test 13 hang: nsExec::ExecToLog waited forever on
;   regsvr32 /s /u softcam.dll
; when DllUnregisterServer blocked with the DLL still loaded.
;
; Fix:
;   • Close Auralith only (never kill OBS/Streamlabs/TikTok)
;   • Remove COM CLSID with "reg delete" (does not load softcam.dll)
;   • Any regsvr32 uses PowerShell WaitForExit(12000) — kill only that process
;   • Delete/rename softcam.dll; if locked → Retry/Cancel (no Ignore)

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "[Installer] PREINSTALL started"
  DetailPrint "[Installer] Closing Auralith"
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process Auralith -EA SilentlyContinue | ForEach-Object { try { $_.CloseMainWindow() | Out-Null } catch {} }; Start-Sleep -Milliseconds 800; Get-Process Auralith -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue; exit 0"'
  Pop $R0
  DetailPrint "[Installer] Auralith closed"

auralith_pre_retry:
  ; Registry-only cleanup — does NOT load softcam.dll (avoids DllUnregisterServer hang)
  DetailPrint "[Installer] Removing previous COM CLSID via reg delete (no DLL load)"
  nsExec::ExecToLog 'cmd /c reg delete "HKCR\CLSID\{A11A11A1-5A11-4A11-B111-A11A11A11A11}" /f >nul 2>&1'
  Pop $R0
  nsExec::ExecToLog 'cmd /c reg delete "HKCU\Software\Classes\CLSID\{A11A11A1-5A11-4A11-B111-A11A11A11A11}" /f >nul 2>&1'
  Pop $R0
  DetailPrint "[Installer] Registry cleanup finished"

  ; Optional timed regsvr32 /u (12s max) — best-effort only; never block forever
  IfFileExists "$INSTDIR\softcam.dll" 0 auralith_pre_del_inst
    DetailPrint "[Installer] Starting Softcam timed unregister (max 12s)"
    DetailPrint "[Installer] regsvr32 process started (unregister)"
    nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$dll=''$INSTDIR\softcam.dll''; $$p=Start-Process -FilePath (Join-Path $$env:SystemRoot ''System32\regsvr32.exe'') -ArgumentList ''/s'',''/u'',$$dll -PassThru -WindowStyle Hidden; if(-not $$p.WaitForExit(12000)){ try{$$p.Kill()}catch{}; Write-Output ''timeout''; exit 124 }; Write-Output (''exit='' + $$p.ExitCode); exit $$p.ExitCode"'
    Pop $R0
    DetailPrint "[Installer] Unregister exit code: $R0"
    DetailPrint "[Installer] Unregister complete (or timed out)"

auralith_pre_del_inst:
  DetailPrint "[Installer] Attempting softcam.dll delete"
  IfFileExists "$INSTDIR\softcam.dll" 0 auralith_pre_res
    ClearErrors
    Delete "$INSTDIR\softcam.dll"
    IfErrors 0 auralith_pre_res
      DetailPrint "[Installer] Delete failed — trying rename"
      ClearErrors
      Delete "$INSTDIR\softcam.dll.old"
      Rename "$INSTDIR\softcam.dll" "$INSTDIR\softcam.dll.old"
      IfErrors 0 auralith_pre_res
        DetailPrint "[Installer] softcam.dll locked"
        Goto auralith_pre_locked

auralith_pre_res:
  IfFileExists "$INSTDIR\resources\softcam.dll" 0 auralith_pre_ok
    DetailPrint "[Installer] Timed unregister resources path (max 12s)"
    nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$dll=''$INSTDIR\resources\softcam.dll''; $$p=Start-Process -FilePath (Join-Path $$env:SystemRoot ''System32\regsvr32.exe'') -ArgumentList ''/s'',''/u'',$$dll -PassThru -WindowStyle Hidden; if(-not $$p.WaitForExit(12000)){ try{$$p.Kill()}catch{}; exit 124 }; exit $$p.ExitCode"'
    Pop $R0
    DetailPrint "[Installer] resources unregister exit: $R0"
    ClearErrors
    Delete "$INSTDIR\resources\softcam.dll"
    IfErrors 0 auralith_pre_ok
      ClearErrors
      Delete "$INSTDIR\resources\softcam.dll.old"
      Rename "$INSTDIR\resources\softcam.dll" "$INSTDIR\resources\softcam.dll.old"
      IfErrors 0 auralith_pre_ok
        DetailPrint "[Installer] resources\softcam.dll locked"
        Goto auralith_pre_locked

auralith_pre_ok:
  DetailPrint "[Installer] softcam.dll available for replacement"
  Goto auralith_pre_done

auralith_pre_locked:
  DetailPrint "[Installer] softcam.dll still locked after timed cleanup"
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION \
    "Auralith Virtual Camera could not be unregistered/replaced.$\r$\n$\r$\nThe previous virtual-camera component may still be in use.$\r$\n$\r$\nPlease close OBS, Streamlabs, TikTok LIVE Studio and Auralith, then click Retry.$\r$\n$\r$\nDo not leave those apps using Auralith Virtual Camera during upgrade." \
    IDRETRY auralith_pre_retry IDCANCEL auralith_pre_abort

auralith_pre_abort:
  DetailPrint "[Installer] Aborted — softcam.dll locked"
  MessageBox MB_OK|MB_ICONSTOP \
    "Installation stopped.$\r$\n$\r$\nClose any app using Auralith Virtual Camera, then run the installer again."
  Abort

auralith_pre_done:
  DetailPrint "[Installer] PREINSTALL complete"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "[Installer] POSTINSTALL started"

  StrCpy $0 "$INSTDIR\resources\softcam.dll"
  IfFileExists "$0" auralith_post_have 0
  StrCpy $0 "$INSTDIR\softcam.dll"
  IfFileExists "$0" auralith_post_have 0
  DetailPrint "[Installer] softcam.dll missing from package"
  Goto auralith_post_cleanup

auralith_post_have:
  DetailPrint "[Installer] softcam.dll found: $0"
  StrCmp "$0" "$INSTDIR\softcam.dll" auralith_post_reg 0
    ClearErrors
    CopyFiles /SILENT "$0" "$INSTDIR\softcam.dll"
    IfErrors auralith_post_reg 0
      StrCpy $0 "$INSTDIR\softcam.dll"

auralith_post_reg:
  DetailPrint "[Installer] Registering new virtual camera (timed, max 12s)"
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$dll=''$0''; $$p=Start-Process -FilePath (Join-Path $$env:SystemRoot ''System32\regsvr32.exe'') -ArgumentList ''/s'',$$dll -PassThru -WindowStyle Hidden; if(-not $$p.WaitForExit(12000)){ try{$$p.Kill()}catch{}; exit 124 }; exit $$p.ExitCode"'
  Pop $R0
  DetailPrint "[Installer] Register exit code: $R0"
  nsExec::ExecToLog 'cmd /c reg query "HKCR\CLSID\{A11A11A1-5A11-4A11-B111-A11A11A11A11}" >nul 2>&1'
  Pop $R0
  DetailPrint "[Installer] CLSID query exit: $R0"

auralith_post_cleanup:
  Delete "$INSTDIR\softcam.dll.old"
  Delete "$INSTDIR\resources\softcam.dll.old"
  DetailPrint "[Installer] Installation complete"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "[Installer] PREUNINSTALL started"
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process Auralith -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue; exit 0"'
  Pop $R0
  nsExec::ExecToLog 'cmd /c reg delete "HKCR\CLSID\{A11A11A1-5A11-4A11-B111-A11A11A11A11}" /f >nul 2>&1'
  Pop $R0
  IfFileExists "$INSTDIR\softcam.dll" 0 auralith_un_res
    nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$dll=''$INSTDIR\softcam.dll''; $$p=Start-Process -FilePath (Join-Path $$env:SystemRoot ''System32\regsvr32.exe'') -ArgumentList ''/s'',''/u'',$$dll -PassThru -WindowStyle Hidden; if(-not $$p.WaitForExit(12000)){ try{$$p.Kill()}catch{}; exit 124 }; exit $$p.ExitCode"'
    Pop $R0
auralith_un_res:
  IfFileExists "$INSTDIR\resources\softcam.dll" 0 auralith_un_done
    nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$dll=''$INSTDIR\resources\softcam.dll''; $$p=Start-Process -FilePath (Join-Path $$env:SystemRoot ''System32\regsvr32.exe'') -ArgumentList ''/s'',''/u'',$$dll -PassThru -WindowStyle Hidden; if(-not $$p.WaitForExit(12000)){ try{$$p.Kill()}catch{}; exit 124 }; exit $$p.ExitCode"'
    Pop $R0
auralith_un_done:
  DetailPrint "[Installer] PREUNINSTALL complete"
!macroend
