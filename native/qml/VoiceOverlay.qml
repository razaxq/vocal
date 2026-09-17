pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Window {
    id: overlay
    required property bool sessionActive
    required property string message
    required property real level
    property bool busy: false
    property bool compact: true
    property string committed: ""
    property string live: ""
    property bool en: false
    property point position
    property bool dark: false
    property var levels: [0, 0, 0, 0, 0]
    property bool waitingForFirstFrame: false
    readonly property bool hasText: committed.length + live.length > 0
    readonly property color foreground: dark ? "#e9eaec" : "#303133"
    readonly property color muted: dark ? "#a4a6ab" : "#606266"
    readonly property color subtle: dark ? "#75777d" : "#909399"
    visible: false
    opacity: 0
    transientParent: null
    width: compact ? 208 : 420
    height: compact ? 64 : 92
    x: position.x
    y: position.y
    flags: Qt.Tool | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.WindowDoesNotAcceptFocus | Qt.WindowTransparentForInput
    color: "transparent"
    onLevelChanged: levels = levels.slice(1).concat([Math.min(1, level)])
    onSessionActiveChanged: {
        entrance.stop();
        departure.stop();
        if (sessionActive) {
            if (!visible) {
                // Keep the native surface hidden until the new session has
                // rendered; showing it can otherwise expose its previous frame.
                opacity = 0;
                shell.opacity = 0;
                movement.y = 8;
                levels = [0, 0, 0, 0, 0];
                waitingForFirstFrame = true;
                visible = true;
            } else if (!waitingForFirstFrame) {
                entrance.start();
            }
        } else if (waitingForFirstFrame) {
            waitingForFirstFrame = false;
            opacity = 0;
            visible = false;
        } else if (visible) {
            departure.start();
        }
    }
    onFrameSwapped: {
        if (waitingForFirstFrame && sessionActive && visible) {
            waitingForFirstFrame = false;
            opacity = 1;
            entrance.start();
        }
    }
    ParallelAnimation {
        id: entrance
        NumberAnimation { target: shell; property: "opacity"; to: 1; duration: 170; easing.type: Easing.OutCubic }
        NumberAnimation { target: movement; property: "y"; to: 0; duration: 170; easing.type: Easing.OutCubic }
    }
    SequentialAnimation {
        id: departure
        ParallelAnimation {
            NumberAnimation { target: shell; property: "opacity"; to: 0; duration: 140; easing.type: Easing.InCubic }
            NumberAnimation { target: movement; property: "y"; to: 6; duration: 140; easing.type: Easing.InCubic }
        }
        ScriptAction {
            script: {
                overlay.opacity = 0;
                overlay.visible = false;
            }
        }
    }
    Rectangle {
        id: shell
        objectName: "overlayShell"
        anchors.fill: parent
        anchors.margins: 6
        radius: 16
        opacity: 0
        transform: Translate { id: movement }
        color: overlay.dark ? "#f0242528" : "#f0ffffff"
        border.color: overlay.dark ? "#35363a" : "#1a000000"
        RowLayout {
            anchors.fill: parent
            anchors.leftMargin: overlay.compact ? 14 : 16
            anchors.rightMargin: overlay.compact ? 14 : 16
            spacing: overlay.compact ? 10 : 12
            Item {
                Layout.preferredWidth: 36
                Layout.preferredHeight: 32
                Row {
                    anchors.centerIn: parent
                    height: 32
                    spacing: 3
                    Repeater {
                        model: 5
                        Rectangle {
                            required property int index
                            width: 3
                            height: 8 + Number(overlay.levels[index]) * 20
                            y: (32 - height) / 2
                            radius: 1.5
                            color: overlay.busy ? (overlay.dark ? "#85ce61" : "#67c23a") : (overlay.dark ? "#4a4c51" : "#dcdfe6")
                            Behavior on height { NumberAnimation { duration: 75 } }
                        }
                    }
                }
            }
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 2
                Label {
                    Layout.fillWidth: true
                    visible: overlay.compact || !overlay.hasText
                    text: overlay.message
                    font.family: "Microsoft YaHei UI"
                    font.pixelSize: 13
                    color: overlay.muted
                    elide: Text.ElideRight
                }
                Flickable {
                    id: transcript
                    Layout.fillWidth: true
                    Layout.preferredHeight: Math.min(52, body.implicitHeight)
                    visible: !overlay.compact && overlay.hasText
                    contentHeight: body.implicitHeight
                    clip: true
                    interactive: false
                    onContentHeightChanged: contentY = Math.max(0, contentHeight - height)
                    Text {
                        id: body
                        width: transcript.width
                        font.family: "Microsoft YaHei UI"
                        font.pixelSize: 15
                        lineHeight: 1.375
                        wrapMode: Text.Wrap
                        textFormat: Text.RichText
                        function escaped(value: string): string {
                            return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
                        }
                        text: "<span style='color:" + overlay.muted + "'>" + escaped(overlay.committed) + "</span><span style='color:" + overlay.foreground + "'>" + escaped(overlay.live) + "</span>"
                    }
                }
                Label {
                    Layout.fillWidth: true
                    visible: !overlay.compact && overlay.hasText
                    text: overlay.message + " · " + (overlay.committed.length + overlay.live.length) + (overlay.en ? " characters" : " 字")
                    font.family: "Microsoft YaHei UI"
                    font.pixelSize: 11
                    color: overlay.subtle
                }
            }
        }
    }
}
