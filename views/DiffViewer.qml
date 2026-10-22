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

    delegate: Rectangle {
      id: line
      required property var modelData
      width: ListView.view.width
      height: island.s(16)
      color: modelData.kind === "added" ? Util.alpha(island.greenColor, 0.14)
        : modelData.kind === "removed" ? Util.alpha(island.urgentColor, 0.14)
        : modelData.kind === "hunk" ? Util.alpha(island.accentColor, 0.08) : "transparent"

      Text {
        id: num
        width: island.s(34)
        anchors.verticalCenter: parent.verticalCenter
        horizontalAlignment: Text.AlignRight
        text: line.modelData.kind === "hunk" ? "" : String(line.modelData.newLine > 0 ? line.modelData.newLine : line.modelData.oldLine)
        textFormat: Text.PlainText
        renderType: Text.NativeRendering
        font.family: island.fontFamily
        font.pixelSize: island.f(9)
        color: Util.alpha(island.fg, 0.35)
      }

      Text {
        id: sign
        anchors.left: num.right
        anchors.leftMargin: island.s(6)
        anchors.verticalCenter: parent.verticalCenter
        width: island.s(8)
        text: line.modelData.kind === "added" ? "+" : (line.modelData.kind === "removed" ? "−" : "")
        textFormat: Text.PlainText
        renderType: Text.NativeRendering
        font.family: island.fontFamily
        font.pixelSize: island.f(10)
        color: line.modelData.kind === "added" ? island.greenColor : island.urgentColor
      }

      Text {
        anchors.left: sign.right
        anchors.leftMargin: island.s(4)
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        text: line.modelData.kind === "hunk" ? line.modelData.text : Model.highlightLine(line.modelData.text, viewer.colors)
        textFormat: line.modelData.kind === "hunk" ? Text.PlainText : Text.StyledText
        renderType: Text.NativeRendering
        elide: Text.ElideRight
        font.family: island.fontFamily
        font.pixelSize: island.f(10)
        color: line.modelData.kind === "hunk" ? island.accentColor : Util.alpha(island.fg, line.modelData.kind === "context" ? 0.7 : 0.95)
      }
    }
  }
}
