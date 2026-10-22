import QtQuick
import Quickshell
import qs.Commons

// Chat: talk to an agent from the island. Chips on top pick the account (any
// Claude login, API key or local Ollama), the model, and the workspace:
// "Island" (the island's own tools over herdr and your sessions) or
// "Secretary" (your secretary repo, with its rules and skills).
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
  readonly property bool secretary: chat.workspace === "secretary"
  readonly property var last: chat.messages.length > 0 ? chat.messages[chat.messages.length - 1] : null
  readonly property bool thinking: chat.busy && (!last || last.role === "user" || !last.text)
  // Messages already on screen: the list is rebuilt on every update, and only
  // new ones should rise in.
  property var shownIds: ({})
  onChatChanged: if (chat.messages.length === 0) shownIds = ({})

  function cycleAccount() {
    var list = chatAccounts
    if (list.length === 0) return
    var i = -1
    for (var k = 0; k < list.length; k++) if (account && list[k].id === account.id) i = k
    var next = list[(i + 1) % list.length]
    // No model: the daemon starts it on the chatModel setting, or the account's default.
    assistant.chatConfigure({ profileId: next.id, model: "" })
  }

  function cycleWorkspace() {
    if (!assistant.secretary.present && !secretary) return
    assistant.chatConfigure({ workspace: secretary ? "island" : "secretary" })
  }

  // Ctrl+A agent (Island / Secretary), Ctrl+M model, Ctrl+S account, Ctrl+N new chat.
  function chatKey(e) {
    if (!(e.modifiers & Qt.ControlModifier) || (e.modifiers & (Qt.AltModifier | Qt.MetaModifier))) return
    if (e.key === Qt.Key_A) cycleWorkspace()
    else if (e.key === Qt.Key_M) cycleModel()
    else if (e.key === Qt.Key_S) cycleAccount()
    else if (e.key === Qt.Key_N) assistant.chatReset()
    else return
    e.accepted = true
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

  // "claude-opus-5-5" → "Opus 5.5"
  function modelLabel(m) {
    var g = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/.exec(m || "")
    if (!g) return m
    return g[1].charAt(0).toUpperCase() + g[1].slice(1) + " " + g[2] + (g[3] && g[3].length < 3 ? "." + g[3] : "")
  }

  // Typing goes straight in whenever the chat is shown: the tab opens, or the island does.
  function focusInput() { Qt.callLater(function() { if (view.visible) input.forceActiveFocus() }) }

  onVisibleChanged: if (visible && island.workspaceTab === "chat") focusInput()

  Connections {
    target: view.island
    function onWorkspaceTabChanged() { if (view.island.workspaceTab === "chat") view.focusInput() }
    function onWorkspaceOpenChanged() { if (view.island.workspaceOpen && view.island.workspaceTab === "chat") view.focusInput() }
    function onViewChanged() { if (view.island.view === "workspace-expanded" && view.island.workspaceTab === "chat") view.focusInput() }
  }

  // ---- left: the avatar, listening or typing
  OmarchyAvatar {
    id: face
    x: island.s(2)
    anchors.bottom: parent.bottom
    anchors.bottomMargin: island.s(2)
    width: island.s(78)
    height: width
    mood: view.chat.busy ? "working" : (view.chat.error ? "approval" : "idle")
    base: island.fg
    ink: island.surface
    accent: island.accentColor
    glow: view.secretary ? island.accentColor : "#d97757"
    alert: island.orangeColor
    good: island.greenColor
    lookX: island.lookX
    lookY: island.lookY
    onPoked: input.forceActiveFocus()
  }

  Item {
    id: column
    x: face.width + island.s(16)
    width: parent.width - x
    height: parent.height

    // ---- chips: account · model · workspace, and New
    Row {
      id: header
      spacing: island.s(6)
      height: island.s(26)

      Item {
        width: accountChip.implicitWidth
        height: parent.height
        PillButton {
          id: accountChip
          island: view.island
          label: "     " + (view.account ? view.account.label : "No account")
          onClicked: view.cycleAccount()
        }
        Rectangle {
          x: island.s(11)
          anchors.verticalCenter: parent.verticalCenter
          width: island.s(7)
          height: width
          radius: width / 2
          color: view.account && view.account.health === "error" ? island.urgentColor : island.greenColor
        }
      }
      PillButton { island: view.island; label: view.modelLabel(view.model); visible: !!view.model; onClicked: view.cycleModel() }
      PillButton {
        island: view.island
        label: view.secretary ? "󰃖  Secretary" : "󰚩  Island"
        visible: view.assistant.secretary.present || view.secretary
        selected: view.secretary
        onClicked: view.assistant.chatConfigure({ workspace: view.secretary ? "island" : "secretary" })
      }
    }

    Text {
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.bottom: inputBar.top
      anchors.bottomMargin: island.s(8)
      visible: view.chat.messages.length === 0 && island.chatAttachments.length === 0
      text: "Ctrl+A agent  ·  Ctrl+M model  ·  Ctrl+S account  ·  Ctrl+N new"
      textFormat: Text.PlainText
      renderType: Text.NativeRendering
      font.family: island.textFamily
      font.pixelSize: island.f(10)
      color: island.fgDim
    }

    PillButton {
      anchors.right: parent.right
      island: view.island
      label: "󰐕  New  (Ctrl+N)"
      visible: view.chat.messages.length > 0
      onClicked: view.assistant.chatReset()
    }

    ListView {
      id: list
      y: header.height + island.s(10)
      width: parent.width
      height: inputBar.y - y - island.s(8) - (attachRow.visible ? attachRow.height + island.s(6) : 0)
      clip: true
      spacing: island.s(10)
      boundsBehavior: Flickable.StopAtBounds
      model: view.chat.messages
      onCountChanged: Qt.callLater(function() { list.positionViewAtEnd() })
      onContentHeightChanged: if (view.chat.busy) positionViewAtEnd()
      footer: Item {
        width: list.width
        height: view.thinking ? island.s(26) : 0
        // ● ● ● while the answer hasn't started.
        Row {
          visible: view.thinking
          x: island.s(4)
          anchors.verticalCenter: parent.verticalCenter
          spacing: island.s(5)
          Repeater {
            model: 3
            delegate: Rectangle {
              required property int index
              width: island.s(6)
              height: width
              radius: width / 2
              color: island.fgDim
              SequentialAnimation on opacity {
                running: view.thinking
                loops: Animation.Infinite
                PauseAnimation { duration: index * 160 }
                NumberAnimation { to: 1; duration: 260 }
                NumberAnimation { to: 0.25; duration: 260 }
                PauseAnimation { duration: (2 - index) * 160 + 120 }
              }
            }
          }
        }
      }

      Text {
        anchors.centerIn: parent
        visible: list.count === 0
        width: parent.width - island.s(40)
        horizontalAlignment: Text.AlignHCenter
        wrapMode: Text.WordWrap
        text: !view.assistant.connected ? "The island daemon isn't running."
          : view.secretary ? "Ask your secretary: plan the day, what's booked, draft the hours…"
          : "Ask about your agents: why is one blocked, what did it change, start a task in a new pane…"
        textFormat: Text.PlainText
        font.family: island.textFamily
        font.pixelSize: island.f(12)
        color: island.fgDim
      }

      delegate: Item {
        id: msg
        required property var modelData
        required property int index
        readonly property bool mine: modelData.role === "user"
        width: ListView.view.width
        height: bubble.height
        // Copy the message's text to the clipboard (the Markdown source, not the rendering).
        property bool copied: false
        readonly property bool copyable: !!modelData.text && !(view.chat.busy && index === view.chat.messages.length - 1)
        HoverHandler { id: msgHover }
        Timer { id: copiedReset; interval: 1400; onTriggered: msg.copied = false }

        // New messages rise in.
        opacity: 0
        transform: Translate { id: rise; y: island.s(10) }
        Component.onCompleted: {
          var id = String(modelData.id)
          if (view.shownIds[id]) { opacity = 1; rise.y = 0; return }
          view.shownIds[id] = true
          appear.start()
        }
        ParallelAnimation {
          id: appear
          NumberAnimation { target: msg; property: "opacity"; to: 1; duration: 240; easing.type: Easing.OutCubic }
          NumberAnimation { target: rise; property: "y"; to: 0; duration: 300; easing.type: Easing.OutCubic }
        }

        Rectangle {
          id: bubble
          anchors.right: msg.mine ? parent.right : undefined
          anchors.left: msg.mine ? undefined : parent.left
          width: msg.mine ? Math.min(parent.width * 0.8, body.implicitWidth + island.s(28)) : parent.width
          height: body.implicitHeight + badges.height + (msg.mine ? island.s(14) : island.s(4))
          radius: msg.mine ? Math.min(height / 2, island.s(16)) : 0
          color: msg.modelData.role === "error" ? Util.alpha(island.urgentColor, 0.16)
            : (msg.mine ? Util.alpha(island.fg, 0.1) : "transparent")

          Text {
            id: body
            x: msg.mine ? island.s(14) : island.s(2)
            y: msg.mine ? island.s(7) : island.s(2)
            width: msg.mine ? Math.min(implicitWidth, msg.width * 0.8 - island.s(28)) : msg.width - island.s(4)
            text: (msg.modelData.attachments.length ? "📎 " + msg.modelData.attachments.join(", ") + "\n" : "")
              + (msg.modelData.text || "")
            textFormat: msg.mine ? Text.PlainText : Text.MarkdownText
            wrapMode: Text.Wrap
            lineHeight: msg.mine ? 1 : 1.12
            font.family: island.textFamily
            font.pixelSize: island.f(13)
            font.weight: msg.mine ? Font.Medium : Font.Normal
            color: island.fg
            onLinkActivated: function(link) { island.openLink(link) }
          }

          Rectangle {
            id: copyButton
            visible: msg.copyable && (msgHover.hovered || msg.copied)
            z: 2
            anchors.right: parent.right
            anchors.rightMargin: island.s(msg.mine ? 4 : 2)
            anchors.top: parent.top
            anchors.topMargin: island.s(msg.mine ? 3 : 0)
            width: island.s(24)
            height: width
            radius: width / 2
            color: Util.alpha(island.surface, 0.9)
            border.width: 1
            border.color: Util.alpha(island.fg, 0.12)

            Text {
              anchors.centerIn: parent
              text: msg.copied ? "󰄬" : "󰆏"
              textFormat: Text.PlainText
              renderType: Text.NativeRendering
              font.family: island.fontFamily
              font.pixelSize: island.f(12)
              color: msg.copied ? island.greenColor : island.fg
            }

            MouseArea {
              anchors.fill: parent
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onClicked: {
                Quickshell.execDetached(["wl-copy", "--", msg.modelData.text])
                msg.copied = true
                copiedReset.restart()
              }
            }
          }

          Flow {
            id: badges
            x: body.x
            y: body.y + body.implicitHeight + (msg.modelData.tools.length ? island.s(6) : 0)
            width: bubble.width - island.s(8)
            spacing: island.s(5)
            height: msg.modelData.tools.length ? implicitHeight + island.s(2) : 0

            Repeater {
              model: msg.modelData.tools
              delegate: Rectangle {
                required property var modelData
                readonly property color tone: modelData.status === "done" ? island.greenColor
                  : (modelData.status === "running" ? island.accentColor : island.urgentColor)
                width: badgeText.width + island.s(14)
                height: island.s(20)
                radius: height / 2
                color: Util.alpha(tone, 0.14)

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
                  font.pixelSize: island.f(10)
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
      anchors.bottomMargin: island.s(6)
      spacing: island.s(5)
      height: island.s(22)

      Repeater {
        model: island.chatAttachments
        delegate: Rectangle {
          required property var modelData
          required property int index
          width: chip.implicitWidth + island.s(16)
          height: island.s(22)
          radius: height / 2
          color: Util.alpha(island.accentColor, 0.16)
          Text {
            id: chip
            anchors.centerIn: parent
            text: "📎 " + String(parent.modelData).split("/").pop() + "  ×"
            textFormat: Text.PlainText
            font.family: island.textFamily
            font.pixelSize: island.f(10)
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

    // ---- the prompt
    Rectangle {
      id: inputBar
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.bottom: parent.bottom
      height: island.s(42)
      radius: height / 2
      color: Util.alpha(island.fg, input.activeFocus ? 0.1 : 0.07)
      border.width: 1
      border.color: Util.alpha(input.activeFocus ? island.accentColor : island.fg, input.activeFocus ? 0.45 : 0.06)
      Behavior on color { ColorAnimation { duration: 180 } }
      Behavior on border.color { ColorAnimation { duration: 180 } }

      IconButton {
        id: captureButton
        anchors.left: parent.left
        anchors.leftMargin: island.s(6)
        anchors.verticalCenter: parent.verticalCenter
        glyph: "󰹑"
        glyphSize: island.f(14)
        color: island.fgDim
        fontFamily: island.fontFamily
        onClicked: island.captureRegion()
      }

      TextInput {
        id: input
        anchors.left: captureButton.right
        anchors.leftMargin: island.s(4)
        anchors.right: sendButton.left
        anchors.rightMargin: island.s(8)
        anchors.verticalCenter: parent.verticalCenter
        clip: true
        font.family: island.textFamily
        font.pixelSize: island.f(13)
        color: island.fg
        selectionColor: Util.alpha(island.accentColor, 0.4)
        enabled: view.assistant.connected
        focus: true
        onAccepted: view.send()
        Keys.onEscapePressed: island.collapse()
        Keys.onPressed: function(e) { view.chatKey(e) }

        Text {
          anchors.fill: parent
          verticalAlignment: Text.AlignVCenter
          visible: !input.text
          text: view.chat.messages.length > 0 ? "Continue…" : (view.secretary ? "Ask your secretary…" : "Ask the island…")
          textFormat: Text.PlainText
          font: input.font
          color: Util.alpha(island.fg, 0.38)
        }
      }

      // White disc with an arrow; a square to stop while it answers.
      Rectangle {
        id: sendButton
        anchors.right: parent.right
        anchors.rightMargin: island.s(6)
        anchors.verticalCenter: parent.verticalCenter
        width: island.s(30)
        height: width
        radius: width / 2
        readonly property bool ready: view.chat.busy || input.text.trim() !== "" || island.chatAttachments.length > 0
        color: view.chat.busy ? island.urgentColor : island.fg
        opacity: ready ? 1 : 0.35
        scale: sendMouse.pressed ? 0.88 : 1
        Behavior on opacity { NumberAnimation { duration: 160 } }
        Behavior on scale { NumberAnimation { duration: 120; easing.type: Easing.OutCubic } }
        Behavior on color { ColorAnimation { duration: 180 } }

        Text {
          anchors.centerIn: parent
          text: view.chat.busy ? "󰓛" : "󰁝"
          textFormat: Text.PlainText
          renderType: Text.NativeRendering
          font.family: island.fontFamily
          font.pixelSize: island.f(15)
          color: island.surface
        }
        MouseArea {
          id: sendMouse
          anchors.fill: parent
          cursorShape: Qt.PointingHandCursor
          onClicked: view.chat.busy ? view.assistant.chatStop() : view.send()
        }
      }
    }
  }

  // Typing goes straight in when the tab opens.
  Component.onCompleted: input.forceActiveFocus()
}
