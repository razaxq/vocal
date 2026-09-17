Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
Name "Vocal Native"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\VocalNative"
InstallDirRegKey HKCU "Software\VocalNative" "InstallDir"
BrandingText "Vocal · Ramos"
SetFont "Microsoft YaHei UI" 9
ShowInstDetails show
ShowUninstDetails show
VIProductVersion "${PRODUCT_VERSION}.0"
VIAddVersionKey "ProductName" "Vocal Native"
VIAddVersionKey "CompanyName" "Ramos"
VIAddVersionKey "FileDescription" "Vocal Native Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Copyright 2026 Ramos"
!include "MUI2.nsh"
!include "FileFunc.nsh"
Var AppUpdate
Var WaitPid

Function .onInit
    StrCpy $AppUpdate 0
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "/APPUPDATE" $R1
    IfErrors init_done
    StrCpy $AppUpdate 1
    SetSilent silent
    ClearErrors
    ${GetOptions} $R0 "/WAITPID=" $WaitPid
    IfErrors init_done
    ; The parent shuts down its model workers before exiting. Wait for that
    ; process to release the EXE and runtime DLLs before replacing any files.
    System::Call 'kernel32::OpenProcess(i 0x100000, i 0, i $WaitPid) p.r1'
    StrCmp $1 0 init_done
    System::Call 'kernel32::WaitForSingleObject(p r1, i 60000) i.r2'
    System::Call 'kernel32::CloseHandle(p r1)'
    StrCmp $2 0 init_done
    SetErrorLevel 2
    Abort
init_done:
FunctionEnd

Function .onInstSuccess
    StrCmp $AppUpdate 1 0 success_done
    Exec '"$INSTDIR\vocal-native.exe"'
success_done:
FunctionEnd
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\vocal-native.exe"
!define MUI_FINISHPAGE_RUN_TEXT "$(LaunchVocal)"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"
LangString LaunchVocal ${LANG_SIMPCHINESE} "启动 Vocal"
LangString LaunchVocal ${LANG_ENGLISH} "Launch Vocal"
Section "Vocal Native"
    SetOutPath "$INSTDIR"
    File /r /x uninstall-files.nsh "${APP_DIR}\*"
    WriteUninstaller "$INSTDIR\Uninstall.exe"
    CreateShortcut "$SMPROGRAMS\Vocal Native.lnk" "$INSTDIR\vocal-native.exe"
    WriteRegStr HKCU "Software\VocalNative" "InstallDir" "$INSTDIR"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VocalNative" "DisplayName" "Vocal Native"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VocalNative" "DisplayVersion" "${VERSION}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VocalNative" "Publisher" "Ramos"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VocalNative" "URLInfoAbout" "https://blog.dtft.net/about/"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VocalNative" "HelpLink" "https://github.com/razaxq/vocal/issues"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VocalNative" "UninstallString" '"$INSTDIR\Uninstall.exe"'
SectionEnd
Section "Uninstall"
    Delete "$SMPROGRAMS\Vocal Native.lnk"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "VocalNative"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VocalNative"
    DeleteRegKey HKCU "Software\VocalNative"
    ; Only remove files shipped by this installer. User models/settings/history
    ; live in AppData and are preserved, as are unrelated files in INSTDIR.
    !include "${APP_DIR}\uninstall-files.nsh"
    Delete "$INSTDIR\Uninstall.exe"
    RMDir "$INSTDIR"
SectionEnd
