import QtQuick
import qs.Commons
import "../IslandModel.js" as Model

// Home: one agent at a time (‹ › or a click on the avatar pages through the
// list shown, most urgent first). Two lists: "local" (sessions reporting
// through island-hook on this machine) and "herdr" (everything herdr
// publishes, on every machine). For a local one, on the left its avatar, name
// and what it did this turn, step by step; on the right the file it is
// changing, like an editor tab, and the tail of the last command it ran. For
// herdr the right side is herdr's own status of each agent, blocked first,
// then done, working and idle, each with a button that takes you there.
// A waiting approval sits on top.
Item {
  id: view

  property var island: null
  readonly property var assistant: island.assistant
  readonly property var rows: assistant.agents
  // Hooks only reach the island from this machine, so only local sessions have
  // steps and diffs; herdr publishes a status for every agent it runs, on any machine.
  readonly property var localRows: rows.filter(function(r) { return !!r.hookSession })
  readonly property var herdrRows: rows.filter(function(r) { return !!r.pane })
  property bool showHerdr: false
  readonly property bool herdrGroup: herdrRows.length > 0 && (showHerdr || localRows.length === 0)
  readonly property var group: herdrGroup ? herdrRows : localRows
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

  // The avatar cycles the list that is shown, local or herdr.
  function poke() { page(1) }

  function toggleHerdr() {
    showHerdr = !herdrGroup
    var list = showHerdr ? herdrRows : localRows
    if (list.length > 0) selectedKey = list[0].key
  }

  // Typing goes straight in whenever Home is shown (see Island.chatTyping).
  function focusPage() { Qt.callLater(function() { if (view.visible) view.forceActiveFocus() }) }
  // The page is hidden until the workspace has animated in: focus it when it shows.
  onVisibleChanged: if (visible && island.workspaceTab === "agents") focusPage()
  focus: true
  Component.onCompleted: focusPage()
  Connections {
    target: view.island
    function onWorkspaceTabChanged() { if (view.island.workspaceTab === "agents") view.focusPage() }
    function onWorkspaceOpenChanged() { if (view.island.workspaceOpen && view.island.workspaceTab === "agents") view.focusPage() }
    function onViewChanged() { if (view.island.view === "workspace-expanded" && view.island.workspaceTab === "agents") view.focusPage() }
  }

  // Ctrl+H local / herdr, Ctrl+A next agent (same as clicking the avatar), Ctrl+Shift+A the previous one, Ctrl+O open it in herdr; ← → page.
  function openSelected() { if (selected && selected.pane) island.openAgentByKey(selected.key) }
  Keys.onPressed: function(e) {
    var ctrl = (e.modifiers & Qt.ControlModifier) && !(e.modifiers & (Qt.AltModifier | Qt.MetaModifier))
    if (ctrl && e.key === Qt.Key_H) { if (localRows.length > 0 && herdrRows.length > 0) toggleHerdr() }
    else if (ctrl && e.key === Qt.Key_A) { if (e.modifiers & Qt.ShiftModifier) page(-1); else poke() }
    else if (ctrl && e.key === Qt.Key_O) openSelected()
    else if (e.key === Qt.Key_Left) page(-1)
    else if (e.key === Qt.Key_Right) page(1)
    else return
    e.accepted = true
  }

  function select(r) {
    selectedKey = r.key
    assistant.markSeen(r.hookSession)
  }

  readonly property var statusOrder: ["blocked", "done", "working", "idle"]
  function statusLabel(st) { return st === "blocked" ? "Blocked" : (st === "done" ? "Done" : (st === "working" ? "Working" : "Idle")) }
  function statusColor(st) {
    return st === "blocked" ? island.orangeColor : (st === "done" ? island.greenColor : (st === "working" ? island.accentColor : island.fgDim))
  }
  // herdr's agents under a heading per status, in the order above.
  readonly property var herdrItems: {
    var out = []
    for (var o = 0; o < statusOrder.length; o++) {
      var st = statusOrder[o], mine = herdrRows.filter(function(r) { return (statusOrder.indexOf(r.status) === -1 ? "idle" : r.status) === st })
      if (mine.length === 0) continue
      out.push({ heading: true, status: st, count: mine.length })
      for (var j = 0; j < mine.length; j++) out.push({ heading: false, r: mine[j] })
    }
    return out
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

      // Switch between the local list and herdr's.
      PillButton {
        visible: view.localRows.length > 0 && view.herdrRows.length > 0
        anchors.right: parent.right
        anchors.rightMargin: island.s(2)
        y: pager.visible ? pager.y + pager.height + island.s(4) : face.y
        island: view.island
        label: view.herdrGroup ? "󰋜 " + view.localRows.length : "󰒍 " + view.herdrRows.length
        selected: view.herdrGroup
        onClicked: view.toggleHerdr()
      }

      Text {
        anchors.right: parent.right
        anchors.rightMargin: island.s(2)
        y: face.y + face.height - implicitHeight
        text: "^H list · ^A/^⇧A page · ^O open"
        visible: view.rows.length > 0 && main.height > island.s(220)
        textFormat: Text.PlainText
        renderType: Text.NativeRendering
        font.family: island.textFamily
        font.pixelSize: island.f(9)
        color: Util.alpha(island.fg, 0.4)
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

    // ---- right, for the herdr list: what herdr says about each agent
    Rectangle {
      id: herdrPanel
      visible: view.herdrGroup
      x: side.width + island.s(10)
      width: parent.width - x
      height: parent.height
      radius: island.s(16)
      color: Qt.darker(island.surface, 1.25)
      border.width: 1
      border.color: Util.alpha(island.fg, 0.06)
      clip: true

      ListView {
        id: herdrList
        anchors.fill: parent
        anchors.margins: island.s(8)
        clip: true
        spacing: island.s(4)
        boundsBehavior: Flickable.StopAtBounds
        model: view.herdrItems

        // Cycling with the avatar keeps the selected agent in sight.
        function reveal() {
          for (var i = 0; i < view.herdrItems.length; i++) {
            var it = view.herdrItems[i]
            if (!it.heading && view.selected && it.r.key === view.selected.key) { positionViewAtIndex(i, ListView.Contain); return }
          }
        }
        Connections {
          target: view
          function onSelectedKeyChanged() { herdrList.reveal() }
        }

        delegate: Item {
          id: hrow
          required property var modelData
          readonly property bool heading: modelData.heading
          readonly property var r: modelData.r
          readonly property bool current: !heading && !!r && !!view.selected && r.key === view.selected.key
          width: ListView.view.width
          height: heading ? island.s(24) : island.s(40)

          Row {
            visible: hrow.heading
            anchors.left: parent.left
            anchors.leftMargin: island.s(6)
            anchors.bottom: parent.bottom
            anchors.bottomMargin: island.s(2)
            spacing: island.s(6)
            Rectangle {
              anchors.verticalCenter: parent.verticalCenter
              width: island.s(8); height: width; radius: width / 2
              color: hrow.heading ? view.statusColor(hrow.modelData.status) : "transparent"
            }
            Text {
              text: hrow.heading ? view.statusLabel(hrow.modelData.status) + "  ·  " + hrow.modelData.count : ""
              textFormat: Text.PlainText
              renderType: Text.NativeRendering
              font.family: island.textFamily
              font.pixelSize: island.f(11)
              font.weight: Font.DemiBold
              color: hrow.heading ? view.statusColor(hrow.modelData.status) : island.fg
            }
          }

          Rectangle {
            visible: !hrow.heading
            anchors.fill: parent
            radius: island.s(12)
            color: Util.alpha(island.fg, hrow.current ? 0.12 : (rowMouse.containsMouse ? 0.08 : 0.04))
            border.width: hrow.current ? 1 : 0
            border.color: Util.alpha(island.accentColor, 0.5)

            MouseArea {
              id: rowMouse
              anchors.fill: parent
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onClicked: if (hrow.r) view.select(hrow.r)
            }

            Rectangle {
              x: island.s(9)
              anchors.verticalCenter: parent.verticalCenter
              width: island.s(3); height: parent.height - island.s(16); radius: width / 2
              color: hrow.r ? view.statusColor(hrow.r.status) : "transparent"
            }

            Column {
              x: island.s(20)
              anchors.verticalCenter: parent.verticalCenter
              width: parent.width - x - goButton.width - island.s(14)
              spacing: island.s(1)
              Text {
                width: parent.width
                elide: Text.ElideRight
                text: hrow.r ? (hrow.r.project || hrow.r.title || hrow.r.place || "agent") : ""
                textFormat: Text.PlainText
                renderType: Text.NativeRendering
                font.family: island.textFamily
                font.pixelSize: island.f(12)
                font.weight: Font.DemiBold
                color: island.fg
              }
              Text {
                width: parent.width
                elide: Text.ElideRight
                text: hrow.r ? view.agentName(hrow.r.agent) + "  ·  " + Model.agentStateText(hrow.r.status)
                  + (hrow.r.machine ? "  ·  " + (hrow.r.label || hrow.r.target || "remote") : "")
                  + (hrow.r.title && hrow.r.project ? "  ·  " + hrow.r.title : "") : ""
                textFormat: Text.PlainText
                renderType: Text.NativeRendering
                font.family: island.textFamily
                font.pixelSize: island.f(10)
                color: island.fgDim
              }
            }

            // Takes you to the agent in herdr, like the herdr bar widget does.
            Rectangle {
              id: goButton
              anchors.right: parent.right
              anchors.rightMargin: island.s(8)
              anchors.verticalCenter: parent.verticalCenter
              width: goText.implicitWidth + island.s(20)
              height: island.s(26)
              radius: height / 2
              color: Util.alpha(hrow.r ? view.statusColor(hrow.r.status) : island.accentColor, goMouse.containsMouse ? 0.3 : 0.18)
              Text {
                id: goText
                anchors.centerIn: parent
                text: "󰁔  Go"
                textFormat: Text.PlainText
                renderType: Text.NativeRendering
                font.family: island.fontFamily
                font.pixelSize: island.f(11)
                color: island.fg
              }
              MouseArea {
                id: goMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: if (hrow.r) island.openAgentByKey(hrow.r.key)
              }
            }
          }
        }
      }
    }

    // ---- right: the file being changed, like an editor tab
    Rectangle {
      id: editor
      visible: !view.herdrGroup
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
        text: !view.selected ? "" : "No file changes yet. They show up here as the agent edits."
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
