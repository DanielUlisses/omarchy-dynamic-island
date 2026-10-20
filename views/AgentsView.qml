import QtQuick
import qs.Commons
import "../IslandModel.js" as Model

// The opened agents list: every live herdr agent on every machine, most
// urgent first. A row that wants you (a question, or finished work) is
// washed in its colour; busy ones stay quiet. Click a row to land on it.
Item {
  id: view

  property var island: null
  readonly property var agents: island.agents
  readonly property int pad: island.s(16)

  Item {
    id: header
    x: view.pad
    y: view.pad
    width: parent.width - view.pad * 2
    height: island.s(22)

    Text {
      id: heading
      anchors.left: parent.left
      anchors.leftMargin: island.s(4)
      anchors.verticalCenter: parent.verticalCenter
      text: "󰚩  Agents"
      textFormat: Text.PlainText
      renderType: Text.NativeRendering
      font.family: island.textFamily
      font.pixelSize: island.f(13)
      font.weight: Font.DemiBold
      color: island.fg
    }

    Text {
      anchors.right: parent.right
      anchors.rightMargin: island.s(4)
      anchors.left: heading.right
      anchors.leftMargin: island.s(12)
      anchors.verticalCenter: parent.verticalCenter
      horizontalAlignment: Text.AlignRight
      text: Model.agentsSummary(view.agents.live)
      textFormat: Text.PlainText
      renderType: Text.NativeRendering
      elide: Text.ElideRight
      font.family: island.textFamily
      font.pixelSize: island.f(11)
      color: island.fgDim
    }
  }

  ListView {
    x: view.pad
    y: header.y + header.height + island.s(8)
    width: parent.width - view.pad * 2
    height: parent.height - y - view.pad
    clip: true
    spacing: island.s(Model.agentRowGap)
    boundsBehavior: Flickable.StopAtBounds
    model: view.agents.live

    delegate: Rectangle {
      id: row
      required property var modelData
      readonly property color tone: view.agents.toneOf(modelData.status)
      readonly property bool loud: modelData.status === "blocked" || modelData.status === "done"
      width: ListView.view.width
      height: island.s(Model.agentRowHeight)
      radius: island.s(16)
      color: row.loud ? Util.alpha(row.tone, rowMouse.containsMouse ? 0.26 : 0.16)
        : Util.alpha(island.fg, rowMouse.containsMouse ? 0.1 : 0.04)

      Behavior on color { ColorAnimation { duration: 120 } }

      Rectangle {
        id: dot
        anchors.left: parent.left
        anchors.leftMargin: island.s(14)
        anchors.verticalCenter: parent.verticalCenter
        width: island.s(7)
        height: width
        radius: width / 2
        color: row.tone
      }

      Column {
        anchors.left: dot.right
        anchors.leftMargin: island.s(12)
        anchors.right: stateText.left
        anchors.rightMargin: island.s(10)
        anchors.verticalCenter: parent.verticalCenter
        spacing: island.s(1)

        Text {
          width: parent.width
          text: Model.agentPlace(row.modelData) + (row.modelData.agent ? "  ·  " + row.modelData.agent : "")
          textFormat: Text.PlainText
          renderType: Text.NativeRendering
          elide: Text.ElideRight
          font.family: island.textFamily
          font.pixelSize: island.f(10)
          color: island.fgDim
        }

        Text {
          width: parent.width
          text: row.modelData.title || row.modelData.agent || row.modelData.pane
          textFormat: Text.PlainText
          renderType: Text.NativeRendering
          elide: Text.ElideRight
          font.family: island.textFamily
          font.pixelSize: island.f(12)
          font.weight: row.loud ? Font.DemiBold : Font.Normal
          color: island.fg
        }
      }

      Text {
        id: stateText
        anchors.right: parent.right
        anchors.rightMargin: island.s(14)
        anchors.verticalCenter: parent.verticalCenter
        text: Model.agentStateText(row.modelData.status)
        textFormat: Text.PlainText
        renderType: Text.NativeRendering
        font.family: island.textFamily
        font.pixelSize: island.f(11)
        font.weight: row.loud ? Font.DemiBold : Font.Normal
        color: row.loud ? row.tone : island.fgDim
      }

      MouseArea {
        id: rowMouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: island.openAgent(row.modelData)
      }
    }
  }
}
