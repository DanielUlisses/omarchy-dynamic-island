import QtQuick
import qs.Commons
import "../IslandModel.js" as Model

// The plan gauge on the resting pill: the active account's 5-hour usage
// (or the busiest account's) as a coloured number with a thin ring, and a dot
// per other account in that account's own state.
Item {
  id: pill

  property var island: null
  readonly property var assistant: island.assistant
  readonly property var headline: assistant.headline
  readonly property real pct: headline ? headline.pct : -1
  readonly property color tone: pill.toneFor(Model.planTier(pct))
  readonly property var others: assistant.accounts.filter(function(a) {
    return (!headline || a.id !== headline.account.id) && (a.fiveHour || a.sevenDay || a.health === "error")
  }).slice(0, 3)

  function toneFor(t) {
    if (t === "green") return island.greenColor
    if (t === "orange") return island.orangeColor
    if (t === "red") return island.urgentColor
    return island.fgDim
  }

  visible: headline !== null
  implicitWidth: visible ? row.implicitWidth + island.s(10) : 0
  implicitHeight: island.s(18)

  Rectangle {
    anchors.fill: parent
    radius: height / 2
    color: Util.alpha(pill.tone, 0.16)
  }

  Row {
    id: row
    anchors.centerIn: parent
    spacing: island.s(4)

    ProgressRing {
      anchors.verticalCenter: parent.verticalCenter
      width: island.s(11)
      height: width
      progress: Math.max(0, pill.pct) / 100
      color: pill.tone
      lineWidth: Math.max(1.5, island.s(2))
    }

    Text {
      anchors.verticalCenter: parent.verticalCenter
      text: pill.pct >= 0 ? Math.round(pill.pct) + "%" : ""
      textFormat: Text.PlainText
      renderType: Text.NativeRendering
      font.family: island.fontFamily
      font.pixelSize: island.f(10)
      font.bold: true
      color: pill.tone
    }

    Repeater {
      model: pill.others
      delegate: Rectangle {
        required property var modelData
        anchors.verticalCenter: parent.verticalCenter
        width: island.s(5)
        height: width
        radius: width / 2
        color: modelData.health === "error" ? island.fgDim
          : pill.toneFor(Model.planTier(Math.max(Model.windowPct(modelData.fiveHour, pill.assistant.now),
                                                  Model.windowPct(modelData.sevenDay, pill.assistant.now))))
      }
    }
  }
}
