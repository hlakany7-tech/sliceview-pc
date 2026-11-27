; Sliceview for Windows: installer and uninstaller (NSIS 3, Modern UI 2).
; Built by scripts/build-installer.mjs from dist/win-unpacked; it passes VERSION, SRC_DIR, OUT_FILE and,
; for the all-users installer, ALLUSERS. Without ALLUSERS it is a per-user install that needs no admin rights.
;
; Silent use:  Sliceview-Setup-x.y.z-x64.exe /S [/D=C:\path]      Uninstall:  "Uninstall Sliceview.exe" /S

Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
ManifestDPIAware true
ManifestSupportedOS all

!ifndef VERSION
  !error "VERSION is not defined"
!endif
!define APP_NAME "Sliceview"
!define APP_EXE "Sliceview.exe"
!define APP_ID "com.sliceview.pc"
!define PUBLISHER "Sliceview"
!define PROGID "Sliceview.DICOM"
!define UNINST_EXE "Uninstall Sliceview.exe"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"
!define APP_KEY "Software\Sliceview"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"
!include "WinVer.nsh"

Name "${APP_NAME}"
OutFile "${OUT_FILE}"
BrandingText "${APP_NAME} ${VERSION}"
!ifdef ALLUSERS
  RequestExecutionLevel admin
  InstallDir "$PROGRAMFILES64\${APP_NAME}"
  InstallDirRegKey HKLM "${APP_KEY}" "InstallDir"
  !define ROOTKEY HKLM
!else
  RequestExecutionLevel user
  InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
  InstallDirRegKey HKCU "${APP_KEY}" "InstallDir"
  !define ROOTKEY HKCU
!endif

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "${APP_NAME} Setup"
VIAddVersionKey "CompanyName" "${PUBLISHER}"
VIAddVersionKey "LegalCopyright" "Copyright (c) 2026 ${PUBLISHER}"

; ---------- pages ----------
!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEFINISHPAGE_BITMAP "${WIZARD_BMP}"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${WIZARD_BMP}"
!define MUI_WELCOMEPAGE_TITLE "Welcome to ${APP_NAME} ${VERSION} Setup"
!ifdef ALLUSERS
  !define WHO_TEXT "It will be available to all users of this computer."
!else
  !define WHO_TEXT "It is installed for you only and does not need administrator rights."
!endif
!define MUI_WELCOMEPAGE_TEXT "This will install ${APP_NAME} ${VERSION}, a fast DICOM viewer for CT and MRI, on your computer.$\r$\n$\r$\n${WHO_TEXT}$\r$\n$\r$\nIf an older version is installed it is updated; your settings are kept.$\r$\n$\r$\nClick Next to continue."
!define MUI_COMPONENTSPAGE_SMALLDESC
!ifndef ALLUSERS ; an elevated installer would start the app as administrator
  !define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
  !define MUI_FINISHPAGE_RUN_TEXT "Start ${APP_NAME} now"
!endif

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

; ---------- helpers ----------
!macro CloseRunningApp UN
  Function ${UN}CloseRunningApp
    ; Sliceview must not be running while its files are replaced or removed.
    StrCpy $R1 0
    loop:
      nsExec::ExecToStack '"$SYSDIR\cmd.exe" /c tasklist /FI "IMAGENAME eq ${APP_EXE}" /NH | "$SYSDIR\find.exe" /I "${APP_EXE}"'
      Pop $R0 ; exit code 0: found
      Pop $R2
      ${If} $R0 != 0
        Return
      ${EndIf}
      ${If} $R1 == 0
      ${AndIfNot} ${Silent}
        MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "${APP_NAME} is running. Click OK to close it and continue, or Cancel to stop." IDOK +2
        Abort
      ${EndIf}
      nsExec::Exec '"$SYSDIR\taskkill.exe" /IM "${APP_EXE}" /T'
      Sleep 1500
      IntOp $R1 $R1 + 1
      ${If} $R1 > 3
        nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM "${APP_EXE}" /T'
        Sleep 1000
        Return
      ${EndIf}
      Goto loop
  FunctionEnd
!macroend
!insertmacro CloseRunningApp ""
!insertmacro CloseRunningApp "un."

!macro RefreshShell
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)' ; SHCNE_ASSOCCHANGED
!macroend

; ---------- install ----------
Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "${APP_NAME} needs a 64-bit version of Windows." /SD IDOK
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "${APP_NAME} needs Windows 10 or later." /SD IDOK
    Abort
  ${EndIf}
  SetRegView 64
!ifdef ALLUSERS
  SetShellVarContext all
!else
  SetShellVarContext current
!endif
FunctionEnd

Section "${APP_NAME} (required)" SecApp
  SectionIn RO
  Call CloseRunningApp
  SetOutPath "$INSTDIR"
  ; An update replaces the program files entirely (no stale files from an older version).
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  File /r "${SRC_DIR}\*.*"
  WriteUninstaller "$INSTDIR\${UNINST_EXE}"

  CreateShortcut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0 SW_SHOWNORMAL "" "Fast DICOM viewer"

  WriteRegStr ${ROOTKEY} "${APP_KEY}" "InstallDir" "$INSTDIR"
  WriteRegStr ${ROOTKEY} "${APP_KEY}" "Version" "${VERSION}"

  ; Programs and Features
  WriteRegStr ${ROOTKEY} "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr ${ROOTKEY} "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr ${ROOTKEY} "${UNINST_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr ${ROOTKEY} "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE},0"
  WriteRegStr ${ROOTKEY} "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr ${ROOTKEY} "${UNINST_KEY}" "UninstallString" '"$INSTDIR\${UNINST_EXE}"'
  WriteRegStr ${ROOTKEY} "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\${UNINST_EXE}" /S'
  WriteRegDWORD ${ROOTKEY} "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD ${ROOTKEY} "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD ${ROOTKEY} "${UNINST_KEY}" "EstimatedSize" "$0"

  ; "Open with" support for any file, and the app's own entry
  WriteRegStr ${ROOTKEY} "Software\Classes\Applications\${APP_EXE}" "FriendlyAppName" "${APP_NAME}"
  WriteRegStr ${ROOTKEY} "Software\Classes\Applications\${APP_EXE}\DefaultIcon" "" "$INSTDIR\${APP_EXE},0"
  WriteRegStr ${ROOTKEY} "Software\Classes\Applications\${APP_EXE}\shell\open\command" "" '"$INSTDIR\${APP_EXE}" "%1"'
  WriteRegStr ${ROOTKEY} "Software\Classes\Applications\${APP_EXE}\SupportedTypes" ".dcm" ""
  WriteRegStr ${ROOTKEY} "Software\Classes\Applications\${APP_EXE}\SupportedTypes" ".dicom" ""
  WriteRegStr ${ROOTKEY} "Software\Classes\Applications\${APP_EXE}\SupportedTypes" ".zip" ""
  WriteRegStr ${ROOTKEY} "Software\Classes\${PROGID}" "" "DICOM image"
  WriteRegStr ${ROOTKEY} "Software\Classes\${PROGID}\DefaultIcon" "" "$INSTDIR\${APP_EXE},0"
  WriteRegStr ${ROOTKEY} "Software\Classes\${PROGID}\shell\open\command" "" '"$INSTDIR\${APP_EXE}" "%1"'
SectionEnd

Section "Desktop shortcut" SecDesktop
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0 SW_SHOWNORMAL "" "Fast DICOM viewer"
SectionEnd

Section "Open .dcm files with ${APP_NAME}" SecAssoc
  ; Registered as a handler; Windows still lets the user pick the default the first time (Windows 10/11 rule).
  WriteRegStr ${ROOTKEY} "Software\Classes\.dcm" "" "${PROGID}"
  WriteRegStr ${ROOTKEY} "Software\Classes\.dcm\OpenWithProgids" "${PROGID}" ""
  WriteRegStr ${ROOTKEY} "Software\Classes\.dicom" "" "${PROGID}"
  WriteRegStr ${ROOTKEY} "Software\Classes\.dicom\OpenWithProgids" "${PROGID}" ""
  WriteRegStr ${ROOTKEY} "${APP_KEY}" "Associated" "1"
  !insertmacro RefreshShell
SectionEnd

Section "$\"Open with ${APP_NAME}$\" on folders and drives" SecFolder
  ; For DICOM CDs, USB sticks and PACS exports: right-click the folder or drive.
  WriteRegStr ${ROOTKEY} "Software\Classes\Directory\shell\Sliceview" "" "Open with ${APP_NAME}"
  WriteRegStr ${ROOTKEY} "Software\Classes\Directory\shell\Sliceview" "Icon" "$INSTDIR\${APP_EXE},0"
  WriteRegStr ${ROOTKEY} "Software\Classes\Directory\shell\Sliceview\command" "" '"$INSTDIR\${APP_EXE}" "%1"'
  WriteRegStr ${ROOTKEY} "Software\Classes\Drive\shell\Sliceview" "" "Open with ${APP_NAME}"
  WriteRegStr ${ROOTKEY} "Software\Classes\Drive\shell\Sliceview" "Icon" "$INSTDIR\${APP_EXE},0"
  WriteRegStr ${ROOTKEY} "Software\Classes\Drive\shell\Sliceview\command" "" '"$INSTDIR\${APP_EXE}" "%1"'
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecApp} "The viewer itself, a Start menu shortcut and an uninstaller."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "A shortcut on the desktop."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecAssoc} "Double-click .dcm and .dicom files to open them in ${APP_NAME}."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecFolder} "Right-click a folder, CD or USB drive and open the DICOM study inside."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ---------- uninstall ----------
Function un.onInit
  SetRegView 64
!ifdef ALLUSERS
  SetShellVarContext all
!else
  SetShellVarContext current
!endif
FunctionEnd

Section "Uninstall"
  Call un.CloseRunningApp
  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  Delete "$DESKTOP\${APP_NAME}.lnk"

  ; Only remove associations that still point at this app.
  ReadRegStr $0 ${ROOTKEY} "Software\Classes\.dcm" ""
  ${If} $0 == "${PROGID}"
    DeleteRegValue ${ROOTKEY} "Software\Classes\.dcm" ""
  ${EndIf}
  ReadRegStr $0 ${ROOTKEY} "Software\Classes\.dicom" ""
  ${If} $0 == "${PROGID}"
    DeleteRegValue ${ROOTKEY} "Software\Classes\.dicom" ""
  ${EndIf}
  DeleteRegValue ${ROOTKEY} "Software\Classes\.dcm\OpenWithProgids" "${PROGID}"
  DeleteRegValue ${ROOTKEY} "Software\Classes\.dicom\OpenWithProgids" "${PROGID}"
  DeleteRegKey /ifempty ${ROOTKEY} "Software\Classes\.dcm\OpenWithProgids"
  DeleteRegKey /ifempty ${ROOTKEY} "Software\Classes\.dcm"
  DeleteRegKey /ifempty ${ROOTKEY} "Software\Classes\.dicom\OpenWithProgids"
  DeleteRegKey /ifempty ${ROOTKEY} "Software\Classes\.dicom"
  DeleteRegKey ${ROOTKEY} "Software\Classes\${PROGID}"
  DeleteRegKey ${ROOTKEY} "Software\Classes\Applications\${APP_EXE}"
  DeleteRegKey ${ROOTKEY} "Software\Classes\Directory\shell\Sliceview"
  DeleteRegKey ${ROOTKEY} "Software\Classes\Drive\shell\Sliceview"
  DeleteRegKey ${ROOTKEY} "${UNINST_KEY}"
  DeleteRegKey ${ROOTKEY} "${APP_KEY}"
  !insertmacro RefreshShell

  ; Only the files this installer put there (never a whole folder the user may have chosen by mistake).
  !include "${FILES_NSH}"
  Delete "$INSTDIR\${UNINST_EXE}"
  RMDir "$INSTDIR"

  ; Settings, logs and the kept copy of the last study belong to each user; ask before removing them.
  IfSilent done
  SetShellVarContext current
  IfFileExists "$APPDATA\${APP_NAME}\*.*" 0 done
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also remove your ${APP_NAME} settings and the saved copy of the last study?$\r$\n($APPDATA\${APP_NAME})" IDNO done
  RMDir /r "$APPDATA\${APP_NAME}"
  done:
SectionEnd
