import QtQuick
import qs.Commons

// Island Chat: talk to an agent from the island. The header picks the
// account (any Claude login, API key or local Ollama), the model, and the
// workspace: "Island" (the island's own tools over herdr and your sessions)
// or "Secretary" (your secretary repo, with its rules and skills).
//
// Drop files on the island, or press 󰹑 to capture a screen region, to attach
// them. Tool calls show as badges under the answer; anything that changes
// something asks first on the approval card.
Item {
  id: view

  property var island: null
  readonly property var assistant: island.assistant
  readonly property var chat: assistant.chat
  readonly property var chatAccounts: assistant.accounts.filter(function(a) { return a.kind !== "codex" })
  readonly property var account: {
    var list = chatAccounts
    for (var i = 0; i < list.length; i++) if (list[i].id === chat.profileId) return list[i]
    for (var j = 0; j < list.length; j++) if (list[j].active) return list[j]
    return list.length > 0 ? list[0] : null
  }
  readonly property string model: chat.model || (account ? account.defaultModel : "")

  function cycleAccount() {
    var list = chatAccounts
    if (list.length === 0) return
    var i = -1
    for (var k = 0; k < list.length; k++) if (account && list[k].id === account.id) i = k
    var next = list[(i + 1) % list.length]
    assistant.chatConfigure({ profileId: next.id, model: next.defaultModel || (next.models.length ? next.models[0] : "") })
  }

  function cycleModel() {
    if (!account || account.models.length === 0) return
    var i = account.models.indexOf(model)
    assistant.chatConfigure({ model: account.models[(i + 1) % account.models.length] })
  }

  function send() {
    var text = input.text.trim()
    if ((!text && island.chatAttachments.length === 0) || chat.busy) return
    if (account && !chat.profileId) assistant.chatConfigure({ profileId: account.id, model: model })
    assistant.chatSend(text, island.chatAttachments)
    input.text = ""
    island.chatAttachments = []
  }

  Row {
    id: header
    x: 0
    y: 0
    spacing: island.s(5)
    height: island.s(26)

    PillButton { island: view.island; label: view.account ? "󰀄 " + view.account.label : "No account"; onClicked: view.cycleAccount() }
    PillButton { island: view.island; label: view.model || "model"; visible: !!view.model; onClicked: view.cycleModel() }
    PillButton {
      island: view.island
      label: view.chat.workspace === "secretary" ? "󰃖 Secretary" : "󰚩 Island"
      visible: view.assistant.secretary.present || view.chat.workspace === "secretary"
      selected: view.chat.workspace === "secretary"
      onClicked: view.assistant.chatConfigure({ workspace: view.chat.workspace === "secretary" ? "island" : "secretary" })
    }
  }

  PillButton {
    anchors.right: parent.right
    y: 0
    island: view.island
    label: "New"
    visible: view.chat.messages.length > 0
    onClicked: view.assistant.chatReset()
  }

  ListView {
    id: list
    x: 0
    y: header.height + island.s(8)
    width: parent.width
    height: inputBar.y - y - island.s(8) - (attachRow.visible ? attachRow.height + island.s(4) : 0)
    clip: true
    spacing: island.s(6)
    boundsBehavior: Flickable.StopAtBounds
    model: view.chat.messages
    onCountChanged: Qt.callLater(function() { list.positionViewAtEnd() })
    onContentHeightChanged: if (view.chat.busy) positionViewAtEnd()

    Text {
      anchors.centerIn: parent
      visible: list.count === 0
      width: parent.width - island.s(60)
      horizontalAlignment: Text.AlignHCenter
      wrapMode: Text.WordWrap
      text: !view.assistant.connected ? "The island daemon isn't running."
        : view.chat.workspace === "secretary" ? "Ask your secretary: plan the day, what's booked, draft the hours…"
        : "Ask about your agents: why is one blocked, what did it change, start a task in a new pane…"
      textFormat: Text.PlainText
      font.family: island.textFamily
      font.pixelSize: island.f(11)
      color: island.fgDim
    }

    delegate: Item {
      id: msg
      required property var modelData
      readonly property bool mine: modelData.role === "user"
      width: ListView.view.width
      height: bubble.height

      Rectangle {
        id: bubble
        anchors.right: msg.mine ? parent.right : undefined
        anchors.left: msg.mine ? undefined : parent.left
        width: Math.min(parent.width * (msg.mine ? 0.8 : 1), body.implicitWidth + island.s(20))
        height: body.implicitHeight + badges.height + island.s(14)
        radius: island.s(12)
        color: msg.modelData.role === "error" ? Util.alpha(island.urgentColor, 0.16)
          : Util.alpha(msg.mine ? island.accentColor : island.fg, msg.mine ? 0.16 : 0.05)

        Text {
          id: body
          x: island.s(10)
          y: island.s(7)
          width: Math.min(implicitWidth, msg.width * (msg.mine ? 0.8 : 1) - island.s(20))
          text: (msg.modelData.attachments.length ? "📎 " + msg.modelData.attachments.join(", ") + "\n" : "")
            + (msg.modelData.text || (view.chat.busy ? "…" : ""))
          textFormat: msg.mine ? Text.PlainText : Text.MarkdownText
          wrapMode: Text.Wrap
          font.family: island.textFamily
          font.pixelSize: island.f(11)
          color: island.fg
          onLinkActivated: function(link) { island.openLink(link) }
        }

        Flow {
          id: badges
          x: island.s(10)
          y: body.y + body.implicitHeight + (msg.modelData.tools.length ? island.s(4) : 0)
          width: bubble.width - island.s(20)
          spacing: island.s(4)
          height: msg.modelData.tools.length ? implicitHeight : 0

          Repeater {
            model: msg.modelData.tools
            delegate: Rectangle {
              required property var modelData
              readonly property color tone: modelData.status === "done" ? island.greenColor
                : (modelData.status === "running" ? island.accentColor : island.urgentColor)
              width: badgeText.implicitWidth + island.s(12)
              height: island.s(18)
              radius: height / 2
              color: Util.alpha(tone, 0.16)

              Text {
                id: badgeText
                anchors.centerIn: parent
                text: (parent.modelData.status === "running" ? "󰑮 " : parent.modelData.status === "done" ? "󰄬 " : "󰅖 ")
                  + parent.modelData.name + (parent.modelData.summary ? " · " + parent.modelData.summary : "")
                textFormat: Text.PlainText
                renderType: Text.NativeRendering
                elide: Text.ElideRight
                width: Math.min(implicitWidth, island.s(300))
                font.family: island.fontFamily
                font.pixelSize: island.f(9)
                color: parent.tone
              }
            }
          }
        }
      }
    }
  }

  Row {
    id: attachRow
    visible: island.chatAttachments.length > 0
    anchors.bottom: inputBar.top
    anchors.bottomMargin: island.s(4)
    spacing: island.s(4)
    height: island.s(20)

    Repeater {
      model: island.chatAttachments
      delegate: Rectangle {
        required property var modelData
        required property int index
        width: chip.implicitWidth + island.s(14)
        height: island.s(20)
        radius: height / 2
        color: Util.alpha(island.accentColor, 0.16)
        Text {
          id: chip
          anchors.centerIn: parent
          text: "📎 " + String(parent.modelData).split("/").pop() + "  ×"
          textFormat: Text.PlainText
          font.family: island.textFamily
          font.pixelSize: island.f(9)
          color: island.fg
        }
        MouseArea {
          anchors.fill: parent
          cursorShape: Qt.PointingHandCursor
          onClicked: { var l = island.chatAttachments.slice(); l.splice(parent.index, 1); island.chatAttachments = l }
        }
      }
    }
  }

  Rectangle {
    id: inputBar
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.bottom: parent.bottom
    height: island.s(34)
    radius: height / 2
    color: Util.alpha(island.fg, 0.07)
    border.width: input.activeFocus ? 1 : 0
    border.color: Util.alpha(island.accentColor, 0.5)

    IconButton {
      id: captureButton
      anchors.left: parent.left
      anchors.leftMargin: island.s(4)
      anchors.verticalCenter: parent.verticalCenter
      glyph: "󰹑"
      glyphSize: island.f(13)
      color: island.fg
      fontFamily: island.fontFamily
      onClicked: island.captureRegion()
    }

    TextInput {
      id: input
      anchors.left: captureButton.right
      anchors.leftMargin: island.s(4)
      anchors.right: sendButton.left
      anchors.rightMargin: island.s(4)
      anchors.verticalCenter: parent.verticalCenter
      clip: true
      font.family: island.textFamily
      font.pixelSize: island.f(12)
      color: island.fg
      selectionColor: Util.alpha(island.accentColor, 0.4)
      enabled: view.assistant.connected
      focus: true
      onAccepted: view.send()
      Keys.onEscapePressed: island.collapse()

      Text {
        anchors.fill: parent
        verticalAlignment: Text.AlignVCenter
        visible: !input.text && !input.activeFocus
        text: "Message " + (view.chat.workspace === "secretary" ? "your secretary" : "the island") + "…"
        textFormat: Text.PlainText
        font: input.font
        color: island.fgDim
      }
    }

    IconButton {
      id: sendButton
      anchors.right: parent.right
      anchors.rightMargin: island.s(4)
      anchors.verticalCenter: parent.verticalCenter
      glyph: view.chat.busy ? "󰓛" : "󰒊"
      glyphSize: island.f(13)
      color: view.chat.busy ? island.urgentColor : island.accentColor
      fontFamily: island.fontFamily
      onClicked: view.chat.busy ? view.assistant.chatStop() : view.send()
    }
  }

  // Typing goes straight in when the tab opens.
  Component.onCompleted: input.forceActiveFocus()
}
