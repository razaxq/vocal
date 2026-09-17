!include nsDialogs.nsh
Var DesignPage
Var DesignTitleFont
Var DesignHeadingFont
Var DesignTextFont
Var DesignLogo
Var DesignLogoImage
Var DesignPrimary
Var DesignPath
Var DesignLaunch
Var DesignGdiToken
Var DesignChangeButton
Var DesignChoosing
Var DesignFrameHeight
Var DesignProgressTextFont
Var DesignProgressHeadingFont
Var DesignProgressTitle
Var DesignProgressSubtitle

LangString DesignTagline ${LANG_SIMPCHINESE} "让表达更轻松"
LangString DesignTagline ${LANG_ENGLISH} "Speak. We'll do the typing."
LangString DesignDescription ${LANG_SIMPCHINESE} "按住说话，松开输入。语音在本机处理。"
LangString DesignDescription ${LANG_ENGLISH} "Hold to talk, release to type. Speech recognition stays on your PC."
LangString DesignInstall ${LANG_SIMPCHINESE} "安装"
LangString DesignInstall ${LANG_ENGLISH} "Install"
LangString DesignChange ${LANG_SIMPCHINESE} "更改位置"
LangString DesignChange ${LANG_ENGLISH} "Change folder"
LangString DesignChoosing ${LANG_SIMPCHINESE} "选择中…"
LangString DesignChoosing ${LANG_ENGLISH} "Choosing…"
LangString DesignFolder ${LANG_SIMPCHINESE} "选择 Vocal 的安装文件夹"
LangString DesignFolder ${LANG_ENGLISH} "Choose the Vocal installation folder"
LangString DesignReady ${LANG_SIMPCHINESE} "准备好开始了"
LangString DesignReady ${LANG_ENGLISH} "You're ready to go."
LangString DesignReadyBody ${LANG_SIMPCHINESE} "安装完成。打开 Vocal，下载语音模型后即可使用。"
LangString DesignReadyBody ${LANG_ENGLISH} "All set. Open Vocal and download a speech model to get started."
LangString DesignDone ${LANG_SIMPCHINESE} "完成"
LangString DesignDone ${LANG_ENGLISH} "Finish"
LangString DesignInvalidPath ${LANG_SIMPCHINESE} "此位置无法安装，请换一个文件夹。"
LangString DesignInvalidPath ${LANG_ENGLISH} "Cannot install here. Choose another folder."
LangString DesignNoSpace ${LANG_SIMPCHINESE} "空间不足，请换一个文件夹。"
LangString DesignNoSpace ${LANG_ENGLISH} "Not enough space. Choose another folder."
LangString DesignInstalling ${LANG_SIMPCHINESE} "正在安装 Vocal"
LangString DesignInstalling ${LANG_ENGLISH} "Installing Vocal"
LangString DesignInstallingBody ${LANG_SIMPCHINESE} "稍等片刻，即可开始使用。"
LangString DesignInstallingBody ${LANG_ENGLISH} "Just a moment. Vocal is getting ready."

!ifndef INSTALLER_FRAME
!define INSTALLER_FRAME "${__FILEDIR__}\..\..\data\native-installer\installer-frame.dll"
!endif

; All content uses the same 24 + 136 + 24 dialog-unit column, at any DPI.
!macro DesignPlace handle x y width height
    Push $0
    Push $1
    Push $2
    Push $3
    Push $4
    System::Call '*(i ${x}, i ${y}, i ${width}, i ${height}) p.r0'
    System::Call 'user32::MapDialogRect(p $HWNDPARENT, p r0)'
    System::Call '*$0(i.r1, i.r2, i.r3, i.r4)'
    System::Call 'user32::SetWindowPos(p ${handle}, p 0, i r1, i r2, i r3, i r4, i 0x14)'
    System::Free $0
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
!macroend

Function DesignWindow
    InitPluginsDir
    File /oname=$PLUGINSDIR\installer-frame.dll "${INSTALLER_FRAME}"
    ; Keep the frame procedure loaded until the installer process exits.
    System::Call 'kernel32::LoadLibrary(t "$PLUGINSDIR\installer-frame.dll") p.r0'
    System::Call 'kernel32::GetModuleHandle(t "kernel32.dll") p.r0'
    System::Call 'kernel32::GetProcAddress(p r0, m "GetProcAddress") p.r1'
    System::Call 'kernel32::GetProcAddress(p r0, m "GetModuleHandleW") p.r2'
    System::Call '$PLUGINSDIR\installer-frame.dll::AttachFrame(p $HWNDPARENT, p r1, p r2, i $LANGUAGE) i.r0'
    StrCpy $DesignFrameHeight $0
    System::Call '*(i 0, i 0, i 184, i 0) p.r0'
    System::Call 'user32::MapDialogRect(p $HWNDPARENT, p r0)'
    System::Call '*$0(i, i, i.r1, i)'
    System::Call 'user32::GetWindowRect(p $HWNDPARENT, p r0)'
    System::Call '*$0(i.r2, i.r3, i.r4, i.r5)'
    IntOp $4 $4 - $2
    IntOp $4 $4 - $1
    IntOp $4 $4 / 2
    IntOp $2 $2 + $4
    IntOp $5 $5 - $3
    System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i r2, i r3, i r1, i r5, i 0x34)'
    System::Free $0
FunctionEnd

Function DesignBase
    nsDialogs::Create 1044
    Pop $DesignPage
    SetCtlColors $DesignPage 303133 FFFFFF
    SetCtlColors $HWNDPARENT 303133 FFFFFF
    ; Match Main.qml: white surfaces, #67c23a accent, 8 DIP control corners.
    ; DWM owns the outer window corners/shadow; do not clip with a window region.
    System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 33, *i 2, i 4)'
    System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 2, *i 2, i 4)'
    System::Call '*(i 1, i 1, i 1, i 1) p.r0'
    System::Call 'dwmapi::DwmExtendFrameIntoClientArea(p $HWNDPARENT, p r0)'
    System::Free $0
    System::Call '*(i 1, p 0, i 0, i 0) p.r0'
    System::Call 'gdiplus::GdiplusStartup(*p.r1, p r0, p 0)'
    StrCpy $DesignGdiToken $1
    System::Free $0
    CreateFont $DesignTitleFont "Segoe UI" 22 700
    CreateFont $DesignHeadingFont "Microsoft YaHei UI" 15 700
    CreateFont $DesignTextFont "Microsoft YaHei UI" 10 400
    InitPluginsDir
    File /oname=$PLUGINSDIR\vocal.ico "${__FILEDIR__}\..\..\build\icon.ico"
    ${NSD_CreateIcon} 24u 16u 40u 40u ""
    Pop $DesignLogo
    SetCtlColors $DesignLogo 303133 FFFFFF
    System::Call 'user32::LoadImage(p 0, t "$PLUGINSDIR\vocal.ico", i 1, i 64, i 64, i 0x10) p.r0'
    StrCpy $DesignLogoImage $0
    SendMessage $DesignLogo ${STM_SETIMAGE} ${IMAGE_ICON} $DesignLogoImage
    ${NSD_CreateLabel} 76u 14u 84u 29u "Vocal"
    Pop $0
    SetCtlColors $0 303133 FFFFFF
    SendMessage $0 ${WM_SETFONT} $DesignTitleFont 0
    ${NSD_CreateLabel} 24u 50u 136u 12u "${VERSION}  ·  Ramos"
    Pop $0
    SetCtlColors $0 909399 FFFFFF
    SendMessage $0 ${WM_SETFONT} $DesignTextFont 0
    GetDlgItem $0 $HWNDPARENT 1
    ShowWindow $0 ${SW_HIDE}
    GetDlgItem $0 $HWNDPARENT 3
    ShowWindow $0 ${SW_HIDE}
    GetDlgItem $0 $HWNDPARENT 2
    ShowWindow $0 ${SW_HIDE}
    Call muiPageLoadFullWindow
    ; Cover the wizard footer so it cannot introduce a second button style.
    System::Call '*(i 0, i 0, i 0, i 0) p.r0'
    System::Call 'user32::GetClientRect(p $HWNDPARENT, p r0)'
    System::Call '*$0(i, i, i.r1, i.r2)'
    IntOp $2 $2 - $DesignFrameHeight
    System::Call 'user32::SetWindowPos(p $DesignPage, p 0, i 0, i $DesignFrameHeight, i r1, i r2, i 0x14)'
    System::Free $0
FunctionEnd

Function DesignShow
    nsDialogs::Show
    ${NSD_FreeIcon} $DesignLogoImage
    System::Call 'gdiplus::GdiplusShutdown(p $DesignGdiToken)'
    System::Call 'gdi32::DeleteObject(p $DesignTitleFont)'
    System::Call 'gdi32::DeleteObject(p $DesignHeadingFont)'
    System::Call 'gdi32::DeleteObject(p $DesignTextFont)'
    Call muiPageUnloadFullWindow
FunctionEnd

Function DesignPrimaryStyle
    SendMessage $DesignPrimary ${WM_SETFONT} $DesignTextFont 0
    ${NSD_OnNotify} $DesignPrimary DesignDrawButton
    ${NSD_OnClick} $DesignPrimary DesignNext
FunctionEnd

; NM_CUSTOMDRAW keeps real Windows buttons (Tab, Space, Enter and accessibility)
; while GDI+ draws smooth corners at the actual display DPI. No extra runtime DLL.
Function DesignDrawButton
    ; Painting can reenter while another callback enables/updates a control.
    ; Preserve its registers before consuming our notification arguments.
    System::Store S
    Pop $0 ; HWND
    Pop $1 ; notification code
    Pop $2 ; NMCUSTOMDRAW, 32-bit NSIS layout
    StrCmp $1 -12 0 default_draw
    System::Call '*$2(p, p, i, i.r3, p.r4, i, i, i.r5, i.r6, p, i.r7)'
    StrCmp $3 1 0 other_stage ; CDDS_PREPAINT
    IntOp $2 $2 + 20 ; rc
    System::Call 'gdi32::SaveDC(p r4) i.R9'
    System::Call 'gdi32::GetDeviceCaps(p r4, i 88) i.r8'
    IntOp $8 $8 * 16
    IntOp $8 $8 / 96 ; 8 DIP radius = 16 DIP diameter
    System::Call 'gdiplus::GdipCreateFromHDC(p r4, *p.r9)'
    System::Call 'gdiplus::GdipSetSmoothingMode(p r9, i 4)'
    System::Call 'gdiplus::GdipGraphicsClear(p r9, i 0xffffffff)'
    StrCmp $0 $DesignLaunch draw_toggle
    System::Call 'gdiplus::GdipCreatePath(i 0, *p.R0)'
    IntOp $5 $5 - 3
    IntOp $6 $6 - 3
    IntOp $R1 $5 - $8
    IntOp $R2 $6 - $8
    ; System has no float argument type; pass IEEE-754 bits for 180/90/270.
    System::Call 'gdiplus::GdipAddPathArcI(p R0, i 2, i 2, i r8, i r8, i 0x43340000, i 0x42b40000)'
    System::Call 'gdiplus::GdipAddPathArcI(p R0, i R1, i 2, i r8, i r8, i 0x43870000, i 0x42b40000)'
    System::Call 'gdiplus::GdipAddPathArcI(p R0, i R1, i R2, i r8, i r8, i 0, i 0x42b40000)'
    System::Call 'gdiplus::GdipAddPathArcI(p R0, i 2, i R2, i r8, i r8, i 0x42b40000, i 0x42b40000)'
    System::Call 'gdiplus::GdipClosePathFigure(p R0)'
    StrCpy $R3 0xffffffff
    StrCpy $R4 0xffe6e8eb
    StrCpy $R5 0x333130 ; #303133 text, COLORREF
    StrCmp $0 $DesignPrimary 0 secondary
    StrCpy $R3 0xff67c23a
    StrCpy $R4 0xff67c23a
    StrCpy $R5 0xffffff
    IntOp $R6 $7 & 0x40 ; CDIS_HOT
    StrCmp $R6 0 +3
    StrCpy $R3 0xff85ce61
    StrCpy $R4 0xff85ce61
    IntOp $R6 $7 & 1 ; CDIS_SELECTED
    StrCmp $R6 0 colors_ready
    StrCpy $R3 0xff5daf34
    StrCpy $R4 0xff5daf34
    Goto colors_ready
secondary:
    IntOp $R6 $7 & 0x41
    StrCmp $R6 0 colors_ready
    StrCpy $R3 0xffeef0f3
colors_ready:
    System::Call 'gdiplus::GdipCreateSolidFill(i R3, *p.R6)'
    System::Call 'gdiplus::GdipFillPath(p r9, p R6, p R0)'
    System::Call 'gdiplus::GdipDeleteBrush(p R6)'
    IntOp $R6 $7 & 0x10 ; CDIS_FOCUS: rounded green keyboard focus ring
    StrCmp $R6 0 +2
    StrCpy $R4 0xffb3e19d
    System::Call 'gdiplus::GdipCreatePen1(i R4, i 0x3fc00000, i 2, *p.R6)'
    System::Call 'gdiplus::GdipDrawPath(p r9, p R6, p R0)'
    System::Call 'gdiplus::GdipDeletePen(p R6)'
    System::Call 'gdiplus::GdipDeletePath(p R0)'
    StrCpy $R8 0x25 ; centered single-line button label
    Goto draw_text
draw_toggle:
    ; Match the QML switch: 38 x 22 DIP track and 16 DIP white thumb.
    System::Call 'gdi32::GetDeviceCaps(p r4, i 88) i.R0'
    System::Call 'kernel32::MulDiv(i 38, i R0, i 96) i.R1'
    System::Call 'kernel32::MulDiv(i 22, i R0, i 96) i.R2'
    System::Call 'kernel32::MulDiv(i 16, i R0, i 96) i.R3'
    System::Call 'kernel32::MulDiv(i 3, i R0, i 96) i.R4'
    IntOp $R5 $5 - $R1
    IntOp $R5 $R5 - 2 ; track left
    IntOp $R6 $6 - $R2
    IntOp $R6 $R6 / 2 ; track top
    IntOp $R7 $R5 + $R1
    IntOp $R7 $R7 - $R2 ; right arc left
    System::Call 'gdiplus::GdipCreatePath(i 0, *p.r8)'
    System::Call 'gdiplus::GdipAddPathArcI(p r8, i R5, i R6, i R2, i R2, i 0x42b40000, i 0x43340000)'
    System::Call 'gdiplus::GdipAddPathArcI(p r8, i R7, i R6, i R2, i R2, i 0x43870000, i 0x43340000)'
    System::Call 'gdiplus::GdipClosePathFigure(p r8)'
    ${NSD_GetState} $DesignLaunch $R0
    StrCpy $R7 0xffdcdfe6
    StrCmp $R0 ${BST_CHECKED} 0 +2
    StrCpy $R7 0xff67c23a
    System::Call 'gdiplus::GdipCreateSolidFill(i R7, *p.R8)'
    System::Call 'gdiplus::GdipFillPath(p r9, p R8, p r8)'
    System::Call 'gdiplus::GdipDeleteBrush(p R8)'
    IntOp $7 $7 & 0x10
    StrCmp $7 0 toggle_thumb
    System::Call 'gdiplus::GdipCreatePen1(i 0xffb3e19d, i 0x40000000, i 2, *p.R8)'
    System::Call 'gdiplus::GdipDrawPath(p r9, p R8, p r8)'
    System::Call 'gdiplus::GdipDeletePen(p R8)'
toggle_thumb:
    System::Call 'gdiplus::GdipDeletePath(p r8)'
    StrCmp $R0 ${BST_CHECKED} 0 toggle_off
    IntOp $R5 $R5 + $R1
    IntOp $R5 $R5 - $R3
    IntOp $R5 $R5 - $R4
    Goto toggle_positioned
toggle_off:
    IntOp $R5 $R5 + $R4
toggle_positioned:
    IntOp $R6 $R6 + $R4
    System::Call 'gdiplus::GdipCreateSolidFill(i 0xffffffff, *p.R8)'
    System::Call 'gdiplus::GdipFillEllipseI(p r9, p R8, i R5, i R6, i R3, i R3)'
    System::Call 'gdiplus::GdipDeleteBrush(p R8)'
    StrCpy $R5 0x333130
    StrCpy $R8 0x24 ; left-aligned single-line switch label
draw_text:
    System::Call 'gdiplus::GdipDeleteGraphics(p r9)'
    ${NSD_GetText} $0 $R0
    System::Call 'gdi32::SelectObject(p r4, p $DesignTextFont)'
    System::Call 'gdi32::SetBkMode(p r4, i 1)'
    System::Call 'gdi32::SetTextColor(p r4, i R5)'
    System::Call 'user32::DrawTextW(p r4, w "$R0", i -1, p r2, i R8)'
    System::Call 'gdi32::RestoreDC(p r4, i R9)'
    System::Store L
    ${NSD_Return} 4 ; CDRF_SKIPDEFAULT (no rectangular native frame)
other_stage:
default_draw:
    System::Store L
    ${NSD_Return} 0
FunctionEnd

Function DesignNext
    Pop $0
    System::Call 'user32::PostMessage(p $HWNDPARENT, i ${WM_COMMAND}, p 1, p 0)'
FunctionEnd

Function DesignStart
    Call DesignBase
    ${NSD_CreateLabel} 24u 72u 136u 25u "$(DesignTagline)"
    Pop $0
    SetCtlColors $0 303133 FFFFFF
    SendMessage $0 ${WM_SETFONT} $DesignHeadingFont 0
    ${NSD_CreateLabel} 24u 104u 136u 24u "$(DesignDescription)"
    Pop $0
    SetCtlColors $0 606266 FFFFFF
    SendMessage $0 ${WM_SETFONT} $DesignTextFont 0
    ${NSD_CreateButton} 24u 136u 136u 28u "$(DesignInstall)"
    Pop $DesignPrimary
    Call DesignPrimaryStyle
    ${NSD_CreateButton} 24u 168u 136u 22u "$(DesignChange)"
    Pop $DesignChangeButton
    SendMessage $DesignChangeButton ${WM_SETFONT} $DesignTextFont 0
    ${NSD_OnNotify} $DesignChangeButton DesignDrawButton
    ${NSD_OnClick} $DesignChangeButton DesignBrowse
    ${NSD_CreateLabel} 24u 198u 136u 13u "$INSTDIR"
    Pop $DesignPath
    SetCtlColors $DesignPath 909399 FFFFFF
    SendMessage $DesignPath ${WM_SETFONT} $DesignTextFont 0
    ${NSD_AddStyle} $DesignPath ${SS_PATHELLIPSIS}
    Call DesignShow
FunctionEnd

Function DesignBrowse
    Pop $0
    StrCmp $DesignChoosing 1 done
    System::Call '$PLUGINSDIR\installer-frame.dll::BeginFolderDialog(p $HWNDPARENT, w "$(DesignFolder)", w "$INSTDIR") i.r0'
    StrCmp $0 1 0 failed
    StrCpy $DesignChoosing 1
    EnableWindow $DesignPrimary 0
    EnableWindow $DesignChangeButton 0
    ${NSD_SetText} $DesignChangeButton "$(DesignChoosing)"
    ; Preserve modal behavior without cross-thread window ownership.
    EnableWindow $HWNDPARENT 0
    ${NSD_CreateTimer} DesignBrowseResult 50
    Return
failed:
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(DesignInvalidPath)"
done:
FunctionEnd

Function DesignBrowseResult
    System::Store S
    System::Call '$PLUGINSDIR\installer-frame.dll::PollFolderDialog(w .r1, i ${NSIS_MAX_STRLEN}) i.r0'
    StrCmp $0 0 done
    ${NSD_KillTimer} DesignBrowseResult
    StrCpy $DesignChoosing 0
    EnableWindow $DesignPrimary 1
    EnableWindow $DesignChangeButton 1
    ${NSD_SetText} $DesignChangeButton "$(DesignChange)"
    EnableWindow $HWNDPARENT 1
    StrCmp $0 4 failed
    StrCmp $0 2 0 done
    StrCpy $INSTDIR $1
    ${NSD_SetText} $DesignPath $INSTDIR
    Goto done
failed:
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(DesignInvalidPath)"
done:
    System::Store L
FunctionEnd

Function DesignValidate
    StrCmp $DesignChoosing 1 0 +2
    Abort
    StrCmp $INSTDIR "" invalid
    ${GetRoot} "$INSTDIR" $0
    StrCmp $0 "" invalid
    IfFileExists "$0\*.*" valid invalid
valid:
    System::Call 'kernel32::GetDiskFreeSpaceExW(w "$0\", *l.r1, p 0, p 0) i.r3'
    StrCmp $3 0 invalid
    System::Int64Op $1 / 1024
    Pop $1
    SectionGetSize 0 $2
    System::Int64Op $1 < $2
    Pop $3
    StrCmp $3 1 0 enough_space
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(DesignNoSpace)"
    Abort
enough_space:
    Return
invalid:
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(DesignInvalidPath)"
    Abort
FunctionEnd

Function DesignFinish
    Call DesignBase
    System::Call 'user32::SetPropW(p $HWNDPARENT, w "Vocal.InstallComplete", p 1)'
    System::Call 'user32::GetDlgItem(p $HWNDPARENT, i 0x7101) p.r0'
    System::Call 'user32::InvalidateRect(p r0, p 0, i 0)'
    ${NSD_CreateLabel} 24u 72u 136u 25u "$(DesignReady)"
    Pop $0
    SetCtlColors $0 303133 FFFFFF
    SendMessage $0 ${WM_SETFONT} $DesignHeadingFont 0
    ${NSD_CreateLabel} 24u 104u 136u 26u "$(DesignReadyBody)"
    Pop $0
    SetCtlColors $0 606266 FFFFFF
    SendMessage $0 ${WM_SETFONT} $DesignTextFont 0
    ${NSD_CreateCheckbox} 24u 132u 136u 24u "$(LaunchVocal)"
    Pop $DesignLaunch
    SetCtlColors $DesignLaunch 303133 FFFFFF
    SendMessage $DesignLaunch ${WM_SETFONT} $DesignTextFont 0
    ${NSD_OnNotify} $DesignLaunch DesignDrawButton
    ${NSD_Check} $DesignLaunch
    ${NSD_CreateButton} 24u 160u 136u 28u "$(DesignDone)"
    Pop $DesignPrimary
    Call DesignPrimaryStyle
    Call DesignShow
FunctionEnd

Function DesignFinishLeave
    ${NSD_GetState} $DesignLaunch $0
    StrCmp $0 ${BST_CHECKED} 0 done
    Exec '"$INSTDIR\vocal-native.exe"'
done:
FunctionEnd

Function DesignProgress
    ; The stock page is retained for actual installation/logging, but laid out
    ; inside the same narrow content column beneath our persistent title bar.
    System::Call '*(i 0, i 0, i 0, i 0) p.r0'
    System::Call 'user32::GetClientRect(p $HWNDPARENT, p r0)'
    System::Call '*$0(i, i, i.r1, i.r2)'
    IntOp $2 $2 - $DesignFrameHeight
    System::Call 'user32::SetWindowPos(p $mui.InstFilesPage, p 0, i 0, i $DesignFrameHeight, i r1, i r2, i 0x14)'
    System::Free $0
    ShowWindow $mui.Header.Text ${SW_HIDE}
    ShowWindow $mui.Header.SubText ${SW_HIDE}
    ShowWindow $mui.Header.Image ${SW_HIDE}
    ; Put headings inside the page so NSIS cannot cover them with the inner
    ; dialog after the page-show callback has returned.
    System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "$(DesignInstalling)", i 0x50000000, i 0, i 0, i 0, i 0, p $mui.InstFilesPage, p 0, p 0, p 0) p.r0'
    StrCpy $DesignProgressTitle $0
    System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "$(DesignInstallingBody)", i 0x50000000, i 0, i 0, i 0, i 0, p $mui.InstFilesPage, p 0, p 0, p 0) p.r0'
    StrCpy $DesignProgressSubtitle $0
    !insertmacro DesignPlace $DesignProgressTitle 24 16 136 25
    !insertmacro DesignPlace $DesignProgressSubtitle 24 46 136 24
    !insertmacro DesignPlace $mui.InstFilesPage.Text 24 72 136 24
    !insertmacro DesignPlace $mui.InstFilesPage.ProgressBar 24 100 136 4
    !insertmacro DesignPlace $mui.InstFilesPage.Log 24 112 136 88
    System::Call '*(i 0, i 0, i 0, i 0) p.r0'
    System::Call 'user32::GetClientRect(p $mui.InstFilesPage.Log, p r0)'
    System::Call '*$0(i, i, i.r1, i)'
    System::Free $0
    System::Call 'user32::GetSystemMetrics(i 2) i.r2'
    IntOp $1 $1 - $2
    IntOp $1 $1 - 8
    SendMessage $mui.InstFilesPage.Log 0x101E 0 $1
    CreateFont $DesignProgressTextFont "Microsoft YaHei UI" 10 400
    CreateFont $DesignProgressHeadingFont "Microsoft YaHei UI" 15 700
    SendMessage $mui.InstFilesPage.Text ${WM_SETFONT} $DesignProgressTextFont 1
    SendMessage $mui.InstFilesPage.Log ${WM_SETFONT} $DesignProgressTextFont 1
    SendMessage $DesignProgressTitle ${WM_SETFONT} $DesignProgressHeadingFont 1
    SendMessage $DesignProgressSubtitle ${WM_SETFONT} $DesignProgressTextFont 1
    SetCtlColors $DesignProgressTitle 303133 FFFFFF
    SetCtlColors $DesignProgressSubtitle 606266 FFFFFF
    SetCtlColors $mui.InstFilesPage 303133 FFFFFF
    SetCtlColors $mui.InstFilesPage.Text 606266 FFFFFF
    SetCtlColors $mui.InstFilesPage.Log 606266 F7F8FA
    ; List-view colors use their own messages rather than WM_CTLCOLOR.
    SendMessage $mui.InstFilesPage.Log 0x1001 0 0xFAF8F7
    SendMessage $mui.InstFilesPage.Log 0x1026 0 0xFAF8F7
    SendMessage $mui.InstFilesPage.Log 0x1024 0 0x666260
    System::Call 'user32::GetWindowLong(p $mui.InstFilesPage.Log, i -20) i.r0'
    IntOp $0 $0 & 0xFFFFFDFF ; remove the classic sunken edge
    System::Call 'user32::SetWindowLong(p $mui.InstFilesPage.Log, i -20, i r0)'
    System::Call 'user32::GetWindowLong(p $mui.InstFilesPage.Log, i -16) i.r0'
    IntOp $0 $0 & 0xFF7FFFFF
    System::Call 'user32::SetWindowLong(p $mui.InstFilesPage.Log, i -16, i r0)'
    System::Call 'user32::SetWindowPos(p $mui.InstFilesPage.Log, p 0, i 0, i 0, i 0, i 0, i 0x37)'
    System::Call 'uxtheme::SetWindowTheme(p $mui.InstFilesPage.ProgressBar, w "", w "")'
    System::Call 'user32::GetWindowLong(p $mui.InstFilesPage.ProgressBar, i -20) i.r0'
    IntOp $0 $0 & 0xFFFFFDFF
    System::Call 'user32::SetWindowLong(p $mui.InstFilesPage.ProgressBar, i -20, i r0)'
    System::Call 'user32::GetWindowLong(p $mui.InstFilesPage.ProgressBar, i -16) i.r0'
    IntOp $0 $0 & 0xFF7FFFFF
    System::Call 'user32::SetWindowLong(p $mui.InstFilesPage.ProgressBar, i -16, i r0)'
    SendMessage $mui.InstFilesPage.ProgressBar 0x409 0 0x3AC267
    SendMessage $mui.InstFilesPage.ProgressBar 0x2001 0 0xF3F0EE
    ; Same restrained 4 DIP progress track as the application.
    System::Call 'user32::GetDC(p $HWNDPARENT) p.r0'
    System::Call 'gdi32::GetDeviceCaps(p r0, i 88) i.r1'
    System::Call 'user32::ReleaseDC(p $HWNDPARENT, p r0)'
    System::Call 'kernel32::MulDiv(i 4, i r1, i 96) i.r1'
    System::Call '*(i 0, i 0, i 0, i 0) p.r0'
    System::Call 'user32::GetClientRect(p $mui.InstFilesPage.ProgressBar, p r0)'
    System::Call '*$0(i, i, i.r2, i)'
    System::Free $0
    System::Call 'user32::SetWindowPos(p $mui.InstFilesPage.ProgressBar, p 0, i 0, i 0, i r2, i r1, i 0x36)'
    ShowWindow $mui.Branding.Background ${SW_HIDE}
    ShowWindow $mui.Branding.Text ${SW_HIDE}
    ShowWindow $mui.Line.Standard ${SW_HIDE}
    ShowWindow $mui.Line.FullWindow ${SW_HIDE}
    GetDlgItem $0 $HWNDPARENT 1
    ShowWindow $0 ${SW_HIDE}
    GetDlgItem $0 $HWNDPARENT 2
    ShowWindow $0 ${SW_HIDE}
    GetDlgItem $0 $HWNDPARENT 3
    ShowWindow $0 ${SW_HIDE}
FunctionEnd

Function DesignProgressLeave
    ; Restore the page's default font before releasing its custom font handles.
    SendMessage $HWNDPARENT ${WM_GETFONT} 0 0 $0
    SendMessage $DesignProgressTitle ${WM_SETFONT} $0 0
    SendMessage $DesignProgressSubtitle ${WM_SETFONT} $0 0
    SendMessage $mui.InstFilesPage.Text ${WM_SETFONT} $0 0
    SendMessage $mui.InstFilesPage.Log ${WM_SETFONT} $0 0
    System::Call 'gdi32::DeleteObject(p $DesignProgressTextFont)'
    System::Call 'gdi32::DeleteObject(p $DesignProgressHeadingFont)'
FunctionEnd
