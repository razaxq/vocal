Unicode true
RequestExecutionLevel user
ManifestDPIAware true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
Name "Vocal"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Vocal"
InstallDirRegKey HKCU "Software\VocalNative" "InstallDir"
BrandingText "Vocal · Ramos"
SetFont "Microsoft YaHei UI" 9
ShowInstDetails show
AutoCloseWindow true
ShowUninstDetails show
VIProductVersion "${PRODUCT_VERSION}.0"
VIAddVersionKey "ProductName" "Vocal"
VIAddVersionKey "CompanyName" "Ramos"
VIAddVersionKey "FileDescription" "Vocal Installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
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
!define MUI_ICON "${__FILEDIR__}\..\..\build\icon.ico"
!define MUI_UNICON "${__FILEDIR__}\..\..\build\icon.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "${__FILEDIR__}\header.bmp"
!define MUI_CUSTOMFUNCTION_GUIINIT DesignWindow
!insertmacro MUI_PAGE_INIT
!insertmacro MUI_PAGE_FUNCTION_FULLWINDOW
Page custom DesignStart DesignValidate
!define MUI_PAGE_CUSTOMFUNCTION_SHOW DesignProgress
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE DesignProgressLeave
!insertmacro MUI_PAGE_INSTFILES
Page custom DesignFinish DesignFinishLeave
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"
SetFont /LANG=${LANG_SIMPCHINESE} "Microsoft YaHei UI" 9
SetFont /LANG=${LANG_ENGLISH} "Segoe UI" 9
LangString LaunchVocal ${LANG_SIMPCHINESE} "打开 Vocal"
LangString LaunchVocal ${LANG_ENGLISH} "Open Vocal"
!include "${__FILEDIR__}\design.nsh"
Section "Vocal"
    SetOutPath "$INSTDIR"
    File /r /x uninstall-files.nsh "${APP_DIR}\*"
    WriteUninstaller "$INSTDIR\Uninstall.exe"
    Delete "$SMPROGRAMS\Vocal Native.lnk"
    CreateShortcut "$SMPROGRAMS\Vocal.lnk" "$INSTDIR\vocal-native.exe"
    WriteRegStr HKCU "Software\VocalNative" "InstallDir" "$INSTDIR"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VocalNative" "DisplayName" "Vocal"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VocalNative" "DisplayIcon" '"$INSTDIR\vocal-native.exe",0'
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VocalNative" "DisplayVersion" "${VERSION}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VocalNative" "Publisher" "Ramos"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VocalNative" "URLInfoAbout" "https://blog.dtft.net/about/"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VocalNative" "HelpLink" "https://github.com/razaxq/vocal/issues"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VocalNative" "UninstallString" '"$INSTDIR\Uninstall.exe"'
SectionEnd
Section "Uninstall"
    Delete "$SMPROGRAMS\Vocal.lnk"
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
