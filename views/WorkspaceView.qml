import QtQuick
import qs.Commons
import "../IslandModel.js" as Model

// The expanded workspace, opened by poking the avatar (or island-ctl). A row
// of icon tabs on top (Home: your agents and their live diffs, Chat, Plans,
// and + to start a new agent in herdr), and the tab's page in a soft card
// below. Pages cross-fade. 󰐃 pins it open (it otherwise closes when the
// pointer leaves, except while you're typing).
Item {
  id: view

  property var island: null
  readonly property var assistant: island.assistant
  readonly property int pad: island.s(14)
  readonly property var tabs: [
    { key: "agents", glyph: "󰋜", tip: "Home" },
    { key: "chat", glyph: "󰭹", tip: "Chat" },
    { key: "plans", glyph: "󰓅", tip: "Plans" },
    { key: "settings", glyph: "󰒓", tip: "Settings" }
  ]
  readonly property var activeAccount: {
    var list = assistant.accounts
    for (var i = 0; i < list.length; i++) if (list[i].active && list[i].canSpawn) return list[i]
    return null
  }

  // ---- header: icon tabs left, totals / pin / close right
  Row {
    id: tabRow
    x: view.pad + island.s(4)
    y: view.pad - island.s(2)
    height: island.s(34)
    spacing: island.s(4)

    Repeater {
      model: view.tabs
      delegate: Item {
        id: tab
        required property var modelData
        readonly property bool current: island.workspaceTab === modelData.key
        readonly property bool alerting: modelData.key === "agents" && view.assistant.approvals.length > 0
        width: island.s(44)
        height: island.s(34)
        scale: tabMouse.pressed ? 0.92 : 1
        Behavior on scale { NumberAnimation { duration: 120; easing.type: Easing.OutCubic } }

        Rectangle {
          anchors.fill: parent
          radius: height / 2
          color: Util.alpha(island.fg, tab.current ? 0.13 : (tabMouse.containsMouse ? 0.07 : 0))
          Behavior on color { ColorAnimation { duration: 180 } }
        }
        Text {
          anchors.centerIn: parent
          text: tab.modelData.glyph
          textFormat: Text.PlainText
          renderType: Text.NativeRendering
          font.family: island.fontFamily
          font.pixelSize: island.f(17)
          color: tab.current ? island.fg : island.fgDim
          Behavior on color { ColorAnimation { duration: 180 } }
        }
        Rectangle {
          visible: tab.alerting
          x: parent.width - width - island.s(8)
          y: island.s(6)
          width: island.s(7)
          height: width
          radius: width / 2
          color: island.orangeColor
        }
        MouseArea {
          id: tabMouse
          anchors.fill: parent
          hoverEnabled: true
          cursorShape: Qt.PointingHandCursor
          onClicked: island.workspaceTab = tab.modelData.key
        }
      }
    }

    // + : a new agent in herdr, signed in to the default account.
    IconButton {
      visible: !!view.activeAccount
      anchors.verticalCenter: parent.verticalCenter
      glyph: "󰐕"
      glyphSize: island.f(16)
      color: island.fgDim
      fontFamily: island.fontFamily
      onClicked: view.assistant.spawn(view.activeAccount.id)
    }
  }

  Row {
    anchors.right: parent.right
    anchors.rightMargin: view.pad + island.s(4)
    anchors.verticalCenter: tabRow.verticalCenter
    spacing: island.s(2)

    Text {
      anchors.verticalCenter: parent.verticalCenter
      visible: text !== ""
      text: Model.diffText(view.assistant.totals.added, view.assistant.totals.removed)
      textFormat: Text.PlainText
      renderType: Text.NativeRendering
      font.family: island.fontFamily
      font.pixelSize: island.f(11)
      color: island.fgDim
      rightPadding: island.s(8)
    }

    IconButton {
      glyph: island.pinned ? "󰐃" : "󰤱"
      glyphSize: island.f(14)
      color: island.pinned ? island.accentColor : island.fgDim
      fontFamily: island.fontFamily
      onClicked: island.pinned = !island.pinned
    }

    IconButton {
      glyph: "󰅖"
      glyphSize: island.f(14)
      color: island.fgDim
      fontFamily: island.fontFamily
      onClicked: island.collapse()
    }
  }

  // ---- the page, in a soft card
  Rectangle {
    id: card
    x: view.pad
    y: tabRow.y + tabRow.height + island.s(10)
    width: parent.width - view.pad * 2
    height: parent.height - y - view.pad
    radius: island.s(24)
    color: Util.alpha(island.fg, 0.045)
    border.width: 1
    border.color: Util.alpha(island.fg, 0.07)
    clip: true

    Repeater {
      model: [
        { key: "agents", component: homePage },
        { key: "chat", component: chatPage },
        { key: "plans", component: plansPage },
        { key: "settings", component: settingsPage }
      ]
      delegate: Loader {
        id: page
        required property var modelData
        readonly property bool current: island.workspaceTab === modelData.key
        property bool visited: current
        onCurrentChanged: if (current) visited = true
        x: island.s(14)
        width: card.width - island.s(28)
        height: card.height - island.s(28)
        y: island.s(14) + (current ? 0 : island.s(8))
        active: visited
        visible: opacity > 0.01
        opacity: current ? 1 : 0
        sourceComponent: modelData.component
        Behavior on opacity { NumberAnimation { duration: 220; easing.type: Easing.OutCubic } }
        Behavior on y { NumberAnimation { duration: 260; easing.type: Easing.OutCubic } }
      }
    }
  }

  Component { id: homePage; AgentsDiffsView { island: view.island } }
  Component { id: chatPage; AgentChatView { island: view.island } }
  Component { id: plansPage; AccountPlansView { island: view.island } }
  Component { id: settingsPage; AssistantSettings { island: view.island } }
}
