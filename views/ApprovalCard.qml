import QtQuick
import qs.Commons
import "../IslandModel.js" as Model

// A coding agent asking for permission, or asking you a question. It opens
// the island on its own and stays until you answer here or in the agent's
// terminal (then it goes away by itself).
//
// Permission: what it wants to run, and Allow, Always (for the rest of that
// session), Deny, and a button to land on its herdr pane. A question: its
// options; pick one (or several, then Send).
Item {
  id: card

  property var island: null
  property var approval: null
  // Inside the workspace the card is a banner without the avatar.
  property bool compact: false
  readonly property var assistant: island.assistant
  // Several questions in one ask are answered one after the other.
  property int step: 0
  property var collected: ({})
  readonly property var question: approval && approval.questions && approval.questions.length > step ? approval.questions[step] : null
  readonly property int waiting: assistant.approvals.length
  readonly property int pad: island.s(16)
  readonly property color tone: island.orangeColor
  property var picked: []

  // State arrives as fresh objects every push; only a new request resets.
  readonly property string approvalId: approval ? approval.id : ""
  onApprovalIdChanged: { picked = []; step = 0; collected = ({}) }

  function answer(labels) {
    var next = {}
    for (var k in collected) next[k] = collected[k]
    next[question.question] = question.multiSelect ? labels : labels[0]
    picked = []
    if (step + 1 < approval.questions.length) { collected = next; step++; return }
    assistant.decide(approval.id, { answers: next })
  }

  Item {
    id: header
    x: card.pad
    y: card.pad
    width: parent.width - card.pad * 2
    height: island.s(22)

    OmarchyAvatar {
      id: face
      visible: !card.compact
      anchors.left: parent.left
      anchors.verticalCenter: parent.verticalCenter
      width: island.s(22)
      height: width
      mood: "approval"
      base: island.fg
      accent: island.accentColor
      alert: card.tone
      lookX: island.lookX
      lookY: island.lookY
    }

    Text {
      id: title
      anchors.left: face.visible ? face.right : parent.left
      anchors.leftMargin: face.visible ? island.s(10) : 0
      anchors.right: count.left
      anchors.rightMargin: island.s(8)
      anchors.verticalCenter: parent.verticalCenter
      text: !card.approval ? "" : (card.question ? (card.question.header || "Question") : ("Allow " + card.approval.tool + "?"))
        + (card.approval && (card.approval.project || card.approval.agent) ? "  ·  " + [card.approval.agent, card.approval.project].filter(function(x) { return x }).join(" · ") : "")
      textFormat: Text.PlainText
      renderType: Text.NativeRendering
      elide: Text.ElideRight
      font.family: island.textFamily
      font.pixelSize: island.f(13)
      font.weight: Font.DemiBold
      color: island.fg
    }

    Text {
      id: count
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      visible: card.waiting > 1 || (!!card.approval && card.approval.questions.length > 1)
      text: card.approval && card.approval.questions.length > 1 ? (card.step + 1) + " / " + card.approval.questions.length
        : "1 of " + card.waiting
      textFormat: Text.PlainText
      renderType: Text.NativeRendering
      font.family: island.textFamily
      font.pixelSize: island.f(11)
      color: island.fgDim
    }
  }

  // ---- permission: what it wants to do
  Rectangle {
    id: what
    visible: !card.question
    x: card.pad
    y: header.y + header.height + island.s(8)
    width: parent.width - card.pad * 2
    height: island.s(card.compact ? 34 : 56)
    radius: island.s(12)
    color: Util.alpha(island.fg, 0.06)
    clip: true

    Text {
      anchors.fill: parent
      anchors.margins: island.s(10)
      text: card.approval ? (card.approval.tool === "Bash" ? "$ " + (card.approval.detail || "") : (card.approval.summary || card.approval.detail || "")) : ""
      textFormat: Text.PlainText
      renderType: Text.NativeRendering
      wrapMode: Text.WrapAnywhere
      maximumLineCount: card.compact ? 1 : 2
      elide: Text.ElideRight
      font.family: island.fontFamily
      font.pixelSize: island.f(11)
      color: island.fg
    }
  }

  Row {
    visible: !card.question
    anchors.right: parent.right
    anchors.rightMargin: card.pad
    y: what.y + what.height + island.s(10)
    spacing: island.s(6)

    PillButton { island: card.island; label: "󰈈 Pane"; visible: !!card.approval && !!card.approval.herdrPane; onClicked: island.jumpToAgent() }
    PillButton { island: card.island; label: "Deny"; tone: island.urgentColor; onClicked: card.assistant.decide(card.approval.id, "deny") }
    PillButton { island: card.island; label: "Always"; visible: !!card.approval && card.approval.canAlwaysAllow === true; onClicked: card.assistant.decide(card.approval.id, "always_allow") }
    PillButton { island: card.island; label: "Allow"; tone: island.greenColor; filled: true; onClicked: card.assistant.decide(card.approval.id, "allow") }
  }

  // ---- question: its options
  Text {
    id: questionText
    visible: !!card.question
    x: card.pad
    y: header.y + header.height + island.s(6)
    width: parent.width - card.pad * 2
    height: island.s(30)
    text: card.question ? card.question.question : ""
    textFormat: Text.PlainText
    renderType: Text.NativeRendering
    wrapMode: Text.WordWrap
    maximumLineCount: 2
    elide: Text.ElideRight
    font.family: island.textFamily
    font.pixelSize: island.f(12)
    color: island.fg
  }

  ListView {
    id: options
    visible: !!card.question
    x: card.pad
    y: questionText.y + questionText.height + island.s(6)
    width: parent.width - card.pad * 2
    height: parent.height - y - card.pad - (card.question && card.question.multiSelect ? island.s(38) : 0)
    clip: true
    spacing: island.s(4)
    boundsBehavior: Flickable.StopAtBounds
    model: card.question ? card.question.options : []

    delegate: Rectangle {
      id: opt
      required property var modelData
      readonly property bool chosen: card.picked.indexOf(modelData.label) !== -1
      width: ListView.view.width
      height: island.s(30)
      radius: island.s(10)
      color: Util.alpha(opt.chosen ? card.tone : island.fg, optMouse.containsMouse ? 0.16 : (opt.chosen ? 0.2 : 0.06))

      Text {
        anchors.left: parent.left
        anchors.leftMargin: island.s(12)
        anchors.right: parent.right
        anchors.rightMargin: island.s(12)
        anchors.verticalCenter: parent.verticalCenter
        text: opt.modelData.label + (opt.modelData.description ? "  ·  " + opt.modelData.description : "")
        textFormat: Text.PlainText
        renderType: Text.NativeRendering
        elide: Text.ElideRight
        font.family: island.textFamily
        font.pixelSize: island.f(11)
        color: island.fg
      }

      MouseArea {
        id: optMouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: {
          if (!card.question.multiSelect) { card.answer([opt.modelData.label]); return }
          var next = card.picked.slice()
          var i = next.indexOf(opt.modelData.label)
          if (i === -1) next.push(opt.modelData.label); else next.splice(i, 1)
          card.picked = next
        }
      }
    }
  }

  Row {
    visible: !!card.question && card.question.multiSelect
    anchors.right: parent.right
    anchors.rightMargin: card.pad
    anchors.bottom: parent.bottom
    anchors.bottomMargin: card.pad
    spacing: island.s(6)
    PillButton { island: card.island; label: "Send"; tone: island.greenColor; filled: true; enabled: card.picked.length > 0; onClicked: card.answer(card.picked) }
  }
}
