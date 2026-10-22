import QtQuick
import qs.Commons
import "../IslandModel.js" as Model

// The expanded workspace, opened by poking the avatar (or island-ctl): three
// tabs, Agents & Diffs, Claude Plans and Island Chat. 󰐃 pins it open (it
// otherwise closes when the pointer leaves, except while you're chatting).
Item {
  id: view

  property var island: null
  readonly property var assistant: island.assistant
  readonly property int pad: island.s(16)
  readonly property var tabs: [
    { key: "agents", label: "Agents & Diffs" },
    { key: "plans", label: "Claude Plans" },
    { key: "chat", label: "Island Chat" }
  ]

  Item {
    id: header
    x: view.pad
    y: view.pad - island.s(4)
    width: parent.width - view.pad * 2
    height: island.s(28)

    OmarchyAvatar {
      id: face
      anchors.left: parent.left
      anchors.verticalCenter: parent.verticalCenter
      width: island.s(26)
      height: width
      mood: island.avatarMood
      base: island.fg
      accent: island.accentColor
      glow: island.avatarGlow
      alert: island.orangeColor
      lookX: island.lookX
      lookY: island.lookY
      onPoked: island.collapse()
    }

    Row {
      anchors.left: face.right
      anchors.leftMargin: island.s(10)
      anchors.verticalCenter: parent.verticalCenter
      spacing: island.s(4)

      Repeater {
        model: view.tabs
        delegate: PillButton {
          required property var modelData
          island: view.island
          label: modelData.label + (modelData.key === "agents" && view.assistant.approvals.length > 0 ? "  ●" : "")
          selected: island.workspaceTab === modelData.key
          tone: modelData.key === "agents" && view.assistant.approvals.length > 0 ? island.orangeColor : island.accentColor
          onClicked: island.workspaceTab = modelData.key
        }
      }
    }

    Row {
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      spacing: island.s(2)

      Text {
        anchors.verticalCenter: parent.verticalCenter
        visible: text !== ""
        text: Model.diffText(view.assistant.totals.added, view.assistant.totals.removed)
        textFormat: Text.PlainText
        renderType: Text.NativeRendering
        font.family: island.fontFamily
        font.pixelSize: island.f(10)
        color: island.fgDim
        rightPadding: island.s(6)
      }

      IconButton {
        glyph: island.pinned ? "󰐃" : "󰤱"
        glyphSize: island.f(12)
        color: island.pinned ? island.accentColor : island.fgDim
        fontFamily: island.fontFamily
        onClicked: island.pinned = !island.pinned
      }

      IconButton {
        glyph: "󰅖"
        glyphSize: island.f(12)
        color: island.fgDim
        fontFamily: island.fontFamily
        onClicked: island.collapse()
      }
    }
  }

  Item {
    id: body
    x: view.pad
    y: header.y + header.height + island.s(10)
    width: parent.width - view.pad * 2
    height: parent.height - y - view.pad

    Loader {
      anchors.fill: parent
      active: island.workspaceTab === "agents"
      visible: active
      sourceComponent: AgentsDiffsView { island: view.island }
    }

    Loader {
      anchors.fill: parent
      active: island.workspaceTab === "plans"
      visible: active
      sourceComponent: AccountPlansView { island: view.island }
    }

    Loader {
      anchors.fill: parent
      active: island.workspaceTab === "chat"
      visible: active
      sourceComponent: AgentChatView { island: view.island }
    }
  }
}
