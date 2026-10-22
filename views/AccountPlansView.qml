import QtQuick
import qs.Commons
import "../IslandModel.js" as Model

// Claude Plans: every account in accounts.json with its 5-hour and weekly
// usage, when each resets, how many sessions run on it right now, and buttons
// to make it the default for new shells or open a herdr tab signed in to it.
Item {
  id: view

  property var island: null
  readonly property var assistant: island.assistant
  readonly property real now: assistant.now

  function toneFor(pct) {
    var t = Model.planTier(pct)
    return t === "green" ? island.greenColor : (t === "orange" ? island.orangeColor : (t === "red" ? island.urgentColor : island.fgDim))
  }

  Text {
    anchors.centerIn: parent
    visible: view.assistant.accounts.length === 0
    width: parent.width - island.s(40)
    horizontalAlignment: Text.AlignHCenter
    wrapMode: Text.WordWrap
    text: view.assistant.connected ? "No accounts yet: add them to ~/.config/omarchy-dynamic-island/accounts.json"
      : "The island daemon isn't running. Run ./install-hooks.sh once to set it up."
    textFormat: Text.PlainText
    font.family: island.textFamily
    font.pixelSize: island.f(11)
    color: island.fgDim
  }

  ListView {
    anchors.fill: parent
    clip: true
    spacing: island.s(6)
    boundsBehavior: Flickable.StopAtBounds
    model: view.assistant.accounts

    delegate: Rectangle {
      id: row
      required property var modelData
      readonly property var a: modelData
      readonly property bool hasPlan: !!a.fiveHour || !!a.sevenDay
      width: ListView.view.width
      height: island.s(hasPlan ? 78 : 46)
      radius: island.s(14)
      color: Util.alpha(a.active ? island.accentColor : island.fg, a.active ? 0.1 : 0.04)
      border.width: a.active ? 1 : 0
      border.color: Util.alpha(island.accentColor, 0.3)

      Rectangle {
        id: dot
        x: island.s(12)
        y: island.s(14)
        width: island.s(7)
        height: width
        radius: width / 2
        color: row.a.health === "ok" ? island.greenColor : (row.a.health === "error" ? island.urgentColor : island.fgDim)
      }

      Text {
        id: name
        anchors.left: dot.right
        anchors.leftMargin: island.s(8)
        anchors.verticalCenter: dot.verticalCenter
        text: row.a.label + (row.a.active ? "  ★" : "")
        textFormat: Text.PlainText
        renderType: Text.NativeRendering
        font.family: island.textFamily
        font.pixelSize: island.f(12)
        font.weight: Font.DemiBold
        color: island.fg
      }

      Text {
        anchors.left: name.right
        anchors.leftMargin: island.s(8)
        anchors.right: buttons.left
        anchors.rightMargin: island.s(8)
        anchors.verticalCenter: dot.verticalCenter
        text: [row.a.kind === "claude" ? "Claude plan" : (row.a.kind === "anthropic-api" ? "API key" : (row.a.kind === "codex" ? "Codex" : "Ollama")),
               row.a.sessions > 0 ? row.a.sessions + (row.a.sessions === 1 ? " session" : " sessions") : "",
               row.a.model, row.a.detail].filter(function(x) { return x }).join("  ·  ")
        textFormat: Text.PlainText
        renderType: Text.NativeRendering
        elide: Text.ElideRight
        font.family: island.textFamily
        font.pixelSize: island.f(10)
        color: island.fgDim
      }

      Row {
        id: buttons
        anchors.right: parent.right
        anchors.rightMargin: island.s(8)
        y: island.s(5)
        spacing: island.s(4)
        PillButton { island: view.island; label: "Default"; visible: !row.a.active; onClicked: view.assistant.setActive(row.a.id) }
        PillButton { island: view.island; label: "󰆍 herdr"; visible: row.a.canSpawn; onClicked: view.assistant.spawn(row.a.id) }
      }

      Column {
        visible: row.hasPlan
        x: island.s(12)
        y: island.s(36)
        width: parent.width - island.s(24)
        spacing: island.s(6)

        Repeater {
          model: [{ label: "5 hours", w: row.a.fiveHour }, { label: "Week", w: row.a.sevenDay }]
          delegate: Item {
            id: bar
            required property var modelData
            readonly property real pct: Model.windowPct(modelData.w, view.now)
            visible: !!modelData.w
            width: parent.width
            height: island.s(14)

            Text {
              id: barLabel
              width: island.s(48)
              anchors.verticalCenter: parent.verticalCenter
              text: bar.modelData.label
              textFormat: Text.PlainText
              renderType: Text.NativeRendering
              font.family: island.textFamily
              font.pixelSize: island.f(10)
              color: island.fgDim
            }

            Rectangle {
              id: track
              anchors.left: barLabel.right
              anchors.right: pctText.left
              anchors.rightMargin: island.s(8)
              anchors.verticalCenter: parent.verticalCenter
              height: island.s(5)
              radius: height / 2
              color: Util.alpha(island.fg, 0.1)

              Rectangle {
                width: parent.width * Math.max(0, bar.pct) / 100
                height: parent.height
                radius: height / 2
                color: view.toneFor(bar.pct)
                Behavior on width { NumberAnimation { duration: 400; easing.type: Easing.OutCubic } }
              }
            }

            Text {
              id: pctText
              anchors.right: reset.left
              anchors.rightMargin: island.s(8)
              anchors.verticalCenter: parent.verticalCenter
              text: bar.pct >= 0 ? Math.round(bar.pct) + "%" : ""
              textFormat: Text.PlainText
              renderType: Text.NativeRendering
              font.family: island.fontFamily
              font.pixelSize: island.f(10)
              font.bold: true
              color: view.toneFor(bar.pct)
            }

            Text {
              id: reset
              anchors.right: parent.right
              width: island.s(110)
              horizontalAlignment: Text.AlignRight
              anchors.verticalCenter: parent.verticalCenter
              text: bar.modelData.w ? Model.resetText(bar.modelData.w.resetsAt, view.now) : ""
              textFormat: Text.PlainText
              renderType: Text.NativeRendering
              font.family: island.textFamily
              font.pixelSize: island.f(10)
              color: island.fgDim
            }
          }
        }
      }
    }
  }
}
