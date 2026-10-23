import QtQuick
import Quickshell
import Quickshell.Io

// Meetings transcribed on this machine, with no bot on the call: voxtype's
// meeting mode records the microphone and the PipeWire monitor of the speakers
// together, and Whisper transcribes them locally. The calendar's mic button
// starts and stops it. When it stops, the transcript and an Ollama summary are
// written to ~/.local/share/omarchy-dynamic-island/meetings (or `meetingsDir`).
Item {
  id: transcription

  property var island: null
  readonly property bool wanted: !!island && island.setting("transcription", true) !== false

  // The transcript and summary were just written.
  signal saved()

  // idle | recording | paused, as voxtype reports it.
  property string phase: "idle"
  property string meetingId: ""
  property string title: ""
  // A stop was sent and the files are still being written.
  property bool finishing: false
  property double startedAt: 0
  readonly property bool active: phase === "recording" || phase === "paused"
  readonly property bool busy: active || finishing
  // false once `voxtype` turns out not to be installed.
  property bool available: true

  readonly property string dir: String(island ? island.setting("meetingsDir", "") : "")
    || ((Quickshell.env("XDG_DATA_HOME") || Quickshell.env("HOME") + "/.local/share") + "/omarchy-dynamic-island/meetings")

  function start(name) {
    if (!wanted || busy) return
    title = name || "Meeting"
    phase = "recording"
    startedAt = Date.now()
    heardCall = false
    endsAt = slotEnd(title)
    Quickshell.execDetached(["voxtype", "meeting", "start", "--title", title])
    settle.restart()
  }

  function stop() {
    if (!active) return
    finishing = true
    phase = "idle"
    Quickshell.execDetached(["voxtype", "meeting", "stop"])
    finish.command = ["sh", "-c", finishScript, "sh", meetingId || "latest", title, dir]
    finish.running = true
  }

  // Recording on after the call is over: stopped once no call app has held the
  // microphone for `meetingIdleMinutes` (default 2), provided a call was heard
  // during this recording or the meeting's calendar slot has passed. A meeting
  // recorded in the room, with no call app at all, runs until stopped by hand.
  // One the shell picks up already running (after a reload) has no known slot,
  // so it stops once no call holds the mic.
  property bool heardCall: false
  property double endsAt: 0
  readonly property bool callOn: !!island && island.callMicActive
  readonly property int idleMinutes: island ? Math.max(1, Number(island.setting("meetingIdleMinutes", 2)) || 2) : 2

  onCallOnChanged: if (callOn && active) heardCall = true
  onActiveChanged: if (active && callOn) heardCall = true

  // When the calendar event called `name` that is on (or about to be) ends.
  function slotEnd(name) {
    var list = island && island.calendar ? island.calendar.events : []
    var now = Date.now()
    for (var i = 0; i < list.length; i++)
      if (!list[i].allDay && list[i].title === name && list[i].start - now < 15 * 60000 && list[i].end > now)
        return list[i].end
    return 0
  }

  Timer {
    id: hangUp
    interval: transcription.idleMinutes * 60000
    repeat: true
    running: transcription.active && !transcription.callOn
      && (transcription.heardCall || transcription.endsAt > 0)
    onTriggered: {
      if (!transcription.active || transcription.callOn) return
      if (!transcription.heardCall && Date.now() < transcription.endsAt) return
      transcription.stop()
    }
  }

  function toggle(name) {
    if (active) stop()
    else start(name)
  }

  // Waits for voxtype to close the meeting, then writes both files and prints
  // their shared base name.
  readonly property string finishScript:
    'id=$1; title=$2; dir=$3; mkdir -p "$dir"\n' +
    'for i in $(seq 40); do voxtype meeting status 2>/dev/null | grep -q "No meeting" && break; sleep 1; done\n' +
    'sleep 8 # the last chunk is still being transcribed when voxtype reports the meeting closed\n' +
    '[ "$id" = latest ] && id=$(voxtype meeting list 2>/dev/null | grep -m1 "ID:" | awk "{print \\$2}")\n' +
    '# a recording the shell picked up after a restart: voxtype still has the title\n' +
    '[ -n "$title" ] || title=$(voxtype meeting list 2>/dev/null | grep -B1 -m1 "ID: $id" | head -1)\n' +
    'title=${title:-Meeting}\n' +
    'slug=$(printf %s "$title" | tr -c "A-Za-z0-9\\n" "-" | sed "s/--*/-/g;s/^-//;s/-$//" | cut -c1-40)\n' +
    'base="$dir/$(date +%F-%H%M)-${slug:-meeting}"\n' +
    'voxtype meeting export "$id" --speakers --timestamps --metadata -o "$base.transcript.md" >/dev/null 2>&1 || exit 1\n' +
    '# once more if Ollama was still loading the model\n' +
    'voxtype meeting summarize "$id" -o "$base.summary.md" >/dev/null 2>&1 || { sleep 10; voxtype meeting summarize "$id" -o "$base.summary.md" >/dev/null 2>&1; }\n' +
    'printf \'{"title":%s,"voxtype":"%s"}\' "$(printf %s "$title" | jq -Rs .)" "$id" > "$base.meta.json"\n' +
    'printf %s "$base"'

  Process {
    id: finish
    stdout: StdioCollector {
      onStreamFinished: {
        transcription.finishing = false
        var base = String(text || "").trim()
        var ok = base !== ""
        island.showHud({ key: "transcription", layout: "label", icon: "󰍬", valueText: "",
          label: ok ? "Transcript saved" : "Transcript failed",
          color: ok ? island.greenColor : island.urgentColor, duration: 2600 })
        if (ok) { transcription.lastBase = base; transcription.saved() }
      }
    }
  }

  // The newest transcript's path without its extension, for island-ctl and chat.
  property string lastBase: ""

  Process {
    id: probe
    command: ["voxtype", "meeting", "status"]
    stdout: StdioCollector {
      onStreamFinished: {
        if (transcription.finishing || settle.running) return
        var out = String(text || "")
        var m = /Meeting Status:\s*(\w+)/.exec(out)
        var id = /Meeting ID:\s*(\S+)/.exec(out)
        var next = m ? (m[1] === "recording" ? "recording" : (m[1] === "paused" || m[1] === "pausing" ? "paused" : "idle")) : "idle"
        if (next !== transcription.phase) {
          if (next !== "idle" && transcription.startedAt === 0) {
            transcription.startedAt = Date.now()
            transcription.heardCall = transcription.callOn
            transcription.endsAt = Date.now()
          }
          transcription.phase = next
        }
        if (id) transcription.meetingId = id[1]
        if (next === "idle") { transcription.startedAt = 0; transcription.title = ""; transcription.endsAt = 0 }
      }
    }
    onExited: function(code) { if (code === 127) transcription.available = false }
  }

  // voxtype takes a moment to open the meeting; don't read "idle" meanwhile.
  Timer { id: settle; interval: 2500 }

  Timer {
    interval: 4000
    repeat: true
    running: transcription.wanted && transcription.available
    triggeredOnStart: true
    onTriggered: if (!probe.running) probe.running = true
  }
}
