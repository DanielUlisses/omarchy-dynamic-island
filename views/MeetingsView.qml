import QtQuick
import qs.Commons

// Meetings: everything transcribed on this machine, grouped by meeting title
// (a recurring call stacks up under one heading), newest first. Each one can
// open its summary or transcript, go to Island Chat as an attachment (󰭹 Ask,
// or 󰄬 To-dos, which sends the question straight away), or be deleted
// (press 󰆴 twice).
Item {
  id: view

  property var island: null
  readonly property var assistant: island.assistant
  readonly property var meetings: assistant.meetings
  property string confirming: ""
  Timer { id: confirmReset; interval: 3000; onTriggered: view.confirming = "" }

  // Headings and rows in one flat list: groups ordered by their newest meeting.
  readonly property var items: {
    var groups = {}, order = []
    for (var i = 0; i < meetings.length; i++) {
      var m = meetings[i]
      if (!groups[m.title]) { groups[m.title] = []; order.push(m.title) }
      groups[m.title].push(m)
    }
    var out = []
    for (var g = 0; g < order.length; g++) {
      out.push({ heading: true, title: order[g], count: groups[order[g]].length })
      for (var j = 0; j < groups[order[g]].length; j++) out.push({ heading: false, m: groups[order[g]][j] })
    }
    return out
  }

  readonly property bool current: island.workspaceTab === "meetings" && island.workspaceOpen
  onCurrentChanged: if (current) assistant.refreshMeetings()
  Component.onCompleted: assistant.refreshMeetings()

  function dateText(t) {
    var d = new Date(t)
    return Qt.formatDateTime(d, "ddd d MMM") + "  ·  " + Qt.formatDateTime(d, island.clockFormat.indexOf("AP") !== -1 ? "h:mm AP" : "HH:mm")
  }

  // Ask: the transcript waits as an attachment for your question. To-dos: sent at once.
  function ask(m, prompt) {
    if (prompt) {
      assistant.chatSend(prompt, [m.transcript], function() {})
      island.openWorkspace("chat")
    } else {
      island.attachFiles(["file://" + m.transcript])
    }
  }

  property string hint: ""
  readonly property var tips: ({
    summary: "Open the summary", transcript: "Open the transcript", ask: "Attach it to the chat and ask",
    todos: "Ask the agent for decisions and to-dos", "delete": "Delete (press twice)"
  })

  Text {
    anchors.centerIn: parent
    visible: view.meetings.length === 0
    width: parent.width - island.s(40)
    horizontalAlignment: Text.AlignHCenter
    wrapMode: Text.WordWrap
    text: !view.assistant.connected ? "The island daemon isn't running."
      : "No meetings transcribed yet.\nPress 󰍬 on a meeting in the calendar to start one."
    textFormat: Text.PlainText
    font.family: island.textFamily
    font.pixelSize: island.f(12)
    color: island.fgDim
  }

  ListView {
    anchors.fill: parent
    clip: true
    spacing: island.s(4)
    boundsBehavior: Flickable.StopAtBounds
    model: view.items

    delegate: Item {
      id: entry
      required property var modelData
      readonly property bool heading: modelData.heading
      readonly property var m: modelData.m
      width: ListView.view.width
      height: heading ? island.s(26) : island.s(46)

      // --- title heading
      Text {
        visible: entry.heading
        anchors.left: parent.left
        anchors.leftMargin: island.s(6)
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.bottomMargin: island.s(2)
        elide: Text.ElideRight
        text: entry.heading ? entry.modelData.title + (entry.modelData.count > 1 ? "  ·  " + entry.modelData.count : "") : ""
        textFormat: Text.PlainText
        renderType: Text.NativeRendering
        font.family: island.textFamily
        font.pixelSize: island.f(12)
        font.weight: Font.DemiBold
        color: island.fg
      }

      // --- one meeting
      Rectangle {
        id: row
        visible: !entry.heading
        anchors.fill: parent
        radius: island.s(14)
        color: Util.alpha(island.fg, rowHover.hovered ? 0.08 : 0.04)
        HoverHandler { id: rowHover }

        Column {
          anchors.verticalCenter: parent.verticalCenter
          x: island.s(12)
          width: parent.width - x - actions.width - island.s(10)
          spacing: island.s(1)

          Text {
            width: parent.width
            elide: Text.ElideRight
            text: entry.m ? view.dateText(entry.m.date) : ""
            textFormat: Text.PlainText
            renderType: Text.NativeRendering
            font.family: island.textFamily
            font.pixelSize: island.f(12)
            font.weight: Font.Medium
            color: island.fg
          }

          Text {
            width: parent.width
            elide: Text.ElideRight
            text: view.hint && rowHover.hovered ? view.hint
              : (entry.m ? [entry.m.duration, entry.m.words + " words", entry.m.hasSummary ? "" : "no summary"]
                .filter(function(x) { return x }).join("  ·  ") : "")
            textFormat: Text.PlainText
            renderType: Text.NativeRendering
            font.family: island.textFamily
            font.pixelSize: island.f(10)
            color: island.fgDim
          }
        }

        Row {
          id: actions
          anchors.right: parent.right
          anchors.rightMargin: island.s(6)
          anchors.verticalCenter: parent.verticalCenter

          // A fixed list: rebuilding it while a button is hovered would fire its "exited".
          Repeater {
            model: ["summary", "transcript", "ask", "todos", "delete"]
            delegate: Item {
              id: act
              required property string modelData
              readonly property bool danger: modelData === "delete"
              readonly property bool armed: danger && !!entry.m && view.confirming === entry.m.id
              readonly property bool on: modelData !== "summary" || (!!entry.m && entry.m.hasSummary)
              readonly property string glyph: ({ summary: "󰦨", transcript: "󰈙", ask: "󰭹", todos: "󰄬", "delete": armed ? "󰆴 ?" : "󰆴" })[modelData]
              visible: on
              width: on ? island.s(armed ? 40 : 28) : 0
              height: island.s(28)

              Rectangle {
                anchors.fill: parent
                radius: height / 2
                color: act.armed ? Util.alpha(island.urgentColor, 0.22)
                  : Util.alpha(island.fg, actMouse.containsMouse ? 0.12 : 0)
              }
              Text {
                anchors.centerIn: parent
                text: act.glyph
                textFormat: Text.PlainText
                renderType: Text.NativeRendering
                font.family: island.fontFamily
                font.pixelSize: island.f(13)
                color: act.danger ? island.urgentColor : island.fg
                opacity: actMouse.containsMouse || act.armed ? 1 : 0.7
              }
              MouseArea {
                id: actMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onEntered: view.hint = view.tips[act.modelData]
                onExited: view.hint = ""
                onClicked: {
                  var m = entry.m, t = act.modelData
                  if (t === "summary") island.openMarkdown(m.summary)
                  else if (t === "transcript") island.openMarkdown(m.transcript)
                  else if (t === "ask") view.ask(m, "")
                  else if (t === "todos") view.ask(m, "From this meeting transcript, list the decisions, the action items with who owns each, and any open questions. Answer in the language of the meeting.")
                  else if (view.confirming === m.id) { view.confirming = ""; view.assistant.deleteMeeting(m.id) }
                  else { view.confirming = m.id; confirmReset.restart() }
                }
              }
            }
          }
        }
      }
    }
  }
}
