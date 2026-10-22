import QtQuick
import qs.Commons
import "../IslandModel.js" as Model

// Agents & Diffs: herdr's agents merged with Claude Code's hook sessions on
// the left (most urgent first, each with its live +N -M), and on the right
// the files the selected session changed, one diff at a time. A waiting
// approval sits on top. 󰈈 on a row lands on its herdr pane.
Item {
  id: view

  property var island: null
  readonly property var assistant: island.assistant
  readonly property var rows: assistant.agents
  property string selectedKey: ""
  readonly property var selected: {
    for (var i = 0; i < rows.length; i++) if (rows[i].key === selectedKey) return rows[i]
    return rows.length > 0 ? rows[0] : null
  }
  property var diffs: []
  property int diffIndex: 0
  readonly property string session: selected ? selected.hookSession : ""
  readonly property int diffCount: selected ? selected.diffCount : 0

  function load() {
    if (!session) { diffs = []; return }
    assistant.diffs(session, function(list) {
      var keepLast = view.diffIndex >= view.diffs.length - 1
      view.diffs = list
      if (keepLast || view.diffIndex >= list.length) view.diffIndex = Math.max(0, list.length - 1)
    })
  }
  onSessionChanged: { diffIndex = 0; load() }
  onDiffCountChanged: load()

  ApprovalCard {
    id: banner
    visible: !!view.assistant.approval
    x: -island.s(16)
    width: parent.width + island.s(32)
    height: visible ? (view.assistant.approval.questions.length ? Model.approvalSize(view.assistant.approval).h : island.s(122)) : 0
    island: view.island
    approval: view.assistant.approval
    compact: true
  }

  Text {
    anchors.centerIn: parent
    visible: view.rows.length === 0 && !banner.visible
    width: parent.width - island.s(40)
    horizontalAlignment: Text.AlignHCenter
    wrapMode: Text.WordWrap
    text: view.assistant.connected ? "No coding agents right now. Start Claude Code (in herdr or anywhere) and it shows up here."
      : "The island daemon isn't running. Run ./install-hooks.sh once to set it up."
    textFormat: Text.PlainText
    font.family: island.textFamily
    font.pixelSize: island.f(11)
    color: island.fgDim
  }

  ListView {
    id: list
    visible: view.rows.length > 0
    x: 0
    y: banner.height + (banner.visible ? island.s(6) : 0)
    width: island.s(250)
    height: parent.height - y
    clip: true
    spacing: island.s(4)
    boundsBehavior: Flickable.StopAtBounds
    model: view.rows

    delegate: Rectangle {
      id: row
      required property var modelData
      readonly property bool current: view.selected && view.selected.key === modelData.key
      readonly property color tone: modelData.status === "blocked" ? island.urgentColor
        : (modelData.status === "done" ? island.greenColor : (modelData.status === "working" ? modelData.color : island.fgDim))
      width: ListView.view.width
      height: island.s(46)
      radius: island.s(14)
      color: Util.alpha(row.current ? island.accentColor : island.fg, row.current ? 0.14 : (rowMouse.containsMouse ? 0.08 : 0.04))

      Rectangle {
        id: dot
        anchors.left: parent.left
        anchors.leftMargin: island.s(11)
        anchors.verticalCenter: parent.verticalCenter
        width: island.s(7)
        height: width
        radius: width / 2
        color: row.tone
      }

      Column {
        anchors.left: dot.right
        anchors.leftMargin: island.s(9)
        anchors.right: side.left
        anchors.rightMargin: island.s(6)
        anchors.verticalCenter: parent.verticalCenter
        spacing: island.s(1)

        Text {
          width: parent.width
          text: (row.modelData.place || row.modelData.project || "local") + "  ·  " + row.modelData.agent
          textFormat: Text.PlainText
          renderType: Text.NativeRendering
          elide: Text.ElideRight
          font.family: island.textFamily
          font.pixelSize: island.f(9)
          color: island.fgDim
        }

        Text {
          width: parent.width
          text: Model.agentTitle(row.modelData) || row.modelData.lastTool || row.modelData.pane
          textFormat: Text.PlainText
          renderType: Text.NativeRendering
          elide: Text.ElideRight
          font.family: island.textFamily
          font.pixelSize: island.f(11)
          font.weight: row.modelData.status === "blocked" ? Font.DemiBold : Font.Normal
          color: island.fg
        }
      }

      Column {
        id: side
        anchors.right: jump.visible ? jump.left : parent.right
        anchors.rightMargin: island.s(jump.visible ? 2 : 10)
        anchors.verticalCenter: parent.verticalCenter

        Text {
          anchors.right: parent.right
          text: Model.agentStateText(row.modelData.status)
          textFormat: Text.PlainText
          renderType: Text.NativeRendering
          font.family: island.textFamily
          font.pixelSize: island.f(9)
          color: row.tone
        }

        Text {
          anchors.right: parent.right
          text: Model.diffText(row.modelData.added, row.modelData.removed)
          textFormat: Text.StyledText
          renderType: Text.NativeRendering
          font.family: island.fontFamily
          font.pixelSize: island.f(9)
          color: island.fgDim
        }
      }

      MouseArea {
        id: rowMouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: { view.selectedKey = row.modelData.key; view.assistant.markSeen(row.modelData.hookSession) }
      }

      IconButton {
        id: jump
        visible: !!row.modelData.pane
        anchors.right: parent.right
        anchors.rightMargin: island.s(4)
        anchors.verticalCenter: parent.verticalCenter
        glyph: "󰈈"
        glyphSize: island.f(11)
        color: island.fg
        fontFamily: island.fontFamily
        onClicked: island.openAgentByKey(row.modelData.key)
      }
    }
  }

  // ---- the selected session's diffs
  Item {
    id: right
    visible: view.rows.length > 0
    x: list.width + island.s(10)
    y: list.y
    width: parent.width - x
    height: parent.height - y

    ListView {
      id: files
      width: parent.width
      height: island.s(24)
      orientation: ListView.Horizontal
      spacing: island.s(4)
      clip: true
      boundsBehavior: Flickable.StopAtBounds
      model: view.diffs
      onCountChanged: positionViewAtEnd()

      delegate: PillButton {
        required property var modelData
        required property int index
        island: view.island
        label: String(modelData.path).split("/").pop() + "  " + Model.diffText(modelData.added, modelData.removed)
        selected: index === view.diffIndex
        tone: island.accentColor
        onClicked: view.diffIndex = index
      }
    }

    Text {
      anchors.centerIn: parent
      visible: view.diffs.length === 0
      width: parent.width - island.s(20)
      horizontalAlignment: Text.AlignHCenter
      wrapMode: Text.WordWrap
      text: !view.selected ? "" : (view.session ? "No file changes yet." : "herdr sees this agent, but it isn't reporting through island-hook, so its edits aren't tracked.")
      textFormat: Text.PlainText
      font.family: island.textFamily
      font.pixelSize: island.f(10)
      color: island.fgDim
    }

    Rectangle {
      visible: view.diffs.length > 0
      y: files.height + island.s(6)
      width: parent.width
      height: parent.height - y
      radius: island.s(12)
      color: Util.alpha(island.fg, 0.04)
      clip: true

      DiffViewer {
        anchors.fill: parent
        anchors.margins: island.s(6)
        island: view.island
        diff: view.diffs.length > 0 ? view.diffs[Math.min(view.diffIndex, view.diffs.length - 1)] : null
      }
    }
  }
}
