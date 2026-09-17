pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Window

ApplicationWindow {
    id: root
    required property AppController controller
    width: 880
    height: 640
    minimumWidth: 720
    minimumHeight: 520
    visible: true
    title: "Vocal 设置"
    flags: Qt.Window | Qt.FramelessWindowHint
    font.family: "Microsoft YaHei UI"
    font.pixelSize: 13
    property int page: 0
    property bool closeToTray: false
    property Popup activeSelectPopup: null
    property ComboBox activeSelect: null
    function positionSelect(select: ComboBox) {
        if (!select.popup)
            return;
        const anchor = select.mapToItem(scroller, 0, 0);
        if (anchor.y < 0 || anchor.y + select.height > scroller.availableHeight) {
            select.popup.close();
            return;
        }
        const point = select.mapToItem(Overlay.overlay, 0, select.height + 3);
        select.popup.x = point.x;
        select.popup.y = point.y;
    }
    property bool en: controller.settings.language === "en"
    property bool dark: controller.settings.theme === "dark" || (controller.settings.theme === "system" && Application.styleHints.colorScheme === Qt.Dark)
    property color surface: dark ? "#242528" : "#ffffff"
    property color surface2: dark ? "#1f2022" : "#f7f8fa"
    property color hover: dark ? "#2e3033" : "#eef0f3"
    property color line: dark ? "#35363a" : "#e6e8eb"
    property color fg: dark ? "#e9eaec" : "#303133"
    property color muted: dark ? "#a4a6ab" : "#606266"
    property color subtle: dark ? "#75777d" : "#909399"
    property color accent: dark ? "#85ce61" : "#67c23a"
    property color accentSoft: dark ? "#24331b" : "#f0f9eb"
    property color accentRing: dark ? "#4a7a30" : "#b3e19d"
    property color danger: dark ? "#f78989" : "#f56c6c"
    property var titles: [tr("触发方式", "Triggers"), tr("识别", "Recognition"), tr("口语清理", "Speech cleanup"), tr("AI 整理", "AI editing"), tr("文字输入", "Text input"), tr("通用", "General"), tr("外观", "Appearance"), tr("历史", "History"), tr("关于", "About")]
    color: surface
    palette.window: surface
    palette.windowText: fg
    palette.text: fg
    palette.base: surface
    palette.button: surface
    palette.buttonText: fg
    palette.highlight: accent
    function tr(zh, english) {
        return en ? english : zh;
    }
    function modelSize(bytes) {
        return bytes >= 1073741824 ? (bytes / 1073741824).toFixed(2) + " GB" : Math.round(bytes / 1048576) + " MB";
    }
    function scrollSettings(event) {
        const view = scroller.contentItem as Flickable;
        const pixel = event.pixelDelta.y;
        const steps = event.angleDelta.y;
        if ((!pixel && !steps) || (event.modifiers & Qt.ControlModifier)) {
            event.accepted = false;
            return;
        }
        const end = Math.max(0, scroller.contentHeight - scroller.availableHeight);
        const origin = wheelScroll.running ? wheelScroll.to : view.contentY;
        const destination = Math.max(0, Math.min(end, (pixel ? view.contentY : origin) - (pixel || steps / 120 * 72)));
        wheelScroll.stop();
        if (pixel) {
            // Touchpads already supply small, continuous deltas.
            view.contentY = destination;
        } else {
            wheelScroll.from = view.contentY;
            wheelScroll.to = destination;
            wheelScroll.start();
        }
        event.accepted = true;
    }
    component GreenProgress: ProgressBar {
        id: progress
        implicitHeight: 4
        padding: 0
        background: Rectangle {
            implicitHeight: 4
            radius: height / 2
            color: root.hover
        }
        contentItem: Item {
            Rectangle {
                width: progress.visualPosition * parent.width
                height: parent.height
                radius: height / 2
                color: root.accent
                Behavior on width { NumberAnimation { duration: 60 } }
            }
        }
    }
    component BoundedScroll: ScrollView {
        Component.onCompleted: {
            const view = contentItem as Flickable;
            if (view) {
                view.boundsBehavior = Flickable.StopAtBounds;
                view.boundsMovement = Flickable.StopAtBounds;
            }
        }
    }
    function status() {
        return ({
                ready: tr("准备就绪", "Ready"),
                loading: tr("正在加载模型…", "Loading…"),
                recording: tr("正在聆听…", "Listening…"),
                recognizing: tr("正在整理…", "Finishing…"),
                unloaded: tr("模型已休眠", "Models asleep"),
                paused: tr("已暂停，模型已释放", "Paused · models unloaded"),
                error: tr("需要处理", "Needs attention")
            })[controller.state] || controller.state;
    }
    onClosing: function (event) {
        if (closeToTray) {
            event.accepted = false;
            hide();
        }
    }
    onPageChanged: {
        wheelScroll.stop();
        scroller.contentItem.contentY = 0;
    }
    component Note: Label {
        font.family: root.font.family
        color: root.subtle
        font.pixelSize: 12
        wrapMode: Text.Wrap
        Layout.fillWidth: true
    }
    component Action: Button {
        id: action
        font.family: root.font.family
        implicitHeight: 30
        leftPadding: 12
        rightPadding: 12
        topPadding: 5
        bottomPadding: 5
        contentItem: Text {
            text: action.text
            font: action.font
            color: action.enabled ? root.fg : root.subtle
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
        }
        background: Rectangle {
            radius: 8
            color: action.hovered ? root.hover : root.surface
            border.color: root.line
            opacity: action.enabled ? 1 : .55
        }
    }
    component DeleteButton: Action {
        id: deleteButton
        implicitWidth: 30
        leftPadding: 6
        rightPadding: 6
        Accessible.name: root.tr("删除", "Delete")
        contentItem: Canvas {
            property color ink: deleteButton.enabled ? root.muted : root.subtle
            onInkChanged: requestPaint()
            onPaint: {
                const ctx = getContext("2d");
                ctx.reset();
                ctx.translate((width - 16) / 2, (height - 16) / 2);
                ctx.strokeStyle = ink;
                ctx.lineWidth = 1.3;
                ctx.lineCap = "round";
                ctx.lineJoin = "round";
                ctx.beginPath();
                ctx.moveTo(2, 4);
                ctx.lineTo(14, 4);
                ctx.moveTo(5, 4);
                ctx.lineTo(5, 2);
                ctx.lineTo(11, 2);
                ctx.lineTo(11, 4);
                ctx.moveTo(3, 4);
                ctx.lineTo(4, 14);
                ctx.lineTo(12, 14);
                ctx.lineTo(13, 4);
                ctx.moveTo(6, 7);
                ctx.lineTo(6, 11);
                ctx.moveTo(10, 7);
                ctx.lineTo(10, 11);
                ctx.stroke();
            }
        }
    }
    component Toggle: Switch {
        id: toggle
        property string settingKey
        checked: Boolean(root.controller.settings[settingKey])
        onClicked: {
            root.controller.setSetting(settingKey, checked);
            checked = Qt.binding(() => Boolean(root.controller.settings[settingKey]));
        }
        implicitWidth: 38
        implicitHeight: 24
        padding: 0
        indicator: Rectangle {
            implicitWidth: 38
            implicitHeight: 22
            y: 1
            radius: 11
            color: toggle.checked ? root.accent : root.dark ? "#4a4c51" : "#dcdfe6"
            Rectangle {
                width: 16
                height: 16
                x: toggle.checked ? 19 : 3
                y: 3
                radius: 8
                color: "white"
                Behavior on x {
                    NumberAnimation {
                        duration: 110
                    }
                }
            }
        }
        contentItem: Item {}
        Accessible.name: settingKey
    }
    component Input: TextField {
        id: input
        font.family: root.font.family
        implicitHeight: 34
        color: root.fg
        selectionColor: root.accent
        padding: 8
        leftPadding: 10
        selectByMouse: true
        background: Rectangle {
            radius: 8
            color: root.surface
            border.color: input.activeFocus ? root.accent : root.line
        }
    }
    component Select: ComboBox {
        id: select
        font.family: root.font.family
        font.pixelSize: 13
        opacity: enabled ? 1 : 0.5
        objectName: "select-" + settingKey
        property string settingKey
        property var options: []
        model: options
        textRole: "label"
        valueRole: "value"
        implicitHeight: 34
        implicitWidth: 240
        leftPadding: 10
        rightPadding: 28
        wheelEnabled: false
        property bool justClosed: false
        Timer {
            id: resetClosed
            interval: 0
            onTriggered: select.justClosed = false
        }
        MouseArea {
            anchors.fill: parent
            acceptedButtons: Qt.LeftButton
            onPressed: {
                if (select.justClosed)
                    return;
                select.forceActiveFocus(Qt.MouseFocusReason);
                if (select.popup.visible)
                    select.popup.close();
                else
                    select.popup.open();
            }
            onWheel: event => root.scrollSettings(event)
        }
        currentIndex: {
            for (let i = 0; i < options.length; i++)
                if (options[i].value === root.controller.settings[settingKey])
                    return i;
            return -1;
        }
        onActivated: root.controller.setSetting(settingKey, currentValue)
        contentItem: Text {
            text: select.displayText
            color: root.fg
            font: select.font
            verticalAlignment: Text.AlignVCenter
            elide: Text.ElideRight
        }
        indicator: Canvas {
            width: 10
            height: 6
            x: select.width - width - 12
            y: (select.height - height) / 2
            property color ink: root.muted
            onInkChanged: requestPaint()
            rotation: select.popup.visible ? 180 : 0
            onPaint: {
                const ctx = getContext("2d");
                ctx.reset();
                ctx.strokeStyle = ink;
                ctx.lineWidth = 1.5;
                ctx.lineCap = "round";
                ctx.lineJoin = "round";
                ctx.beginPath();
                ctx.moveTo(1, 1);
                ctx.lineTo(5, 5);
                ctx.lineTo(9, 1);
                ctx.stroke();
            }
        }
        background: Rectangle {
            radius: 8
            color: root.surface
            border.color: select.activeFocus || select.popup.visible ? root.accent : root.line
        }
        delegate: ItemDelegate {
            id: choice
            required property var modelData
            required property int index
            width: select.popup.availableWidth
            implicitHeight: 34
            leftPadding: 10
            rightPadding: 28
            text: modelData.label
            font: select.font
            highlighted: select.highlightedIndex === index
            contentItem: Text {
                text: choice.text
                font: choice.font
                color: select.currentIndex === choice.index ? root.accent : root.fg
                elide: Text.ElideRight
                verticalAlignment: Text.AlignVCenter
            }
            background: Rectangle {
                radius: 6
                color: select.currentIndex === choice.index ? root.accentSoft : choice.highlighted || choice.hovered ? root.hover : "transparent"
            }
            Text {
                anchors.right: parent.right
                anchors.rightMargin: 10
                anchors.verticalCenter: parent.verticalCenter
                visible: select.currentIndex === choice.index
                text: "✓"
                color: root.accent
                font.pixelSize: 13
            }
        }
        popup: Popup {
            parent: Overlay.overlay
            popupType: Popup.Item
            closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
            onOpened: {
                if (root.activeSelectPopup && root.activeSelectPopup !== select.popup)
                    root.activeSelectPopup.close();
                root.activeSelectPopup = select.popup;
                root.activeSelect = select;
                root.positionSelect(select);
            }
            onClosed: {
                select.justClosed = true;
                resetClosed.restart();
                select.focus = false;
                if (root.activeSelectPopup === select.popup) {
                    root.activeSelectPopup = null;
                    root.activeSelect = null;
                }
            }
            x: select.mapToItem(Overlay.overlay, 0, 0).x
            y: select.mapToItem(Overlay.overlay, 0, select.height + 3).y
            width: select.width
            padding: 4
            implicitHeight: Math.min(contentItem.implicitHeight + 8, 260)
            background: Rectangle {
                color: root.surface
                radius: 8
                border.color: root.line
            }
            contentItem: ListView {
                clip: true
                implicitHeight: contentHeight
                model: select.popup.visible ? select.delegateModel : null
                currentIndex: select.highlightedIndex
                boundsBehavior: Flickable.StopAtBounds
                boundsMovement: Flickable.StopAtBounds
                ScrollIndicator.vertical: ScrollIndicator {}
            }
        }
    }
    component Section: ColumnLayout {
        id: section
        property string heading
        property string hint: ""
        property bool first: false
        property string toggleKey: ""
        Layout.fillWidth: true
        spacing: 14
        Rectangle {
            visible: !section.first
            Layout.fillWidth: true
            implicitHeight: 1
            color: root.line
            Layout.topMargin: 4
            Layout.bottomMargin: 6
        }
        ColumnLayout {
            spacing: 3
            Layout.fillWidth: true
            RowLayout {
                Layout.fillWidth: true
                Label {
                    font.family: root.font.family
                    text: section.heading
                    color: root.fg
                    font.weight: Font.DemiBold
                    font.pixelSize: 13
                    Layout.fillWidth: true
                }
                Toggle {
                    visible: section.toggleKey.length > 0
                    settingKey: section.toggleKey
                }
            }
            Note {
                text: section.hint
                visible: text.length > 0
            }
        }
    }
    component FormRow: RowLayout {
        id: row
        required property var field
        property bool wide: ["idleUnloadMin", "maxReplaceChars", "keyboardInFullscreen", "mouseInFullscreen"].indexOf(field.key) >= 0
        spacing: 20
        Layout.fillWidth: true
        Layout.topMargin: 3
        ColumnLayout {
            spacing: 4
            Layout.preferredWidth: row.wide ? -1 : 144
            Layout.fillWidth: row.wide
            Label {
                font.family: root.font.family
                text: row.field.label
                color: root.fg
                font.pixelSize: 13
                Layout.fillWidth: true
                wrapMode: Text.Wrap
            }
            Note {
                text: row.field.hint || ""
                visible: text.length > 0
                font.pixelSize: 11
            }
        }
        Loader {
            Layout.preferredWidth: row.field.type === "number" ? 112 : row.field.type === "bool" ? 38 : -1
            Layout.fillWidth: row.field.type !== "number" && row.field.type !== "bool"
            sourceComponent: row.field.type === "bool" ? boolField : row.field.type === "select" ? selectField : textField
            Component {
                id: boolField
                Toggle {
                    settingKey: row.field.key
                }
            }
            Component {
                id: selectField
                Select {
                    settingKey: row.field.key
                    options: row.field.options
                }
            }
            Component {
                id: textField
                Input {
                    text: row.field.type === "number" ? String(Number(root.controller.settings[row.field.key]) / (row.field.factor || 1)) : root.controller.settings[row.field.key]
                    echoMode: row.field.secret ? TextInput.Password : TextInput.Normal
                    inputMethodHints: row.field.type === "number" ? Qt.ImhFormattedNumbersOnly : Qt.ImhNone
                    onEditingFinished: {
                        if (row.field.type === "number") {
                            const n = Number(text) * (row.field.factor || 1);
                            if (Number.isFinite(n))
                                root.controller.setSetting(row.field.key, Math.round(n));
                        } else
                            root.controller.setSetting(row.field.key, text);
                    }
                }
            }
        }
        Label {
            font.family: root.font.family
            visible: Boolean(row.field.unit)
            text: row.field.unit || ""
            color: root.subtle
        }
        Item {
            visible: !row.wide && (row.field.type === "bool" || row.field.type === "number")
            Layout.fillWidth: true
        }
    }
    component Words: ColumnLayout {
        id: words
        property string settingKey
        property string savedText: ""
        Component.onCompleted: {
            savedText = (root.controller.settings[settingKey] || []).join("\n");
            draft.text = savedText;
        }
        spacing: 8
        Layout.fillWidth: true
        BoundedScroll {
            Layout.fillWidth: true
            Layout.preferredHeight: 96
            wheelEnabled: false
            WheelHandler {
                target: null
                acceptedDevices: PointerDevice.Mouse | PointerDevice.TouchPad
                onWheel: event => root.scrollSettings(event)
            }
            TextArea {
                id: draft
                objectName: "words-" + words.settingKey
                WheelHandler {
                    target: null
                    acceptedDevices: PointerDevice.Mouse | PointerDevice.TouchPad
                    onWheel: event => root.scrollSettings(event)
                }
                font.family: root.font.family
                wrapMode: TextEdit.Wrap
                color: root.fg
                selectByMouse: true
                padding: 10
                placeholderText: root.tr("每行一个，也可用逗号分隔", "One per line or separated by commas")
                background: Rectangle {
                    color: root.surface
                    border.color: draft.activeFocus ? root.accent : root.line
                    radius: 8
                }
            }
        }
        RowLayout {
            Action {
                text: root.tr("保存", "Save")
                onClicked: {
                    root.controller.commitInputMethod();
                    draft.focus = false;
                    root.controller.saveWords(words.settingKey, draft.text);
                    words.savedText = (root.controller.settings[words.settingKey] || []).join("\n");
                }
            }
            Note {
                text: draft.text === words.savedText ? root.tr("已保存", "Saved") : root.tr("保存后生效", "Applied after saving")
            }
        }
    }
    component Models: ColumnLayout {
        id: modelList
        property var entries
        property string role
        property bool allowNone: true
        Layout.fillWidth: true
        spacing: 4
        Repeater {
            model: modelList.entries
            delegate: Rectangle {
                id: modelRow
                required property var modelData
                Layout.fillWidth: true
                implicitHeight: modelBody.implicitHeight + 20
                radius: 8
                readonly property bool isNone: modelData.id === "none"
                readonly property bool chosen: modelList.role === "punct" || Boolean(modelData.selected)
                readonly property bool downloading: ["queued", "downloading", "extracting", "verifying"].indexOf(modelData.phase) >= 0
                readonly property bool deleting: modelData.phase === "deleting"
                readonly property bool disabledChoice: deleting || (isNone && !modelList.allowNone)
                readonly property string subtitle: isNone ? (modelList.allowNone ? "" : root.tr("至少保留一种识别模型", "Keep at least one recognition model")) : [modelData.langs, modelData.note].filter(Boolean).join(" · ")
                color: chosen ? root.accentSoft : selectionArea.containsMouse && !disabledChoice ? root.hover : "transparent"
                border.color: chosen ? root.accentRing : "transparent"
                opacity: disabledChoice ? 0.45 : 1
                activeFocusOnTab: !disabledChoice
                Accessible.role: Accessible.RadioButton
                Accessible.name: isNone ? root.tr("不使用", "Off") : String(modelData.name)
                Accessible.checked: chosen
                Keys.onPressed: event => {
                    if (!disabledChoice && !downloading && (event.key === Qt.Key_Return || event.key === Qt.Key_Enter || event.key === Qt.Key_Space)) {
                        root.controller.selectModel(modelList.role, modelData.id);
                        event.accepted = true;
                    }
                }
                MouseArea {
                    id: selectionArea
                    anchors.fill: parent
                    hoverEnabled: true
                    enabled: !modelRow.disabledChoice && !modelRow.downloading
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.controller.selectModel(modelList.role, modelRow.modelData.id)
                }
                ColumnLayout {
                    id: modelBody
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.margins: 10
                    spacing: 4
                    RowLayout {
                        spacing: 10
                        Layout.fillWidth: true
                        Rectangle {
                            Layout.preferredWidth: 16
                            Layout.preferredHeight: 16
                            radius: 8
                            color: modelRow.chosen ? root.accent : "transparent"
                            border.color: modelRow.chosen ? root.accent : root.dark ? "#4a4c51" : "#dcdfe6"
                            Canvas {
                                anchors.centerIn: parent
                                width: 9
                                height: 7
                                visible: modelRow.chosen
                                onPaint: {
                                    const ctx = getContext("2d");
                                    ctx.reset();
                                    ctx.strokeStyle = "white";
                                    ctx.lineWidth = 1.6;
                                    ctx.lineCap = "round";
                                    ctx.lineJoin = "round";
                                    ctx.beginPath();
                                    ctx.moveTo(1, 3.6);
                                    ctx.lineTo(3.4, 6);
                                    ctx.lineTo(8, 1);
                                    ctx.stroke();
                                }
                            }
                        }
                        ColumnLayout {
                            spacing: 2
                            Layout.fillWidth: true
                            Label {
                                font.family: root.font.family
                                text: modelRow.isNone ? root.tr("不使用", "Off") : modelRow.modelData.name
                                color: root.fg
                                font.pixelSize: 13
                                Layout.fillWidth: true
                                wrapMode: Text.Wrap
                            }
                            Label {
                                font.family: root.font.family
                                visible: text.length > 0
                                text: modelRow.subtitle
                                color: root.subtle
                                font.pixelSize: 11
                                Layout.fillWidth: true
                                wrapMode: Text.Wrap
                            }
                        }
                        BusyIndicator {
                            visible: (Boolean(modelRow.modelData.loading) || modelRow.deleting) && !modelRow.isNone
                            running: visible
                            Layout.preferredWidth: 16
                            Layout.preferredHeight: 16
                        }
                        Action {
                            visible: modelRow.downloading
                            text: root.tr("取消", "Cancel")
                            onClicked: root.controller.cancelDownload(modelRow.modelData.id)
                        }
                        Label {
                            font.family: root.font.family
                            visible: !modelRow.isNone && !modelRow.downloading
                            text: modelRow.isNone ? "" : modelRow.modelData.installed ? root.modelSize(Number(modelRow.modelData.bytes)) : root.tr("下载约 ", "Download ~ ") + root.modelSize(Number(modelRow.modelData.downloadBytes || Number(modelRow.modelData.approxMB) * 1048576))
                            color: root.subtle
                            font.pixelSize: 11
                        }
                        DeleteButton {
                            id: modelDelete
                            visible: Boolean(modelRow.modelData.installed) && !modelRow.downloading
                            enabled: !modelRow.deleting && !modelRow.modelData.loading
                            implicitWidth: 28
                            implicitHeight: 28
                            background: Rectangle {
                                radius: 6
                                color: modelDelete.hovered ? root.hover : "transparent"
                            }
                            Accessible.name: root.tr("删除模型", "Delete model")
                            onClicked: root.controller.deleteModel(modelRow.modelData.id)
                        }
                    }
                    ColumnLayout {
                        visible: modelRow.downloading
                        Layout.fillWidth: true
                        Layout.leftMargin: 26
                        Layout.topMargin: 4
                        spacing: 4
                        GreenProgress {
                            Layout.fillWidth: true
                            from: 0
                            to: 100
                            visible: modelRow.modelData.phase !== "queued"
                            value: modelRow.modelData.phase !== "downloading" || !Number(modelRow.modelData.total) ? 100 : Number(modelRow.modelData.percent || 0)
                        }
                        RowLayout {
                            Layout.fillWidth: true
                            Label {
                                font.family: root.font.family
                                font.pixelSize: 11
                                color: root.subtle
                                Layout.fillWidth: true
                                text: modelRow.modelData.phase === "extracting" ? root.tr("解压中", "Extracting") : modelRow.modelData.phase === "verifying" ? root.tr("校验中", "Verifying") : modelRow.modelData.phase === "queued" ? root.tr("排队中 · 第 ", "Queued · #") + modelRow.modelData.queuePosition : root.tr("下载中", "Downloading")
                            }
                            Label {
                                visible: modelRow.modelData.phase === "downloading" && Number(modelRow.modelData.total) > 0
                                font.family: root.font.family
                                font.pixelSize: 11
                                color: root.subtle
                                text: root.modelSize(Number(modelRow.modelData.received || 0)) + " / " + root.modelSize(Number(modelRow.modelData.total || 0))
                            }
                        }
                    }
                    Note {
                        visible: modelRow.deleting
                        Layout.leftMargin: 26
                        text: root.tr("正在删除…", "Deleting…")
                        font.pixelSize: 11
                    }
                    Note {
                        visible: Boolean(modelRow.modelData.error || modelRow.modelData.loadError)
                        text: modelRow.modelData.error || root.tr("加载失败，请重试", "Loading failed. Try again.")
                        color: root.danger
                        Layout.leftMargin: 26
                    }
                    Note {
                        visible: !modelRow.isNone && !modelRow.modelData.installed && !modelRow.downloading && !modelRow.deleting && Boolean(modelRow.modelData.installedBytes)
                        Layout.leftMargin: 26
                        font.pixelSize: 11
                        text: root.tr("安装后约 ", "Installed ~ ") + root.modelSize(Number(modelRow.modelData.installedBytes || 0))
                    }
                    Note {
                        visible: modelRow.chosen && !modelRow.isNone && !modelRow.modelData.installed && !modelRow.downloading && !modelRow.deleting
                        Layout.leftMargin: 26
                        font.pixelSize: 11
                        color: root.dark ? "#eebe77" : "#e6a23c"
                        text: root.tr("点击下载", "Click to download")
                    }
                }
            }
        }
    }
    RowLayout {
        anchors.fill: parent
        spacing: 0
        Rectangle {
            Layout.preferredWidth: 192
            Layout.fillHeight: true
            color: root.surface2
            Rectangle {
                anchors.right: parent.right
                height: parent.height
                width: 1
                color: root.line
            }
            ColumnLayout {
                anchors.fill: parent
                anchors.leftMargin: 12
                anchors.rightMargin: 12
                anchors.topMargin: 0
                anchors.bottomMargin: 14
                spacing: 2
                Item {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 44
                    Layout.bottomMargin: 16
                    Row {
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.left: parent.left
                        anchors.leftMargin: 4
                        spacing: 10
                        Image {
                            source: "qrc:/vocal/resources/icon.png"
                            width: 26
                            height: 26
                        }
                        Label {
                            font.family: root.font.family
                            text: "Vocal"
                            font.pixelSize: 16
                            font.weight: Font.DemiBold
                            color: root.fg
                            anchors.verticalCenter: parent.verticalCenter
                        }
                    }
                    MouseArea {
                        anchors.fill: parent
                        onPressed: root.startSystemMove()
                    }
                }
                Repeater {
                    model: root.titles
                    delegate: ColumnLayout {
                        id: navRow
                        required property int index
                        required property string modelData
                        Layout.fillWidth: true
                        spacing: 0
                        Rectangle {
                            visible: navRow.index === 5
                            implicitHeight: 1
                            Layout.fillWidth: true
                            color: root.line
                            Layout.topMargin: 10
                            Layout.bottomMargin: 10
                        }
                        Button {
                            id: nav
                            Layout.fillWidth: true
                            implicitHeight: 34
                            text: navRow.modelData
                            onClicked: root.page = navRow.index
                            contentItem: Row {
                                spacing: 8
                                leftPadding: 12
                                Text {
                                    font.family: root.font.family
                                    text: nav.text
                                    color: root.page === navRow.index ? root.fg : root.muted
                                    font.pixelSize: 14
                                    anchors.verticalCenter: parent.verticalCenter
                                }
                                Rectangle {
                                    visible: navRow.index === 8 && Boolean(root.controller.update.available)
                                    width: 6
                                    height: 6
                                    radius: 3
                                    color: root.danger
                                    anchors.verticalCenter: parent.verticalCenter
                                }
                            }
                            background: Rectangle {
                                radius: 8
                                color: root.page === navRow.index ? root.surface : nav.hovered ? root.hover : "transparent"
                                border.width: root.page === navRow.index ? 1 : 0
                                border.color: root.line
                            }
                        }
                    }
                }
                Item {
                    Layout.fillHeight: true
                }
                RowLayout {
                    Layout.fillWidth: true
                    Layout.leftMargin: 12
                    Layout.rightMargin: 6
                    Label {
                        text: root.tr("语音输入", "Voice input")
                        font: root.font
                        color: root.fg
                        Layout.fillWidth: true
                    }
                    Toggle {
                        objectName: "serviceToggle"
                        settingKey: "serviceEnabled"
                        Accessible.name: root.tr("启用语音输入", "Enable voice input")
                    }
                }
                Label {
                    font.family: root.font.family
                    text: root.status()
                    color: root.subtle
                    font.pixelSize: 11
                    leftPadding: 12
                }
            }
        }
        ColumnLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 0
            Item {
                Layout.fillWidth: true
                Layout.preferredHeight: 36
                MouseArea {
                    anchors.fill: parent
                    anchors.rightMargin: 88
                    onPressed: root.startSystemMove()
                    onDoubleClicked: root.visibility === Window.Maximized ? root.showNormal() : root.showMaximized()
                }
                Row {
                    anchors.right: parent.right
                    height: 36
                    Button {
                        id: minimize
                        width: 44
                        height: 36
                        text: "−"
                        onClicked: root.showMinimized()
                        background: Rectangle {
                            color: minimize.hovered ? root.hover : "transparent"
                        }
                        contentItem: Text {
                            font.family: root.font.family
                            text: minimize.text
                            color: root.muted
                            horizontalAlignment: Text.AlignHCenter
                            verticalAlignment: Text.AlignVCenter
                        }
                    }
                    Button {
                        id: closeButton
                        width: 44
                        height: 36
                        text: "×"
                        onClicked: root.hide()
                        background: Rectangle {
                            color: closeButton.hovered ? root.danger : "transparent"
                        }
                        contentItem: Text {
                            font.family: root.font.family
                            text: closeButton.text
                            color: closeButton.hovered ? "white" : root.muted
                            font.pixelSize: 18
                            horizontalAlignment: Text.AlignHCenter
                            verticalAlignment: Text.AlignVCenter
                        }
                    }
                }
            }
            BoundedScroll {
                id: scroller
                objectName: "settingsScroll"
                Connections {
                    target: scroller.contentItem
                    function onContentYChanged() {
                        if (root.activeSelect)
                            root.positionSelect(root.activeSelect);
                    }
                }
                Layout.fillWidth: true
                Layout.fillHeight: true
                clip: true
                contentWidth: availableWidth
                WheelHandler {
                    target: null
                    acceptedDevices: PointerDevice.Mouse | PointerDevice.TouchPad
                    onWheel: event => root.scrollSettings(event)
                }
                NumberAnimation {
                    id: wheelScroll
                    target: scroller.contentItem
                    property: "contentY"
                    duration: 140
                    easing.type: Easing.OutCubic
                }
                ColumnLayout {
                    width: scroller.availableWidth - 64
                    x: 32
                    spacing: 16
                    Label {
                        font.family: root.font.family
                        text: root.titles[root.page]
                        color: root.fg
                        font.pixelSize: 19
                        font.weight: Font.DemiBold
                        Layout.topMargin: 8
                        Layout.bottomMargin: 4
                    }
                    RowLayout {
                        visible: root.controller.error.length > 0
                        Layout.fillWidth: true
                        Note {
                            text: root.controller.error
                            color: root.danger
                        }
                        Action {
                            text: "×"
                            onClicked: root.controller.dismissError()
                        }
                    }
                    Loader {
                        Layout.fillWidth: true
                        sourceComponent: root.page === 0 ? triggerPage : root.page === 1 ? recognitionPage : root.page === 7 ? historyPage : root.page === 8 ? aboutPage : formPage
                    }
                    Item {
                        Layout.preferredHeight: 32
                    }
                }
            }
        }
    }
    MouseArea {
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        width: 7
        height: 7
        cursorShape: Qt.SizeFDiagCursor
        onPressed: root.startSystemResize(Qt.RightEdge | Qt.BottomEdge)
    }
    function field(key, label, type, hint, options, unit, factor) {
        return {
            key: key,
            label: label,
            type: type,
            hint: hint || "",
            options: options || [],
            unit: unit || "",
            factor: factor || 1,
            secret: key === "llmApiKey"
        };
    }
    function options(values, labels) {
        return values.map((v, i) => ({
                    value: v,
                    label: labels[i]
                }));
    }
    property var forms: {
        let t = root.tr, f = root.field, o = root.options, cfg = root.controller.settings;
        let keyboard = [f("keyboardEnabled", t("键盘触发", "Keyboard trigger"), "bool"), f("keyboardMode", t("触发方式", "Mode"), "select", "", o(["hold", "toggle", "doubleTap"], [t("按住说话，松开结束", "Hold to talk, release to finish"), t("按一下开始，再按一下结束", "Press to start / finish"), t("双击开始，单击结束", "Double tap to start, tap to finish")]))];
        keyboard.push(cfg.keyboardMode === "toggle" ? f("accelerator", t("组合键", "Shortcut"), "text") : f("keyboardKey", t("按键", "Key"), "select", "", o(["CtrlRight", "AltRight", "ShiftRight", "MetaRight", "Ctrl", "Alt", "CapsLock"].concat(Array.from({
            length: 24
        }, (_, i) => "F" + (i + 1))), [t("右 Ctrl（推荐）", "Right Ctrl (recommended)"), "Right Alt", "Right Shift", "Right Win", "Left Ctrl", "Left Alt", "Caps Lock"].concat(Array.from({
            length: 24
        }, (_, i) => "F" + (i + 1))))));
        keyboard.push(f("keyboardInFullscreen", t("在全屏应用中使用", "Allow in full screen"), "bool"), f("minHoldMs", t("最短录音时长", "Minimum recording"), "number", t("短于此时长不识别", "Shorter recordings are ignored"), [], "ms"));
        if (cfg.keyboardMode === "doubleTap")
            keyboard.push(f("doubleTapWindowMs", t("双击间隔", "Double tap interval"), "number", "", [], "ms"));
        return {
            0: [
                {
                    title: t("键盘", "Keyboard"),
                    fields: keyboard
                },
                {
                    title: t("鼠标", "Mouse"),
                    fields: [f("mouseEnabled", t("鼠标触发", "Mouse trigger"), "bool"), f("mouseButton", t("按键", "Button"), "select", "", o(["left", "middle", "leftMiddle"], [t("左键", "Left button"), t("中键", "Middle button"), t("左键 + 中键", "Left + middle")])), f("mouseHoldDelayMs", t("按住多久开始", "Hold delay"), "number", "", [], t("秒", "s"), 1000), f("mouseInFullscreen", t("在全屏应用中使用", "Allow in full screen"), "bool")]
                }
            ],
            2: [
                {
                    title: t("口语清理", "Speech cleanup"),
                    hint: t("在本地删除口头禅和重复词", "Removes fillers and repetitions locally"),
                    fields: [f("cleanupLevel", t("清理程度", "Level"), "select", "", o(["off", "light", "standard"], [t("关闭", "Off"), t("轻度", "Light"), t("标准", "Standard")])), f("protectHotwords", t("保护个人热词", "Protect hotwords"), "bool")]
                },
                {
                    title: t("额外口头禅", "Extra fillers"),
                    words: "extraFillers",
                    fields: []
                }
            ],
            3: [
                {
                    title: t("整理方式", "Editing mode"),
                    hint: t("启用后仅将识别文字发送给所选服务", "When enabled, sends only the transcript to your service"),
                    fields: [f("consolidationMode", t("AI 整理", "AI editing"), "select", "", o(["off", "onFinish", "rolling"], [t("关闭", "Off"), t("结束录音后", "After recording"), t("边说边整理", "While speaking")])), f("minChars", t("最少字数", "Minimum length"), "number", "", [], t("字", "chars")), f("rollingChars", t("每次新增字数", "Edit every"), "number", "", [], t("字", "chars")), f("maxReplaceChars", t("自动替换上限", "Replacement limit"), "number", t("超出时仅保存结果，不替换已输入文字", "Longer results are saved without replacing inserted text"), [], t("字", "chars"))]
                },
                {
                    title: t("服务", "Service"),
                    fields: [f("llmEnabled", t("启用服务", "Enable service"), "bool"), f("llmBaseUrl", "API URL", "text"), f("llmApiKey", "API Key", "text"), f("llmModel", t("模型", "Model"), "text"), f("llmTimeoutMs", t("超时", "Timeout"), "number", "", [], t("秒", "s"), 1000)]
                }
            ],
            4: [
                {
                    title: t("输入方式", "Input method"),
                    fields: [f("injectionStrategy", t("文字输入", "Text input"), "select", "", o(["auto", "unicode", "clipboard"], [t("自动（推荐）", "Automatic (recommended)"), t("逐字输入", "Unicode typing"), t("剪贴板粘贴", "Clipboard paste")])), f("clipboardThreshold", t("长文本使用粘贴", "Paste longer text"), "number", "", [], t("字", "chars")), f("restoreClipboard", t("恢复剪贴板", "Restore clipboard"), "bool"), f("injectMode", t("输入时机", "Timing"), "select", t("实时输入时请勿移动光标或修改文字", "Keep the cursor and text unchanged during live typing"), o(["segment", "live"], [t("每句定稿后", "After each sentence"), t("实时输入", "Live typing")]))]
                },
                {
                    title: t("始终使用粘贴的应用", "Apps that always use paste"),
                    hint: t("填写进程名，例如 WINWORD.EXE", "Process names, for example WINWORD.EXE"),
                    words: "clipboardOnlyApps",
                    fields: []
                }
            ],
            5: [
                {
                    title: t("启动", "Startup"),
                    fields: [f("launchAtLogin", t("开机自启", "Launch at login"), "bool", t("登录 Windows 后在后台运行", "Run in the background after signing in"))]
                },
                {
                    title: t("更新", "Updates"),
                    hint: t("启动时会自动检查更新；关闭自动更新后仅提示。", "Checks at startup. With automatic updates off, you will be notified."),
                    fields: [f("autoUpdate", t("自动更新", "Automatic updates"), "bool", t("发现新版后自动下载安装并重启", "Download and install new versions automatically"))]
                },
                {
                    title: t("语言", "Language"),
                    fields: [f("language", t("界面语言", "Interface language"), "select", "", o(["zh", "en"], ["简体中文", "English"]))]
                }
            ],
            6: [
                {
                    title: t("主题", "Theme"),
                    fields: [],
                    swatches: true
                },
                {
                    title: t("悬浮窗", "Recording overlay"),
                    fields: [f("followCaret", t("跟随光标", "Follow text cursor"), "bool")]
                }
            ]
        };
    }
    Component {
        id: formPage
        ColumnLayout {
            spacing: 16
            Repeater {
                model: root.forms[root.page] || []
                delegate: Section {
                    id: group
                    required property var modelData
                    required property int index
                    heading: modelData.title
                    hint: modelData.hint || ""
                    first: index === 0
                    RowLayout {
                        visible: Boolean(group.modelData.swatches)
                        Layout.fillWidth: true
                        spacing: 12
                        Repeater {
                            model: [
                                {
                                    value: "system",
                                    label: root.tr("跟随系统", "System"),
                                    color: "#b7bac0"
                                },
                                {
                                    value: "light",
                                    label: root.tr("浅色", "Light"),
                                    color: "#ffffff"
                                },
                                {
                                    value: "dark",
                                    label: root.tr("深色", "Dark"),
                                    color: "#242528"
                                }
                            ]
                            delegate: Rectangle {
                                id: swatch
                                required property var modelData
                                Layout.fillWidth: true
                                height: 108
                                radius: 8
                                color: root.surface
                                border.color: root.controller.settings.theme === modelData.value ? root.accent : root.line
                                Rectangle {
                                    x: 10
                                    y: 10
                                    width: parent.width - 20
                                    height: 58
                                    radius: 6
                                    color: swatch.modelData.color
                                    border.color: "#909399"
                                    Rectangle {
                                        x: 10
                                        y: 12
                                        width: 25
                                        height: 34
                                        radius: 3
                                        color: "#909399"
                                    }
                                    Column {
                                        x: 44
                                        y: 17
                                        spacing: 8
                                        Rectangle {
                                            width: 30
                                            height: 5
                                            radius: 2
                                            color: "#909399"
                                        }
                                        Rectangle {
                                            width: 23
                                            height: 5
                                            radius: 2
                                            color: root.accent
                                        }
                                    }
                                }
                                Label {
                                    font.family: root.font.family
                                    x: 10
                                    y: 80
                                    text: swatch.modelData.label
                                    color: root.fg
                                }
                                MouseArea {
                                    anchors.fill: parent
                                    onClicked: root.controller.setSetting("theme", swatch.modelData.value)
                                }
                            }
                        }
                    }
                    Repeater {
                        model: group.modelData.fields
                        delegate: FormRow {
                            required property var modelData
                            field: modelData
                        }
                    }
                    Loader {
                        active: Boolean(group.modelData.words)
                        Layout.fillWidth: true
                        sourceComponent: Component {
                            Words {
                                settingKey: group.modelData.words || ""
                            }
                        }
                    }
                }
            }
            Section {
                visible: root.page === 2
                heading: root.tr("效果预览", "Preview")
                Input {
                    id: preview
                    Layout.fillWidth: true
                    text: root.tr("嗯，那个，今天天气很好。", "Um, well, the weather is nice today.")
                }
                Note {
                    text: {
                        let cfg = root.controller.settings;
                        return root.controller.cleanupPreview(preview.text);
                    }
                    color: root.fg
                }
            }
            Section {
                visible: root.page === 3
                heading: root.tr("整理要求", "Editing instructions")
                BoundedScroll {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 120
                    TextArea {
                        id: prompt
                        WheelHandler {
                            target: null
                            acceptedDevices: PointerDevice.Mouse | PointerDevice.TouchPad
                            onWheel: event => root.scrollSettings(event)
                        }
                        font.family: root.font.family
                        text: root.controller.settings.consolidatePrompt
                        wrapMode: TextEdit.Wrap
                        color: root.fg
                        padding: 10
                        selectByMouse: true
                        background: Rectangle {
                            radius: 8
                            color: root.surface
                            border.color: root.line
                        }
                    }
                }
                Action {
                    text: root.tr("保存", "Save")
                    onClicked: {
                        prompt.focus = false;
                        root.controller.setSetting("consolidatePrompt", prompt.text);
                    }
                }
            }
        }
    }
    Component {
        id: triggerPage
        ColumnLayout {
            spacing: 16
            Section {
                first: true
                heading: root.tr("键盘触发", "Keyboard trigger")
                toggleKey: "keyboardEnabled"
                ColumnLayout {
                    visible: root.controller.settings.keyboardEnabled
                    Layout.fillWidth: true
                    spacing: 16
                    Repeater {
                        model: root.forms[0][0].fields.filter(f => f.key !== "keyboardEnabled" && f.key !== "keyboardInFullscreen")
                        delegate: FormRow {
                            required property var modelData
                            field: modelData
                        }
                    }
                    FormRow {
                        field: root.field("keyboardInFullscreen", root.tr("允许在全屏应用中使用", "Allow in full screen"), "bool")
                    }
                    Note {
                        text: root.tr("键盘录音时按 Esc 取消。", "Press Esc to cancel keyboard recording.")
                    }
                }
            }
            Section {
                heading: root.tr("鼠标触发", "Mouse trigger")
                toggleKey: "mouseEnabled"
                ColumnLayout {
                    visible: root.controller.settings.mouseEnabled
                    Layout.fillWidth: true
                    spacing: 16
                    Repeater {
                        model: root.forms[0][1].fields.filter(f => f.key !== "mouseEnabled")
                        delegate: FormRow {
                            required property var modelData
                            field: modelData
                        }
                    }
                    Note {
                        text: root.tr("按住说话，松开结束；组合按键需同时按住。中键可能触发应用的滚动功能。", "Hold to talk, release to finish. Hold both buttons for a combination. The middle button may also trigger scrolling.")
                    }
                }
            }
            Section {
                heading: ""
                visible: root.controller.settings.keyboardEnabled || root.controller.settings.mouseEnabled
                FormRow {
                    field: root.field("debounceMs", root.tr("重复触发间隔", "Repeat interval"), "number", root.tr("间隔过短时忽略重复触发", "Ignore triggers within this interval"), [], root.tr("毫秒", "ms"))
                }
            }
            Note {
                visible: !root.controller.settings.keyboardEnabled && !root.controller.settings.mouseEnabled
                text: root.tr("当前未启用录音触发。", "No recording trigger is enabled.")
            }
        }
    }
    Component {
        id: recognitionPage
        ColumnLayout {
            spacing: 16
            Section {
                first: true
                heading: root.tr("麦克风", "Microphone")
                FormRow {
                    field: root.field("deviceId", root.tr("输入设备", "Input device"), "select", "", root.controller.devices.map(d => ({
                                label: d.id ? d.name : root.tr("系统默认", "System default"),
                                value: d.id
                            })))
                }
                RowLayout {
                    Layout.fillWidth: true
                    Action {
                        text: root.controller.testing ? root.tr("停止测试", "Stop test") : root.tr("测试麦克风", "Test microphone")
                        enabled: root.controller.serviceEnabled
                        onClicked: root.controller.toggleMicTest()
                    }
                    GreenProgress {
                        Layout.fillWidth: true
                        implicitHeight: 6
                        value: root.controller.testLevel
                    }
                }
                RowLayout {
                    Action {
                        text: root.controller.recording ? root.tr("结束录音", "Finish recording") : root.tr("试说一句", "Try dictation")
                        enabled: root.controller.serviceEnabled && root.controller.state !== "recognizing"
                        onClicked: root.controller.toggleRecording()
                    }
                    Action {
                        text: root.tr("复制结果", "Copy result")
                        enabled: root.controller.result.length > 0
                        onClicked: root.controller.copyResult()
                    }
                }
                Note {
                    visible: root.controller.result.length > 0
                    text: root.controller.result
                    color: root.muted
                }
            }
            Section {
                heading: root.tr("分段", "Segmentation")
                FormRow {
                    field: root.field("endpointSilenceMs", root.tr("停顿多久后定稿", "Finish after silence"), "number", "", [], root.tr("秒", "s"), 1000)
                }
            }
            Section {
                heading: root.tr("内存", "Memory")
                FormRow {
                    field: root.field("idleUnloadMin", root.tr("空闲释放内存", "Unload when idle"), "number", root.tr("0 表示不释放；释放后首次识别稍慢", "0 keeps models loaded; the next start takes longer after unloading"), [], root.tr("分钟", "min"))
                }
                RowLayout {
                    Action {
                        text: root.tr("重新加载模型", "Reload models")
                        onClicked: root.controller.reloadModel()
                    }
                    Action {
                        text: root.tr("打开模型目录", "Open model folder")
                        onClicked: root.controller.openModelDirectory()
                    }
                }
            }
            Section {
                heading: root.tr("流式模型", "Streaming model")
                hint: root.tr("边说边预览；不使用时仅显示音量", "Live preview while speaking; optional")
                Models {
                    entries: root.controller.streamingModels
                    role: "streamingModel"
                    allowNone: root.controller.settings.modelId !== "none"
                }
            }
            Section {
                heading: root.tr("定稿模型", "Final recognition model")
                hint: root.tr("说完后生成最终文字", "Produces the final transcript")
                Models {
                    entries: root.controller.models
                    role: "modelId"
                    allowNone: root.controller.settings.streamingModel !== "none"
                }
            }
            Section {
                heading: root.tr("同音纠错", "Homophone correction")
                hint: root.tr("在本地修正同音误识别", "Corrects sound-alike words locally")
                Models {
                    entries: root.controller.correctionModels
                    role: "correctionModel"
                }
            }
            Section {
                heading: root.tr("标点", "Punctuation")
                Models {
                    entries: root.controller.punctuationModels
                    role: "punct"
                    allowNone: false
                }
            }
            Section {
                heading: root.tr("个人热词", "Personal hotwords")
                hint: root.tr("人名、术语等，仅用于最终输出", "Names and terms, used for the final transcript")
                Words {
                    settingKey: "hotwords"
                }
            }
            Section {
                heading: root.tr("雾凇词库", "Rime Ice dictionary")
                hint: root.tr("完整基础词库，按读音辅助定稿", "Full dictionary for phonetic matching")
                FormRow {
                    field: root.field("dictionaryEnabled", root.tr("使用基础词库", "Use dictionary"), "bool")
                }
                FormRow {
                    field: root.field("dictionaryAutoUpdate", root.tr("自动更新词库", "Update automatically"), "bool", root.tr("每周检查一次", "Checked weekly"))
                }
                RowLayout {
                    Layout.fillWidth: true
                    Label {
                        font.family: root.font.family
                        text: Number(root.controller.dictionary.count || 0).toLocaleString(Qt.locale()) + root.tr(" 个词 · ", " words · ") + (root.controller.dictionary.updatedAt || "")
                        color: root.muted
                        Layout.fillWidth: true
                        font.pixelSize: 12
                    }
                    Action {
                        text: root.controller.dictionary.updating ? root.tr("更新中…", "Updating…") : root.tr("更新词库", "Update dictionary")
                        enabled: !root.controller.dictionary.updating
                        onClicked: root.controller.updateDictionary()
                    }
                }
                Note {
                    text: root.controller.dictionary.error || ""
                    visible: text.length > 0
                    color: root.danger
                }
                Label {
                    font.family: root.font.family
                    text: root.tr("来源：", "Source: ") + "<a href='https://github.com/iDvel/rime-ice'>雾凇拼音</a> · GPL-3.0"
                    textFormat: Text.RichText
                    color: root.muted
                    linkColor: root.muted
                    onLinkActivated: function (link) {
                        Qt.openUrlExternally(link);
                    }
                }
            }
        }
    }
    Component {
        id: historyPage
        ColumnLayout {
            spacing: 16
            RowLayout {
                Layout.fillWidth: true
                Note {
                    text: root.tr("共 ", "") + root.controller.statistics.count + root.tr(" 次 · ", " recordings · ") + root.controller.statistics.characters + root.tr(" 字 · 节省约 ", " characters · ~") + root.controller.statistics.minutes + root.tr(" 分钟", " minutes saved")
                }
                Action {
                    text: root.tr("清空", "Clear")
                    enabled: root.controller.history.length > 0
                    onClicked: root.controller.clearHistory()
                }
            }
            Note {
                visible: root.controller.history.length === 0
                text: root.tr("还没有记录，试着说一句吧", "No recordings yet. Try dictation.")
            }
            Repeater {
                model: root.controller.history
                delegate: Rectangle {
                    id: historyRow
                    required property var modelData
                    required property int index
                    Layout.fillWidth: true
                    implicitHeight: historyBody.implicitHeight + 24
                    color: root.surface
                    radius: 8
                    border.color: root.line
                    ColumnLayout {
                        id: historyBody
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.margins: 12
                        spacing: 10
                        RowLayout {
                            Layout.fillWidth: true
                            Note {
                                text: new Date(historyRow.modelData.time).toLocaleString(Qt.locale()) + " · " + Math.round(Number(historyRow.modelData.duration || 0) / 1000) + root.tr(" 秒", " s")
                            }
                            Action {
                                text: root.tr("复制", "Copy")
                                onClicked: root.controller.copyText(historyRow.modelData.text)
                            }
                            DeleteButton {
                                onClicked: root.controller.deleteHistory(historyRow.index)
                            }
                        }
                        Label {
                            font.family: root.font.family
                            text: historyRow.modelData.text
                            color: root.fg
                            Layout.fillWidth: true
                            wrapMode: Text.Wrap
                            font.pixelSize: 13
                        }
                    }
                }
            }
        }
    }
    Component {
        id: aboutPage
        ColumnLayout {
            spacing: 16
            Section {
                first: true
                heading: "Vocal"
                Note {
                    text: root.tr("本地语音输入工具。语音识别在本机完成，录音不会上传。", "Local voice typing. Speech recognition runs on your computer; audio is never uploaded.")
                    color: root.muted
                }
                Label {
                    font.family: root.font.family
                    text: root.tr("由 ", "Developed by ") + "<a href='https://blog.dtft.net/about/'>Ramos</a>" + root.tr(" 开发", "")
                    color: root.muted
                    linkColor: root.accent
                    textFormat: Text.RichText
                    onLinkActivated: function (link) {
                        Qt.openUrlExternally(link);
                    }
                }
                Note {
                    text: "Vocal " + root.controller.version
                }
                RowLayout {
                    Action {
                        text: "GitHub"
                        onClicked: Qt.openUrlExternally("https://github.com/razaxq/vocal")
                    }
                    Action {
                        text: root.tr("反馈问题", "Report an issue")
                        onClicked: Qt.openUrlExternally("https://github.com/razaxq/vocal/issues")
                    }
                }
            }
            Section {
                heading: root.tr("资源占用", "Resource usage")
                RowLayout {
                    Layout.fillWidth: true
                    spacing: 30
                    ColumnLayout {
                        Note {
                            text: root.tr("内存", "Memory")
                        }
                        Label {
                            font.family: root.font.family
                            text: Number(root.controller.resources.memory || 0).toFixed(0) + " MB"
                            font.pixelSize: 22
                            font.weight: Font.DemiBold
                            color: root.fg
                        }
                    }
                    ColumnLayout {
                        Note {
                            text: "CPU"
                        }
                        Label {
                            font.family: root.font.family
                            text: Number(root.controller.resources.cpu || 0).toFixed(1) + "%"
                            font.pixelSize: 22
                            font.weight: Font.DemiBold
                            color: root.fg
                        }
                    }
                    ColumnLayout {
                        Note {
                            text: root.tr("已运行", "Uptime")
                        }
                        Label {
                            font.family: root.font.family
                            text: Math.floor(Number(root.controller.resources.uptime || 0) / 60000) + root.tr(" 分钟", " min")
                            font.pixelSize: 22
                            color: root.fg
                        }
                    }
                    Item {
                        Layout.fillWidth: true
                    }
                }
                Repeater {
                    model: root.controller.resourceProcesses
                    delegate: RowLayout {
                        id: process
                        required property var modelData
                        objectName: "resourceRow-" + modelData.id
                        Layout.fillWidth: true
                        Label {
                            font.family: root.font.family
                            text: process.modelData.name
                            color: root.fg
                            Layout.preferredWidth: 80
                        }
                        GreenProgress {
                            Layout.fillWidth: true
                            value: Number(process.modelData.share)
                        }
                        Label {
                            font.family: root.font.family
                            text: Number(process.modelData.memory).toFixed(0) + " MB"
                            color: root.muted
                            Layout.preferredWidth: 68
                            horizontalAlignment: Text.AlignRight
                        }
                        Label {
                            font.family: root.font.family
                            text: Number(process.modelData.cpu).toFixed(1) + "%"
                            color: root.subtle
                            Layout.preferredWidth: 44
                            horizontalAlignment: Text.AlignRight
                        }
                    }
                }
            }
            Section {
                heading: root.tr("存储", "Storage")
                Note {
                    text: root.controller.modelDirectory
                    color: root.muted
                }
                RowLayout {
                    Note {
                        text: root.tr("模型占用：", "Models: ") + Number(root.controller.resources.modelMB || 0).toFixed(0) + " MB"
                    }
                    Action {
                        text: root.tr("打开模型目录", "Open model folder")
                        onClicked: root.controller.openModelDirectory()
                    }
                }
            }
            Section {
                heading: root.tr("更新", "Updates")
                RowLayout {
                    Layout.fillWidth: true
                    Note {
                        text: root.controller.update.message || ""
                        color: root.muted
                    }
                    Action {
                        text: root.controller.update.available ? root.tr("立即更新", "Update now") : root.tr("检查更新", "Check for updates")
                        enabled: ["checking", "downloading"].indexOf(root.controller.update.state) < 0
                        onClicked: root.controller.update.available ? root.controller.installUpdate() : root.controller.checkUpdates()
                    }
                }
            }
            Section {
                heading: root.tr("开源许可", "Open source")
                Note {
                    text: "Vocal · MIT\nQt · LGPL-3.0\nsherpa-onnx · Apache-2.0\nONNX Runtime · MIT\n雾凇拼音 · GPL-3.0"
                }
            }
            Section {
                heading: root.tr("更新日志", "Changelog")
                Repeater {
                    model: root.controller.changelog
                    delegate: ColumnLayout {
                        id: change
                        required property var modelData
                        Layout.fillWidth: true
                        spacing: 6
                        Label {
                            font.family: root.font.family
                            text: "v" + change.modelData.version + " · " + change.modelData.date
                            font.weight: Font.DemiBold
                            color: root.fg
                        }
                        Note {
                            text: change.modelData.changes.map(x => "• " + x).join("\n")
                            color: root.muted
                        }
                    }
                }
            }
        }
    }
    VoiceOverlay {
        objectName: "voiceOverlay"
        sessionActive: root.controller.sessionActive
        busy: root.controller.recording
        compact: root.controller.settings.streamingModel === "none"
        committed: root.controller.committedText
        live: root.controller.liveText
        message: root.controller.recording ? root.tr("正在听", "Listening") : root.tr("整理中", "Finishing")
        en: root.en
        level: root.controller.level
        dark: root.dark
        position: root.controller.overlayPosition
    }
}
