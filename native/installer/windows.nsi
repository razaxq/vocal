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
