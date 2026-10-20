import QtQuick
import Quickshell
import Quickshell.Io
import "../IslandModel.js" as Model

// Coding agents running under herdr (https://herdr.dev): the ones on this
// machine and the ones on every SSH machine saved with `herdr machine add`,
// which is where most of them live. Only the live ones are shown: waiting on
// an answer, finished and not looked at yet, or busy. A toast says when one
// needs you or finishes, and clicking it (or its row) lands on that agent.
//
// herdr pushes events only per pane and only for one server, so the island
// asks every machine for its agent list every few seconds instead (each
// answers in a fraction of a second, all at once).
Item {
  id: herdr

  property var island: null
  readonly property bool wanted: !!island && island.setting("herdr", true) !== false
  readonly property int interval: Math.max(2, Number(island ? island.setting("herdrInterval", 5) : 5) || 5) * 1000

  // false once `herdr` turns out not to be installed.
  property bool available: true
  property var agents: []
  readonly property var live: Model.herdrLive(agents)
  readonly property int blocked: live.filter(function(a) { return a.status === "blocked" }).length
  readonly property int done: live.filter(function(a) { return a.status === "done" }).length
  readonly property int working: live.filter(function(a) { return a.status === "working" }).length
  readonly property var first: live.length > 0 ? live[0] : null
  readonly property color tone: first ? toneOf(first.status) : island.accentColor

  // key -> status at the last poll, and whether a first poll has been read.
  property var lastStatus: ({})
  property bool primed: false
  // Demo agents (IPC `demo agents`) stand in for herdr while set.
  property bool demo: false

  function toneOf(status) {
    if (status === "blocked") return island.urgentColor
    if (status === "done") return island.greenColor
    if (status === "working") return island.accentColor
    return island.fgDim
  }

  function find(key) {
    for (var i = 0; i < agents.length; i++) if (agents[i].key === key) return agents[i]
    return null
  }

  // Every enabled machine is asked at once; the local server only when it
  // is running, so a poll never starts one.
  readonly property string pollScript:
    "command -v herdr >/dev/null 2>&1 || { echo @@NOHERDR; exit 0; }; " +
    "d=$(mktemp -d) || exit 1; trap 'rm -rf \"$d\"' EXIT; " +
    "if herdr session list --json 2>/dev/null | jq -e '.sessions[]? | select(.default and .running)' >/dev/null 2>&1; then " +
    "  echo 'local - default' > \"$d/m0\"; (timeout 6 herdr agent list > \"$d/0\" 2>/dev/null) & fi; " +
    "i=1; " +
    "while IFS=$'\\t' read -r id target session label; do " +
    "  [[ $id =~ ^[A-Za-z0-9_-]{1,64}$ ]] || continue; " +
    "  [[ $target =~ ^(ssh://)?([A-Za-z0-9._-]+@)?[A-Za-z0-9._-]+(:[0-9]{1,5})?$ ]] || target=-; " +
    "  [[ $session =~ ^[A-Za-z0-9._-]{1,64}$ ]] || session=default; " +
    "  printf '%s %s %s %s\\n' \"$id\" \"$target\" \"$session\" \"$label\" > \"$d/m$i\"; " +
    "  (timeout 8 herdr --machine \"$id\" agent list > \"$d/$i\" 2>/dev/null) & " +
    "  i=$((i + 1)); " +
    "done < <(herdr machine list --json 2>/dev/null | jq -r '.[]? | select(.enabled != false) " +
    "  | [.id, (.target // \"-\"), (.session // \"default\"), (.label // \"\")] | @tsv' 2>/dev/null); " +
    "wait; " +
    "for ((j = 0; j < i; j++)); do [ -f \"$d/m$j\" ] || continue; " +
    "  printf '@@HERDR %s\\n' \"$(head -c 200 \"$d/m$j\")\"; head -c 1048576 \"$d/$j\" 2>/dev/null; echo; done"

  Process {
    id: poll
    command: ["bash", "-c", herdr.pollScript]
    stdout: StdioCollector { onStreamFinished: herdr.take(String(text || "")) }
  }

  Timer {
    interval: herdr.interval
    repeat: true
    running: herdr.wanted && herdr.available && !herdr.demo
    triggeredOnStart: true
    onTriggered: herdr.refresh()
  }

  // Shortly after opening an agent, to pick up its new (seen) state.
  Timer { id: soon; interval: 1500; onTriggered: herdr.refresh() }

  onWantedChanged: if (!wanted && !demo) { agents = []; lastStatus = {}; primed = false }

  function refresh() {
    if (!demo && wanted && !poll.running) poll.running = true
  }

  function take(text) {
    if (demo) return
    if (text.indexOf("@@NOHERDR") === 0) { available = false; agents = []; return }
    var r = Model.herdrParse(text)
    var list = r.agents
    // A machine that did not answer this time keeps what it last said, so a
    // dropped connection neither empties the island nor re-announces it all.
    if (r.failed.length > 0)
      for (var i = 0; i < agents.length; i++)
        if (r.failed.indexOf(agents[i].machine) !== -1) list.push(agents[i])
    apply(list)
  }

  function apply(list) {
    var events = Model.herdrChanges(lastStatus, list, primed)
    var next = {}
    for (var i = 0; i < list.length; i++) next[list[i].key] = list[i].status
    lastStatus = next
    agents = list
    primed = true
    announce(events)
  }

  function announce(events) {
    if (events.length === 0 || !island || island.setting("herdrToasts", true) === false) return
    var blockedEvents = events.filter(function(e) { return e.kind === "blocked" })
    var shown = blockedEvents.length > 0 ? blockedEvents : events
    var kind = shown[0].kind
    var a = shown[0].agent
    var color = kind === "blocked" ? island.urgentColor : island.greenColor
    var title, body
    if (shown.length === 1) {
      title = Model.agentTitle(a)
      var place = title === Model.agentPlace(a) ? a.agent : Model.agentPlace(a)
      body = (kind === "blocked" ? "Needs you" : "Finished") + (place ? " · " + place : "")
    } else {
      title = shown.length + (kind === "blocked" ? " agents need you" : " agents finished")
      body = shown.map(function(e) { return Model.agentPlace(e.agent) || e.agent.title }).join(", ")
    }
    island.edgeSweep++
    island.showHud({
      key: "toast",
      layout: "toast",
      title: title,
      body: body,
      icon: kind === "blocked" ? "󰀦" : "󰄬",
      color: color,
      // One agent: a click on the toast opens it.
      agentKey: shown.length === 1 ? a.key : "",
      duration: kind === "blocked" ? 7000 : 5000
    })
  }

  // Land on an agent, the way the herdr bar widget does: focus its pane on
  // the server that runs it (which also marks a finished one as seen), then
  // bring up the window attached to that machine (`herdr --remote <target>`,
  // or plain `herdr` for this one). Without one, open it: a foot window with
  // the same app id the widget uses, so the two share windows.
  readonly property string openScript:
    "m=$1; p=$2; t=$3; s=${4:-default}; " +
    "[[ $p =~ ^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{1,32}$ ]] || exit 1; " +
    "[[ $s =~ ^[A-Za-z0-9._-]{1,64}$ ]] || exit 1; " +
    "[ -z \"$t\" ] || [[ $t =~ ^(ssh://)?([A-Za-z0-9._-]+@)?[A-Za-z0-9._-]+(:[0-9]{1,5})?$ ]] || exit 1; " +
    "if [ -n \"$m\" ]; then [[ $m =~ ^[A-Za-z0-9_-]{1,64}$ ]] || exit 1; " +
    "  timeout 10 herdr --machine \"$m\" agent focus \"$p\" >/dev/null 2>&1; " +
    "else herdr agent focus \"$p\" >/dev/null 2>&1; fi; " +
    "declare -A win=(); " +
    "while IFS=$'\\t' read -r pid addr ws; do win[$pid]=\"$addr\"$'\\t'\"$ws\"; done < <(" +
    "  hyprctl clients -j 2>/dev/null | jq -r '.[]? | select(.pid > 0) | \"\\(.pid)\\t\\(.address)\\t\\(.workspace.name // \"\")\"' 2>/dev/null); " +
    // A window's herdr client carries flags and nothing else: `herdr`,
    // `herdr --session <name>`, `herdr --remote <target> [--session <name>]`.
    // Any other word is a subcommand (server, client helper, a CLI call).
    // From the matching one, walk up to the terminal window holding it.
    "found=''; " +
    "while read -r pid args; do " +
    "  read -r -a w <<<\"$args\"; [[ ${w[0]##*/} == herdr ]] || continue; " +
    "  name=default; tgt=''; ok=1; " +
    "  for ((j = 1; j < ${#w[@]}; j++)); do case ${w[j]} in " +
    "    --session) name=${w[j+1]-}; j=$((j + 1)) ;; --remote) tgt=${w[j+1]-}; j=$((j + 1)) ;; -*) ;; *) ok=0; break ;; esac; done; " +
    "  [ $ok = 1 ] && [ \"$name\" = \"$s\" ] && [ \"$tgt\" = \"$t\" ] || continue; " +
    "  a=$pid; for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do " +
    "    if [ -n \"${win[$a]-}\" ]; then found=${win[$a]}; break 2; fi; " +
    "    a=$(ps -o ppid= -p \"$a\" 2>/dev/null | tr -d ' '); [ -n \"$a\" ] && [ \"$a\" != 0 ] && [ \"$a\" != 1 ] || break; " +
    "  done; " +
    "done < <(ps -eo pid=,args= 2>/dev/null | grep -E 'her[d]r'); " +
    "if [ -n \"$found\" ]; then " +
    "  IFS=$'\\t' read -r addr ws <<<\"$found\"; " +
    "  [[ $addr =~ ^0x[0-9a-fA-F]+$ ]] || exit 0; " +
    // A window on another workspace stays hidden however hard it is focused,
    // so show its workspace first.
    "  [[ $ws =~ ^(special:)?[A-Za-z0-9_-]{1,32}$ ]] && hyprctl dispatch \"hl.dsp.focus({ workspace = '$ws' })\" >/dev/null 2>&1; " +
    "  hyprctl dispatch \"hl.dsp.focus({ window = 'address:$addr' })\" >/dev/null 2>&1 " +
    "    || hyprctl dispatch focuswindow \"address:$addr\" >/dev/null 2>&1; " +
    "  exit 0; " +
    "fi; " +
    "cmd=(herdr); [ -z \"$t\" ] || cmd+=(--remote \"$t\"); [ \"$s\" = default ] || cmd+=(--session \"$s\"); " +
    "launch=(setsid); command -v uwsm-app >/dev/null 2>&1 && launch=(setsid uwsm-app --); " +
    "if command -v foot >/dev/null 2>&1; then launch+=(foot --app-id=org.omarchy.herdr \"--working-directory=$HOME\" -e \"${cmd[@]}\"); " +
    "elif command -v xdg-terminal-exec >/dev/null 2>&1; then launch+=(xdg-terminal-exec --app-id=org.omarchy.herdr \"--dir=$HOME\" -- \"${cmd[@]}\"); " +
    "else exit 1; fi; " +
    "\"${launch[@]}\" >/dev/null 2>&1 &"

  function open(a) {
    if (!a) return
    if (!demo) {
      Quickshell.execDetached(["bash", "-c", openScript, "bash", a.machine, a.pane, a.target || "", a.session || "default"])
      soon.restart()
    }
    // Focusing a finished agent marks it seen; don't wait for the next poll
    // to drop it from the island.
    if (a.status === "done") {
      var list = agents.map(function(x) {
        if (x.key !== a.key) return x
        var copy = {}
        for (var k in x) copy[k] = x[k]
        copy.status = "idle"
        return copy
      })
      var next = {}
      for (var i = 0; i < list.length; i++) next[list[i].key] = list[i].status
      lastStatus = next
      agents = list
    }
  }

  // ---- demo
  readonly property var demoList: [
    { key: "bss/w3:p2", machine: "bss", label: "bss", pane: "w3:p2", agent: "claude", status: "blocked",
      title: "Kyverno CEL migration board", project: "helm-charts" },
    { key: "pythian/w2:p1", machine: "pythian", label: "pythian", pane: "w2:p1", agent: "codex", status: "done",
      title: "Rewrite the receipt formatter", project: "billing-api" },
    { key: "lanvera/w5:p1", machine: "lanvera", label: "lanvera", pane: "w5:p1", agent: "claude", status: "working",
      title: "Terraform policy exception module 2.0.0", project: "terraform-kyverno" },
    { key: "daniel/w1:p1", machine: "daniel", label: "daniel", pane: "w1:p1", agent: "claude", status: "idle",
      title: "Local LAN control", project: "sinapse_home_hacs" }
  ]

  function startDemo() {
    demo = true
    primed = false
    apply(demoList)
  }

  // A demo agent finishing, to see the toast.
  function demoFinish() {
    if (!demo) startDemo()
    var list = agents.map(function(x) {
      var copy = {}
      for (var k in x) copy[k] = x[k]
      if (copy.status === "working") copy.status = "done"
      return copy
    })
    apply(list)
  }

  function stopDemo() {
    if (!demo) return
    demo = false
    agents = []
    lastStatus = {}
    primed = false
    refresh()
  }
}
