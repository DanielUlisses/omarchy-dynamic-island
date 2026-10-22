import QtQuick
import qs.Commons
import "../IslandModel.js" as Model

// Home: one agent at a time (‹ › to page through them, most urgent first).
// On the left its avatar, name and what it did this turn, step by step; on
// the right the file it is changing, like an editor tab, and the tail of the
// last command it ran. A waiting approval sits on top.
Item {
  id: view

  property var island: null
  readonly property var assistant: island.assistant
  readonly property var rows: assistant.agents
  // Agents on this machine and the ones on herdr's SSH machines page in
  // separate loops: hooks only reach the island from this machine, so the
  // remote ones have status but no steps or diffs.
  readonly property var localRows: rows.filter(function(r) { return !r.machine })
  readonly property var remoteRows: rows.filter(function(r) { return !!r.machine })
  property bool showRemote: false
  readonly property bool remoteGroup: remoteRows.length > 0 && (showRemote || localRows.length === 0)
  readonly property var group: remoteGroup ? remoteRows : localRows
  property string selectedKey: ""
  readonly property int selectedIndex: {
    for (var i = 0; i < group.length; i++) if (group[i].key === selectedKey) return i
    return group.length > 0 ? 0 : -1
  }
  readonly property var selected: selectedIndex >= 0 ? group[selectedIndex] : null
  property var diffs: []
  property int diffIndex: 0
  readonly property string session: selected ? selected.hookSession : ""
  readonly property int diffCount: selected ? selected.diffCount : 0
  readonly property var diff: diffs.length > 0 ? diffs[Math.min(diffIndex, diffs.length - 1)] : null
  readonly property var terminal: selected && selected.terminal ? selected.terminal : null

  function page(delta) {
    if (group.length < 2) return
    var i = (selectedIndex + delta + group.length) % group.length
    selectedKey = group[i].key
    assistant.markSeen(group[i].hookSession)
  }

  // The avatar only cycles this machine's agents; from the remote loop it
  // comes back to the first local one.
  function poke() {
    if (remoteGroup && localRows.length > 0) {
      showRemote = false
      selectedKey = localRows[0].key
      assistant.markSeen(localRows[0].hookSession)
    } else if (!remoteGroup) page(1)
  }

  function toggleRemote() {
    showRemote = !remoteGroup
    var list = showRemote ? remoteRows : localRows
    if (list.length > 0) selectedKey = list[0].key
  }

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

  function agentName(a) {
    var names = { claude: "Claude Code", codex: "Codex", gemini: "Gemini CLI", cursor: "Cursor", opencode: "opencode", pi: "Pi", "pi-agent": "Pi", island: "Island Chat" }
    return names[a] || a
  }
  function moodFor(a) {
    if (!a) return "idle"
    return a.status === "blocked" ? "approval" : (a.status === "working" ? "working" : (a.status === "done" ? "done" : "idle"))
  }

  ApprovalCard {
    id: banner
    visible: !!view.assistant.approval
    x: -island.s(4)
    width: parent.width + island.s(8)
    height: visible ? (view.assistant.approval.questions.length ? Model.approvalSize(view.assistant.approval).h - island.s(10) : island.s(118)) : 0
    island: view.island
    approval: view.assistant.approval
    compact: true
  }

  // ---- nothing running
  Column {
    visible: view.rows.length === 0 && !banner.visible
    anchors.centerIn: parent
    spacing: island.s(12)

    OmarchyAvatar {
      anchors.horizontalCenter: parent.horizontalCenter
      width: island.s(84)
      height: width
      mood: "idle"
      base: island.fg
      ink: island.surface
      accent: island.accentColor
      alert: island.orangeColor
      good: island.greenColor
      lookX: island.lookX
      lookY: island.lookY
    }
    Text {
      anchors.horizontalCenter: parent.horizontalCenter
      width: island.s(360)
      horizontalAlignment: Text.AlignHCenter
      wrapMode: Text.WordWrap
      text: view.assistant.connected ? "No agents running. Start Claude Code anywhere, or press + for a new one in herdr."
        : "The island daemon isn't running. Run ./install-hooks.sh once to set it up."
      textFormat: Text.PlainText
      font.family: island.textFamily
      font.pixelSize: island.f(12)
      color: island.fgDim
    }
  }

  Item {
    id: main
    visible: view.rows.length > 0
    y: banner.height + (banner.visible ? island.s(10) : 0)
    width: parent.width
    height: parent.height - y

    // ---- left: who, and what it did this turn
    Item {
      id: side
      width: island.s(156)
      height: parent.height

      OmarchyAvatar {
        id: face
        x: island.s(4)
        y: island.s(2)
        width: island.s(main.height > island.s(220) ? 84 : 56)
        height: width
        mood: view.moodFor(view.selected)
        base: island.fg
        ink: island.surface
        accent: island.accentColor
        glow: view.selected ? view.selected.color : island.accentColor
        alert: island.orangeColor
        good: island.greenColor
        lookX: island.lookX
        lookY: island.lookY
        onPoked: view.poke()
      }

      // ‹ 1/3 › when the loop shown has more than one agent.
      Row {
        id: pager
        visible: view.group.length > 1
        anchors.right: parent.right
        anchors.rightMargin: island.s(2)
        y: face.y
        spacing: 0
        IconButton { glyph: "󰅁"; glyphSize: island.f(12); color: island.fgDim; fontFamily: island.fontFamily; onClicked: view.page(-1) }
        Text {
          anchors.verticalCenter: parent.verticalCenter
          text: (view.selectedIndex + 1) + "/" + view.group.length
          textFormat: Text.PlainText
          renderType: Text.NativeRendering
          font.family: island.fontFamily
          font.pixelSize: island.f(10)
          color: island.fgDim
        }
        IconButton { glyph: "󰅂"; glyphSize: island.f(12); color: island.fgDim; fontFamily: island.fontFamily; onClicked: view.page(1) }
      }

      // Switch the pager between this machine's loop and the remote one.
      PillButton {
        visible: view.localRows.length > 0 && view.remoteRows.length > 0
        anchors.right: parent.right
        anchors.rightMargin: island.s(2)
        y: pager.visible ? pager.y + pager.height + island.s(4) : face.y
        island: view.island
        label: view.remoteGroup ? "󰋜 " + view.localRows.length : "󰒍 " + view.remoteRows.length
        selected: view.remoteGroup
        onClicked: view.toggleRemote()
      }

      Column {
        id: who
        x: island.s(4)
        y: face.y + face.height + island.s(12)
        width: parent.width - island.s(4)
        spacing: island.s(1)

        Text {
          width: parent.width
          text: view.selected ? (view.selected.project || view.selected.place || "local") : ""
          textFormat: Text.PlainText
          renderType: Text.NativeRendering
          elide: Text.ElideRight
          font.family: island.textFamily
          font.pixelSize: island.f(16)
          font.weight: Font.Bold
          color: island.fg
        }
        Text {
          width: parent.width
          text: view.selected ? view.agentName(view.selected.agent) + (view.selected.label ? "  ·  " + view.selected.label : "") : ""
          textFormat: Text.PlainText
          renderType: Text.NativeRendering
          elide: Text.ElideRight
          font.family: island.textFamily
          font.pixelSize: island.f(12)
          color: island.fgDim
        }
      }

      // The turn, step by step; the last row is "Done" once it stops.
      ListView {
        id: steps
        x: island.s(4)
        y: who.y + who.height + island.s(14)
        width: parent.width - island.s(4)
        height: parent.height - y
        clip: true
        interactive: false
        spacing: island.s(5)
        readonly property var all: view.selected ? view.selected.steps || [] : []
        // What to show: the latest steps that fit, then "Done".
        readonly property var wanted: {
          var shown = all.slice(-Math.max(1, Math.floor(height / island.s(25)) - 1))
          if (view.selected && all.length > 0)
            shown = shown.concat([{ tool: "Done", summary: "", state: view.selected.status === "done" || view.selected.status === "idle" ? "done" : "pending", at: -1 }])
          return shown
        }
        // A ListModel updated in place, so new steps slide in and finished
        // ones turn green instead of the whole list being rebuilt.
        model: ListModel { id: stepModel }
        onWantedChanged: Qt.callLater(sync)
        function keyOf(x) { return x.tool + "@" + x.at }
        function sync() {
          var w = wanted, keys = w.map(keyOf)
          // Steps that scrolled off the top leave from the top.
          var has = false
          for (var k = 0; k < stepModel.count && keys.length > 0; k++) if (keyOf(stepModel.get(k)) === keys[0]) has = true
          while (has && stepModel.count > 0 && keys.indexOf(keyOf(stepModel.get(0))) === -1) stepModel.remove(0)
          var i = 0
          while (i < stepModel.count && i < w.length && keyOf(stepModel.get(i)) === keys[i]) {
            if (stepModel.get(i).state !== w[i].state) stepModel.setProperty(i, "state", w[i].state)
            i++
          }
          if (stepModel.count > i) stepModel.remove(i, stepModel.count - i)
          for (; i < w.length; i++) stepModel.append({ tool: w[i].tool, summary: w[i].summary || "", state: w[i].state, at: w[i].at })
        }
        add: Transition {
          NumberAnimation { property: "opacity"; from: 0; to: 1; duration: 240 }
          NumberAnimation { property: "x"; from: -island.s(10); duration: 260; easing.type: Easing.OutCubic }
        }
        remove: Transition { NumberAnimation { property: "opacity"; to: 0; duration: 160 } }
        displaced: Transition { NumberAnimation { properties: "y"; duration: 220; easing.type: Easing.OutCubic } }

        delegate: Item {
          id: stepRow
          required property string tool
          required property string summary
          required property string state
          required property int index
          readonly property bool running: state === "running"
          readonly property bool done: state === "done"
          width: ListView.view.width
          height: island.s(20)

          // ✓ in a green disc, a turning arc, or a dim ring.
          Item {
            id: mark
            width: island.s(16)
            height: width
            anchors.verticalCenter: parent.verticalCenter

            Rectangle {
              anchors.fill: parent
              radius: width / 2
              color: stepRow.done ? island.greenColor : "transparent"
              border.width: stepRow.done ? 0 : Math.max(1.5, island.s(1.6))
              border.color: Util.alpha(island.fg, stepRow.running ? 0.18 : 0.25)
              Behavior on color { ColorAnimation { duration: 220 } }
            }
            Text {
              visible: stepRow.done
              anchors.centerIn: parent
              text: "✓"
              textFormat: Text.PlainText
              font.pixelSize: island.f(10)
              font.bold: true
              color: island.surface
            }
            Canvas {
              id: arc
              visible: stepRow.running
              anchors.fill: parent
              onPaint: {
                var ctx = getContext("2d")
                ctx.reset()
                ctx.lineWidth = Math.max(1.5, island.s(1.6))
                ctx.lineCap = "round"
                ctx.strokeStyle = island.fg
                ctx.beginPath()
                ctx.arc(width / 2, height / 2, width / 2 - ctx.lineWidth, 0, Math.PI * 1.2)
                ctx.stroke()
              }
              RotationAnimation on rotation { running: arc.visible; loops: Animation.Infinite; from: 0; to: 360; duration: 900 }
            }
          }

          Text {
            anchors.left: mark.right
            anchors.leftMargin: island.s(9)
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            text: stepRow.tool
            textFormat: Text.PlainText
            renderType: Text.NativeRendering
            elide: Text.ElideRight
            font.family: island.textFamily
            font.pixelSize: island.f(13)
            font.weight: stepRow.running ? Font.DemiBold : Font.Medium
            color: stepRow.state === "pending" ? island.fgDim : island.fg
            opacity: stepRow.state === "pending" ? 0.55 : 1
            Behavior on opacity { NumberAnimation { duration: 200 } }
          }
        }
      }

      Text {
        visible: steps.count === 0
        x: island.s(4)
        y: steps.y
        width: parent.width - island.s(4)
        wrapMode: Text.WordWrap
        maximumLineCount: 4
        elide: Text.ElideRight
        text: !view.selected ? "" : (view.selected.lastPrompt ? "“" + view.selected.lastPrompt + "”"
          : (view.selected.hookSession ? "Waiting for a prompt" : Model.agentStateText(view.selected.status)))
        textFormat: Text.PlainText
        font.family: island.textFamily
        font.pixelSize: island.f(11)
        color: island.fgDim
      }
    }

    // ---- right: the file being changed, like an editor tab
    Rectangle {
      id: editor
      x: side.width + island.s(10)
      width: parent.width - x
      height: parent.height
      radius: island.s(16)
      color: Qt.darker(island.surface, 1.25)
      border.width: 1
      border.color: Util.alpha(island.fg, 0.06)
      clip: true

      Item {
        id: tabBar
        visible: !!view.diff
        x: island.s(10)
        y: island.s(8)
        width: parent.width - island.s(20)
        height: island.s(28)

        Rectangle {
          id: fileTab
          height: parent.height
          width: tabContent.implicitWidth + island.s(22)
          radius: island.s(9)
          color: Util.alpha(island.fg, 0.07)

          Row {
            id: tabContent
            anchors.centerIn: parent
            spacing: island.s(7)

            Rectangle {
              readonly property var lang: Model.languageOf(view.diff ? view.diff.path : "")
              anchors.verticalCenter: parent.verticalCenter
              width: island.s(18)
              height: island.s(14)
              radius: island.s(3)
              color: lang.color
              Text {
                anchors.centerIn: parent
                text: parent.lang.badge
                textFormat: Text.PlainText
                font.family: island.fontFamily
                font.pixelSize: island.f(7)
                font.bold: true
                color: "#ffffff"
              }
            }
            Text {
              anchors.verticalCenter: parent.verticalCenter
              text: view.diff ? String(view.diff.path).split("/").pop() : ""
              textFormat: Text.PlainText
              renderType: Text.NativeRendering
              font.family: island.fontFamily
              font.pixelSize: island.f(12)
              color: island.fg
            }
            // Still being edited: the newest file of a busy agent.
            Rectangle {
              visible: !!view.selected && view.selected.status === "working" && view.diffIndex === view.diffs.length - 1
              anchors.verticalCenter: parent.verticalCenter
              width: island.s(7)
              height: width
              radius: width / 2
              color: island.orangeColor
              SequentialAnimation on opacity {
                running: parent.visible
                loops: Animation.Infinite
                NumberAnimation { to: 0.35; duration: 700; easing.type: Easing.InOutSine }
                NumberAnimation { to: 1; duration: 700; easing.type: Easing.InOutSine }
              }
            }
          }
        }

        Row {
          id: fileNav
          visible: view.diffs.length > 1
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          IconButton { glyph: "󰅁"; glyphSize: island.f(11); color: island.fgDim; fontFamily: island.fontFamily; available: view.diffIndex > 0; onClicked: view.diffIndex-- }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            text: (view.diffIndex + 1) + "/" + view.diffs.length
            textFormat: Text.PlainText
            renderType: Text.NativeRendering
            font.family: island.fontFamily
            font.pixelSize: island.f(10)
            color: island.fgDim
          }
          IconButton { glyph: "󰅂"; glyphSize: island.f(11); color: island.fgDim; fontFamily: island.fontFamily; available: view.diffIndex < view.diffs.length - 1; onClicked: view.diffIndex++ }
        }

        Text {
          anchors.left: fileTab.right
          anchors.leftMargin: island.s(12)
          anchors.right: fileNav.visible ? fileNav.left : parent.right
          anchors.rightMargin: island.s(8)
          anchors.verticalCenter: parent.verticalCenter
          horizontalAlignment: Text.AlignRight
          text: view.diff ? String(view.diff.path).split("/").slice(-3).join("/") + "   " + Model.diffText(view.diff.added, view.diff.removed) : ""
          textFormat: Text.PlainText
          renderType: Text.NativeRendering
          elide: Text.ElideLeft
          font.family: island.fontFamily
          font.pixelSize: island.f(11)
          color: Util.alpha(island.fg, 0.4)
        }
      }

      Text {
        anchors.centerIn: parent
        visible: !view.diff
        width: parent.width - island.s(40)
        horizontalAlignment: Text.AlignHCenter
        wrapMode: Text.WordWrap
        text: !view.selected ? "" : (view.session ? "No file changes yet. They show up here as the agent edits."
          : view.selected.machine ? "Remote herdr agent on " + (view.selected.label || view.selected.target || "an SSH machine") + ". Hooks only reach the island from this machine, so only its status is shown."
          : "herdr sees this agent, but it isn't reporting through island-hook, so its edits aren't tracked.")
        textFormat: Text.PlainText
        font.family: island.textFamily
        font.pixelSize: island.f(11)
        color: island.fgDim
      }

      DiffViewer {
        id: diffView
        visible: !!view.diff
        x: island.s(4)
        y: tabBar.y + tabBar.height + island.s(8)
        width: parent.width - island.s(8)
        height: (term.visible ? term.y - island.s(6) : parent.height - island.s(8)) - y
        island: view.island
        diff: view.diff
      }

      // The last command and the tail of what it printed.
      Rectangle {
        id: term
        readonly property string out: view.terminal ? String(view.terminal.output || "") : ""
        readonly property string verdict: /\bFAIL(ED)?\b|\bfailed\b|Error:|✗/.test(out) ? "FAIL" : (/\bPASS(ED)?\b|\bpassed\b|✓/.test(out) ? "PASS" : "")
        visible: !!view.terminal
        x: island.s(8)
        width: parent.width - island.s(16)
        height: Math.min(island.s(78), termText.implicitHeight + island.s(30))
        y: parent.height - height - island.s(8)
        radius: island.s(10)
        color: Util.alpha("#000000", 0.25)

        Row {
          id: termHead
          x: island.s(10)
          y: island.s(6)
          spacing: island.s(8)
          Text {
            text: "$ " + (view.terminal ? view.terminal.command : "")
            textFormat: Text.PlainText
            renderType: Text.NativeRendering
            elide: Text.ElideRight
            width: Math.min(implicitWidth, term.width - island.s(80))
            font.family: island.fontFamily
            font.pixelSize: island.f(11)
            color: island.fg
          }
          Rectangle {
            visible: term.verdict !== ""
            width: verdictText.implicitWidth + island.s(10)
            height: island.s(15)
            radius: island.s(3)
            color: term.verdict === "PASS" ? island.greenColor : island.urgentColor
            Text {
              id: verdictText
              anchors.centerIn: parent
              text: term.verdict
              textFormat: Text.PlainText
              font.family: island.fontFamily
              font.pixelSize: island.f(9)
              font.bold: true
              color: island.surface
            }
          }
        }
        Text {
          id: termText
          x: island.s(10)
          y: termHead.y + island.s(18)
          width: parent.width - island.s(20)
          height: parent.height - y - island.s(4)
          clip: true
          verticalAlignment: Text.AlignBottom
          text: term.out.split("\n").slice(-3).join("\n")
          textFormat: Text.PlainText
          renderType: Text.NativeRendering
          elide: Text.ElideRight
          font.family: island.fontFamily
          font.pixelSize: island.f(10)
          color: Util.alpha(island.fg, 0.55)
        }
      }
    }
  }
}
