import QtQuick
import qs.Commons

// A small rounded text button for the assistant's cards and tabs.
Item {
  id: button

  property var island: null
  property string label: ""
  property color tone: island ? island.fg : "white"
  property bool filled: false
  property bool selected: false

  signal clicked()

  implicitWidth: text.implicitWidth + island.s(20)
  implicitHeight: island.s(26)
  opacity: enabled ? 1 : 0.4
  scale: mouse.pressed ? 0.94 : 1

  Behavior on scale { NumberAnimation { duration: 120; easing.type: Easing.OutCubic } }

  Rectangle {
    anchors.fill: parent
    radius: height / 2
    color: button.filled ? Util.alpha(button.tone, mouse.containsMouse ? 0.42 : 0.32)
      : Util.alpha(button.tone, button.selected ? 0.22 : (mouse.containsMouse ? 0.14 : 0.07))
    border.width: button.selected ? 1 : 0
    border.color: Util.alpha(button.tone, 0.5)

    Behavior on color { ColorAnimation { duration: 120 } }
  }

  Text {
    id: text
    anchors.centerIn: parent
    text: button.label
    textFormat: Text.PlainText
    renderType: Text.NativeRendering
    font.family: island.textFamily
    font.pixelSize: island.f(11)
    font.weight: button.filled || button.selected ? Font.DemiBold : Font.Normal
    color: button.filled ? island.fg : (button.selected ? button.tone : island.fg)
  }

  MouseArea {
    id: mouse
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: button.enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
    onClicked: if (button.enabled) button.clicked()
  }
}
