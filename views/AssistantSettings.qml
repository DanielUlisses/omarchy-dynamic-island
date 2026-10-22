import QtQuick
import qs.Commons

// Assistant settings: where your secretary repo lives (Island Chat's
// Secretary switch runs there). Saved to the island's entry in shell.json as
// "secretaryPath", the same key you can edit by hand.
Item {
  id: view

  property var island: null
  readonly property var assistant: island.assistant
  readonly property string saved: String(island.setting("secretaryPath", "~/secretary"))

  function save(text) {
    var t = String(text || "").trim()
    if (t === "" || t === view.saved) return
    island.saveSettings({ secretaryPath: t })
    // The daemon reads shell.json when asked; ask so the switch follows.
    saveTimer.restart()
  }

  Timer { id: saveTimer; interval: 400; onTriggered: view.assistant.refreshAccounts() }

  Column {
    anchors.fill: parent
    spacing: island.s(8)

    Text {
      text: "Secretary"
      textFormat: Text.PlainText
      renderType: Text.NativeRendering
      font.family: island.textFamily
      font.pixelSize: island.f(12)
      font.weight: Font.DemiBold
      color: island.fg
    }

    Text {
      width: parent.width
      wrapMode: Text.WordWrap
      text: "The folder of your secretary repo. With a CLAUDE.md there, Island Chat gets a Secretary switch that runs the chat in it, with its rules and skills."
      textFormat: Text.PlainText
      renderType: Text.NativeRendering
      font.family: island.textFamily
      font.pixelSize: island.f(10)
      color: island.fgDim
    }

    Rectangle {
      width: parent.width
      height: island.s(34)
      radius: height / 2
      color: Util.alpha(island.fg, field.activeFocus ? 0.1 : 0.07)
      border.width: 1
      border.color: Util.alpha(field.activeFocus ? island.accentColor : island.fg, field.activeFocus ? 0.45 : 0.06)
      Behavior on color { ColorAnimation { duration: 180 } }

      TextInput {
        id: field
        anchors.left: parent.left
        anchors.leftMargin: island.s(14)
        anchors.right: parent.right
        anchors.rightMargin: island.s(14)
        anchors.verticalCenter: parent.verticalCenter
        clip: true
        text: view.saved
        font.family: island.textFamily
        font.pixelSize: island.f(12)
        color: island.fg
        selectionColor: Util.alpha(island.accentColor, 0.4)
        renderType: Text.NativeRendering
        selectByMouse: true
        onAccepted: view.save(text)
        onEditingFinished: view.save(text)
        Keys.onEscapePressed: island.collapse()

        Text {
          anchors.fill: parent
          verticalAlignment: Text.AlignVCenter
          visible: !field.text
          text: "~/secretary"
          textFormat: Text.PlainText
          font: field.font
          color: Util.alpha(island.fg, 0.38)
        }
      }

      MouseArea {
        anchors.fill: parent
        cursorShape: Qt.IBeamCursor
        enabled: !field.activeFocus
        onClicked: field.forceActiveFocus()
      }
    }

    Text {
      width: parent.width
      elide: Text.ElideMiddle
      text: !view.assistant.connected ? "The island daemon isn't running."
        : (view.assistant.secretary.present ? "󰄬  Found " + view.assistant.secretary.path
          : "No CLAUDE.md in " + (view.assistant.secretary.path || view.saved))
      textFormat: Text.PlainText
      renderType: Text.NativeRendering
      font.family: island.textFamily
      font.pixelSize: island.f(10)
      color: view.assistant.secretary.present ? island.greenColor : island.orangeColor
    }
  }
}
