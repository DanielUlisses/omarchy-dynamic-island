import QtQuick
import qs.Commons

// tk-hub's next move (the first item of the Day screen's open block), opened
// from the resting ticker: the block it is in (client, its clock, the block
// after it), what the move is and why, then its action, Later (set it aside)
// and Open (its page in the hub). The action and Later call the routes the hub
// gave for this move, with the desktop token, through the daemon.
Item {
  id: view

  property var island: null
  readonly property var move: island.openMove
  property bool busy: false

  function run(which) {
    if (!move || busy) return
    busy = true
    island.assistant.hubMove(move.id, which, function(ok, err) {
      view.busy = false
      island.showHud({ key: "move", layout: "label", label: ok ? (which === "later" ? "Set aside" : "Done") : (err || "The hub said no"),
                       icon: ok ? "󰄬" : "󰀦", valueText: "", color: ok ? island.greenColor : island.orangeColor, duration: 2200 })
      if (ok) island.collapse()
    })
  }

  Column {
    x: island.s(26)
    y: island.s(18)
    width: parent.width - island.s(52)
    spacing: island.s(3)

    Text {
      width: parent.width
      text: view.move ? Model.blockLine(island.hubBlock, view.move, new Date().getTime()) : ""
      textFormat: Text.PlainText
      renderType: Text.NativeRendering
      elide: Text.ElideRight
      font.family: island.textFamily
      font.pixelSize: island.f(11)
      color: island.accentColor
    }
    Text {
      width: parent.width
      text: view.move ? view.move.title : ""
      textFormat: Text.PlainText
      renderType: Text.NativeRendering
      elide: Text.ElideRight
      font.family: island.textFamily
      font.pixelSize: island.f(18)
      font.weight: Font.DemiBold
      color: island.fg
    }
    Text {
      width: parent.width
      visible: text !== ""
      text: view.move ? view.move.detail : ""
      textFormat: Text.PlainText
      renderType: Text.NativeRendering
      elide: Text.ElideRight
      font.family: island.textFamily
      font.pixelSize: island.f(12)
      color: island.fgDim
    }
  }

  Row {
    anchors.right: parent.right
    anchors.rightMargin: island.s(22)
    anchors.bottom: parent.bottom
    anchors.bottomMargin: island.s(16)
    spacing: island.s(8)

    PillButton {
      visible: !!view.move && !!view.move.action
      island: view.island
      filled: true
      label: view.busy ? "…" : (view.move && view.move.action ? view.move.action.label : "")
      onClicked: view.run("action")
    }
    PillButton {
      visible: !!view.move && !!view.move.later
      island: view.island
      label: view.move && view.move.later ? view.move.later.label : ""
      onClicked: view.run("later")
    }
    PillButton {
      island: view.island
      label: "󰖟 Open"
      onClicked: { if (view.move) island.agents.openHub(view.move.url); island.collapse() }
    }
  }
}
