; Auralith NSIS installer hooks — safe softcam.dll upgrade on overwrite installs.
; Order: PREINSTALL (before file copy) → Tauri file install → POSTINSTALL
; Do not offer Ignore for softcam.dll: mismatched VCam DLLs break OBS/TikTok.

; ---------------------------------------------------------------------------
; PREINSTALL — free locked softcam.dll BEFORE the installer writes files
; ---------------------------------------------------------------------------
!macro NSIS_HOOK_PREINSTALL
  DetailPrint "[Auralith Installer] Existing installation check"
  DetailPrint "[Auralith Installer] Checking virtual camera"

  ; Close Auralith so the in-process Softcam sender releases the DLL
  DetailPrint "[Auralith Installer] Stopping Auralith if running"
  nsExec::ExecToLog 'taskkill /IM Auralith.exe /T'
  Sleep 1200
  nsExec::ExecToLog 'taskkill /F /IM Auralith.exe /T'
  Sleep 600

auralith_pre_retry:
  ; --- $INSTDIR\softcam.dll (staged path used by in-app registration) ---
  IfFileExists "$INSTDIR\softcam.dll" 0 auralith_pre_try_resources
    DetailPrint "[Auralith Installer] softcam.dll present: $INSTDIR\softcam.dll"
    DetailPrint "[Auralith Installer] Unregistering previous virtual camera"
    nsExec::ExecToLog '"$SYSDIR\regsvr32.exe" /s /u "$INSTDIR\softcam.dll"'
    Sleep 400
    ClearErrors
    Delete "$INSTDIR\softcam.dll"
    IfErrors 0 auralith_pre_try_resources
      DetailPrint "[Auralith Installer] Delete failed — trying rename"
      ClearErrors
      Delete "$INSTDIR\softcam.dll.old"
      Rename "$INSTDIR\softcam.dll" "$INSTDIR\softcam.dll.old"
      IfErrors 0 auralith_pre_try_resources
        DetailPrint "[Auralith Installer] softcam.dll locked"
        Goto auralith_pre_locked

auralith_pre_try_resources:
  ; --- $INSTDIR\resources\softcam.dll (Tauri resource layout) ---
  IfFileExists "$INSTDIR\resources\softcam.dll" 0 auralith_pre_ok
    DetailPrint "[Auralith Installer] softcam.dll present: $INSTDIR\resources\softcam.dll"
    nsExec::ExecToLog '"$SYSDIR\regsvr32.exe" /s /u "$INSTDIR\resources\softcam.dll"'
    Sleep 400
    ClearErrors
    Delete "$INSTDIR\resources\softcam.dll"
    IfErrors 0 auralith_pre_ok
      ClearErrors
      Delete "$INSTDIR\resources\softcam.dll.old"
      Rename "$INSTDIR\resources\softcam.dll" "$INSTDIR\resources\softcam.dll.old"
      IfErrors 0 auralith_pre_ok
        DetailPrint "[Auralith Installer] resources\softcam.dll locked"
        Goto auralith_pre_locked

auralith_pre_ok:
  DetailPrint "[Auralith Installer] softcam.dll available for replacement"
  Goto auralith_pre_done

auralith_pre_locked:
  DetailPrint "[Auralith Installer] softcam.dll locked — prompting user"
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION \
    "Auralith Virtual Camera is currently in use (softcam.dll is locked).$\r$\n$\r$\nPlease close applications using Auralith Virtual Camera, such as:$\r$\n  • OBS Studio$\r$\n  • Streamlabs$\r$\n  • TikTok LIVE Studio$\r$\n  • Auralith$\r$\n$\r$\nThen click Retry.$\r$\n$\r$\nInstallation cannot use Ignore — the virtual camera component must be updated safely." \
    IDRETRY auralith_pre_retry IDCANCEL auralith_pre_abort

auralith_pre_abort:
  DetailPrint "[Auralith Installer] Aborted — softcam.dll still locked"
  MessageBox MB_OK|MB_ICONSTOP \
    "Installation stopped.$\r$\n$\r$\nClose any app using Auralith Virtual Camera, then run the installer again."
  Abort

auralith_pre_done:
  DetailPrint "[Auralith Installer] Pre-install complete"
!macroend

; ---------------------------------------------------------------------------
; POSTINSTALL — stage + register new softcam.dll
; ---------------------------------------------------------------------------
!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "[Auralith Installer] Post-install — virtual camera"

  StrCpy $0 "$INSTDIR\resources\softcam.dll"
  IfFileExists "$0" auralith_post_have 0
  StrCpy $0 "$INSTDIR\softcam.dll"
  IfFileExists "$0" auralith_post_have 0
  DetailPrint "[Auralith Installer] softcam.dll missing from package"
  Goto auralith_post_cleanup

auralith_post_have:
  DetailPrint "[Auralith Installer] softcam.dll found: $0"
  ; Stage a stable copy next to Auralith.exe for in-app registration
  StrCmp "$0" "$INSTDIR\softcam.dll" auralith_post_reg 0
    ClearErrors
    CopyFiles /SILENT "$0" "$INSTDIR\softcam.dll"
    IfErrors auralith_post_reg 0
      StrCpy $0 "$INSTDIR\softcam.dll"

auralith_post_reg:
  DetailPrint "[Auralith Installer] Registering new virtual camera"
  nsExec::ExecToLog '"$SYSDIR\regsvr32.exe" /s "$0"'
  nsExec::ExecToLog 'reg query HKCR\CLSID\{A11A11A1-5A11-4A11-B111-A11A11A11A11}'
  DetailPrint "[Auralith Installer] Registration attempted (elevated in-app Install may still be required on currentUser installs)"

auralith_post_cleanup:
  Delete "$INSTDIR\softcam.dll.old"
  Delete "$INSTDIR\resources\softcam.dll.old"
  DetailPrint "[Auralith Installer] Installation complete"
!macroend

; ---------------------------------------------------------------------------
; PREUNINSTALL
; ---------------------------------------------------------------------------
!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "[Auralith Installer] Pre-uninstall — stop Auralith and unregister VCam"
  nsExec::ExecToLog 'taskkill /IM Auralith.exe /T'
  Sleep 800
  nsExec::ExecToLog 'taskkill /F /IM Auralith.exe /T'
  Sleep 400

  IfFileExists "$INSTDIR\softcam.dll" 0 auralith_un_res
    nsExec::ExecToLog '"$SYSDIR\regsvr32.exe" /s /u "$INSTDIR\softcam.dll"'
auralith_un_res:
  IfFileExists "$INSTDIR\resources\softcam.dll" 0 auralith_un_done
    nsExec::ExecToLog '"$SYSDIR\regsvr32.exe" /s /u "$INSTDIR\resources\softcam.dll"'
auralith_un_done:
!macroend
