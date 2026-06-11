!include MUI2.nsh

; Install Directory page — show only in interactive installs
!define MUI_PAGE_CUSTOMFUNCTION_PRE PageCheckSilent
!insertmacro MUI_PAGE_DIRECTORY

Function PageCheckSilent
  ; Skip directory page in silent/passive mode, use default path
  IfSilent +2 +1
  Abort  ; non-silent → show page
FunctionEnd

Function .onVerifyInstDir
  ; Verify the selected install path
  IfFileExists "$INSTDIR\*.*" 0 +2
  Abort  ; dir exists → allow overwrite (old version will auto-uninstall)
FunctionEnd

; Store install directory in registry for future uninstall detection
!macro CustomInstall
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" \
    "InstallLocation" "$INSTDIR"
!macroend
