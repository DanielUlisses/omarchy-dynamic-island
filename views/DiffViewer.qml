import QtQuick
import qs.Commons
import "../IslandModel.js" as Model

// One file's changes as a unified diff: hunk headers, then each line with its
// old/new line number, washed green or red, the code lightly coloured.
Item {
  id: viewer

  property var island: null
  property var diff: null

  readonly property var rows: {
    var out = []
    if (!diff) return out
    for (var h = 0; h < diff.hunks.length; h++) {
      var hunk = diff.hunks[h]
      out.push({ kind: "hunk", text: "@@ -" + hunk.oldStart + " +" + hunk.newStart + " @@", oldLine: -1, newLine: -1 })
      for (var i = 0; i < hunk.lines.length; i++) out.push(hunk.lines[i])
      if (out.length > 1500) { out.push({ kind: "hunk", text: "… more lines not shown", oldLine: -1, newLine: -1 }); break }
    }
    return out
  }
  readonly property var colors: ({
    keyword: island.accentColor.toString(), string: island.greenColor.toString(),
    number: island.orangeColor.toString(), comment: Util.alpha(island.fg, 0.45).toString()
  })

  Text {
    anchors.centerIn: parent
    visible: !viewer.diff || viewer.diff.tooLarge || viewer.rows.length === 0
    text: !viewer.diff ? "Pick a file" : (viewer.diff.tooLarge ? "Too large to show: " + Model.diffText(viewer.diff.added, viewer.diff.removed) : "No changes")
    textFormat: Text.PlainText
    renderType: Text.NativeRendering
    font.family: island.textFamily
    font.pixelSize: island.f(11)
    color: island.fgDim
  }

  ListView {
    id: list
    anchors.fill: parent
    clip: true
    boundsBehavior: Flickable.StopAtBounds
    model: viewer.rows
    reuseItems: true
    flickableDirection: Flickable.VerticalFlick

    // A newly shown file fades its rows in from the top.
    populate: Transition {
      NumberAnimation { property: "opacity"; from: 0; to: 1; duration: 260; easing.type: Easing.OutCubic }
    }

    delegate: Rectangle {
      id: line
      required property var modelData
      readonly property string kind: modelData.kind
      width: ListView.view.width
      height: island.s(kind === "hunk" ? 22 : 19)
      color: kind === "added" ? Util.alpha(island.greenColor, 0.13)
        : kind === "removed" ? Util.alpha(island.urgentColor, 0.13) : "transparent"

      // Change bar on the left edge.
      Rectangle {
        visible: line.kind === "added" || line.kind === "removed"
        width: Math.max(2, island.s(2))
        height: parent.height
        color: line.kind === "added" ? island.greenColor : island.urgentColor
      }

      Text {
        id: num
        width: island.s(36)
        anchors.verticalCenter: parent.verticalCenter
        horizontalAlignment: Text.AlignRight
        text: line.kind === "hunk" ? "" : String(line.modelData.newLine > 0 ? line.modelData.newLine : line.modelData.oldLine)
        textFormat: Text.PlainText
        renderType: Text.NativeRendering
        font.family: island.fontFamily
        font.pixelSize: island.f(10)
        color: line.kind === "added" ? island.greenColor : (line.kind === "removed" ? island.urgentColor : Util.alpha(island.fg, 0.3))
      }

      Text {
        id: sign
        anchors.left: num.right
        anchors.leftMargin: island.s(10)
        anchors.verticalCenter: parent.verticalCenter
        width: island.s(10)
        text: line.kind === "added" ? "+" : (line.kind === "removed" ? "-" : "")
        textFormat: Text.PlainText
        renderType: Text.NativeRendering
        font.family: island.fontFamily
        font.pixelSize: island.f(11)
        color: line.kind === "added" ? island.greenColor : island.urgentColor
      }

      Text {
        anchors.left: sign.right
        anchors.leftMargin: island.s(6)
        anchors.right: parent.right
        anchors.rightMargin: island.s(8)
        anchors.verticalCenter: parent.verticalCenter
        text: line.kind === "hunk" ? "⋯  " + line.modelData.text.replace(/^@@ | @@$/g, "")
          : (line.kind === "removed" ? line.modelData.text : Model.highlightLine(line.modelData.text, viewer.colors))
        textFormat: line.kind === "hunk" || line.kind === "removed" ? Text.PlainText : Text.StyledText
        renderType: Text.NativeRendering
        elide: Text.ElideRight
        font.family: island.fontFamily
        font.pixelSize: island.f(line.kind === "hunk" ? 10 : 12)
        font.strikeout: line.kind === "removed"
        color: line.kind === "hunk" ? Util.alpha(island.fg, 0.35)
          : (line.kind === "removed" ? Util.alpha(island.urgentColor, 0.75) : Util.alpha(island.fg, line.kind === "context" ? 0.78 : 0.95))
      }
    }
  }
}
