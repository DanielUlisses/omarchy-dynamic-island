import QtQuick
import qs.Commons
import "../IslandModel.js" as Model

// Herdr agents, compact: a robot on the leading edge in the colour of the
// most urgent agent, that agent's task in the middle, and what it is doing
// (plus how many are live, when it is more than one) on the trailing edge.
Item {
  id: view

  property var island: null
  readonly property var agents: island.agents
  readonly property var lead: agents.first
  readonly property color tone: agents.tone

  Text {
    id: glyph
    anchors.left: parent.left
    anchors.leftMargin: island.s(13)
    anchors.verticalCenter: parent.verticalCenter
    text: "󰚩"
    textFormat: Text.PlainText
    renderType: Text.NativeRendering
    font.family: island.fontFamily
    font.pixelSize: island.f(15)
    color: view.tone

    // Breathes while the lead agent is still busy.
    SequentialAnimation on opacity {
      running: !!view.lead && view.lead.status === "working"
      loops: Animation.Infinite
      onRunningChanged: if (!running) glyph.opacity = 1
      NumberAnimation { to: 0.45; duration: 900; easing.type: Easing.InOutSine }
      NumberAnimation { to: 1; duration: 900; easing.type: Easing.InOutSine }
    }
  }

  Text {
    anchors.left: glyph.right
    anchors.leftMargin: island.s(9)
    anchors.right: diffTicker.visible ? diffTicker.left : stateText.left
    anchors.rightMargin: island.s(8)
    anchors.verticalCenter: parent.verticalCenter
    text: view.lead ? Model.agentTitle(view.lead) : ""
    textFormat: Text.PlainText
    renderType: Text.NativeRendering
    elide: Text.ElideRight
    font.family: island.textFamily
    font.pixelSize: island.f(12)
    color: island.fg
  }

  // Live diff ticker from the island's hook relay: what this agent changed.
  readonly property var row: view.lead && island.assistant ? island.assistant.rowFor(view.lead.key) : null
  Text {
    id: diffTicker
    visible: text !== ""
    anchors.right: stateText.left
    anchors.rightMargin: island.s(6)
    anchors.verticalCenter: parent.verticalCenter
    text: view.row ? Model.diffText(view.row.added, view.row.removed) : ""
    textFormat: Text.PlainText
    renderType: Text.NativeRendering
    font.family: island.fontFamily
    font.pixelSize: island.f(10)
    color: island.fgDim
  }

  Text {
    id: stateText
    anchors.right: count.visible ? count.left : parent.right
    anchors.rightMargin: count.visible ? island.s(6) : island.s(14)
    anchors.verticalCenter: parent.verticalCenter
    text: view.lead ? Model.agentStateText(view.lead.status) : ""
    textFormat: Text.PlainText
    renderType: Text.NativeRendering
    font.family: island.textFamily
    font.pixelSize: island.f(11)
    font.weight: Font.DemiBold
    color: view.tone
  }

  Rectangle {
    id: count
    visible: view.agents.live.length > 1
    anchors.right: parent.right
    anchors.rightMargin: island.s(9)
    anchors.verticalCenter: parent.verticalCenter
    height: island.s(18)
    width: Math.max(height, countText.implicitWidth + island.s(12))
    radius: height / 2
    color: Util.alpha(view.tone, 0.22)

    Text {
      id: countText
      anchors.centerIn: parent
      text: view.agents.live.length
      textFormat: Text.PlainText
      renderType: Text.NativeRendering
      font.family: island.textFamily
      font.pixelSize: island.f(11)
      font.weight: Font.DemiBold
      color: view.tone
    }
  }
}
