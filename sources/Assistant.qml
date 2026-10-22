import QtQuick
import Quickshell
import Quickshell.Io
import "../IslandModel.js" as Model

// The island's line to island-agent-daemon (daemon/ in this repo): the coding
// agents herdr and Claude Code's hooks report, the permission requests and
// questions waiting on you, the diffs each session made, every account's plan
// usage, and Island Chat.
//
// One socket, /tmp/omarchy-island-$UID.sock, newline-delimited JSON-RPC.
// After `island.subscribe` the daemon pushes `state` and `chat` whenever
// something changes. With no daemon the island works as before; it tries to
// start one (the systemd user unit, else ~/.local/bin/island-agent-daemon)
// and keeps reconnecting quietly.
Item {
  id: assistant

  property var island: null
  readonly property bool wanted: !!island && island.setting("assistant", true) !== false

  property string uid: ""
  readonly property string socketPath: Quickshell.env("OMARCHY_ISLAND_SOCKET")
    || (uid ? "/tmp/omarchy-island-" + uid + ".sock" : "")
  readonly property bool connected: sock.connected && subscribed
  property bool subscribed: false

  // ---- what the daemon says
  property var agents: []
  property var approvals: []
  property var accounts: []
  property bool herdrAvailable: false
  property var herdrAgents: []
  property var totals: ({ added: 0, removed: 0 })
  property var secretary: ({ path: "", present: false })
  property var chat: ({ busy: false, messages: [], profileId: "", model: "", workspace: "island", error: "" })

  readonly property var approval: approvals.length > 0 ? approvals[0] : null
  readonly property bool working: chat.busy || agents.some(function(a) { return a.status === "working" })
  readonly property var workingAgent: {
    for (var i = 0; i < agents.length; i++) if (agents[i].status === "working") return agents[i]
    return null
  }

  // Minute tick, so countdowns and the pill move without new numbers.
  property real now: Date.now()
  Timer { interval: 30000; repeat: true; running: true; onTriggered: assistant.now = Date.now() }
  readonly property var headline: Model.planHeadline(accounts, now)

  function rowFor(key) {
    for (var i = 0; i < agents.length; i++) if (agents[i].key === key) return agents[i]
    return null
  }

  // ---- socket
  property int nextId: 1
  property var pending: ({})
  property int failures: 0
  property real lastStart: 0

  Process {
    running: true
    command: ["id", "-u"]
    stdout: StdioCollector { onStreamFinished: assistant.uid = String(text || "").trim() }
  }

  Socket {
    id: sock
    path: assistant.socketPath
    parser: SplitParser { onRead: function(line) { assistant.take(line) } }
    onConnectedChanged: {
      if (sock.connected) {
        assistant.failures = 0
        assistant.call("island.subscribe", {}, function(r) {
          if (!r) return
          assistant.subscribed = true
          assistant.applyState(r.state)
          if (r.chat) assistant.chat = r.chat
        })
      } else {
        assistant.subscribed = false
        assistant.pending = ({})
        assistant.approvals = []
        assistant.agents = []
      }
    }
    onError: function(e) { assistant.failures++ }
  }

  Timer {
    interval: 3000
    repeat: true
    running: assistant.wanted && assistant.socketPath !== "" && !sock.connected
    triggeredOnStart: true
    onTriggered: {
      // After a couple of misses, start the daemon (at most every 30 s).
      if (assistant.failures >= 2 && Date.now() - assistant.lastStart > 30000) {
        assistant.lastStart = Date.now()
        Quickshell.execDetached(["sh", "-c",
          "systemctl --user start omarchy-island-daemon.service 2>/dev/null && exit 0; " +
          "d=\"$HOME/.local/bin/island-agent-daemon\"; [ -x \"$d\" ] && setsid \"$d\" >/dev/null 2>&1 &"])
      }
      sock.connected = true
      assistant.failures++
    }
  }

  onWantedChanged: if (!wanted) sock.connected = false

  function call(method, params, callback) {
    if (!sock.connected) { if (callback) callback(null, "not connected"); return }
    var id = nextId++
    if (callback) pending[id] = callback
    sock.write(JSON.stringify({ jsonrpc: "2.0", id: id, method: method, params: params || {} }) + "\n")
    sock.flush()
  }

  function take(line) {
    var msg
    try { msg = JSON.parse(line) } catch (e) { return }
    if (msg.id !== undefined && msg.id !== null) {
      var cb = pending[msg.id]
      delete pending[msg.id]
      if (cb) cb(msg.error ? null : msg.result, msg.error ? msg.error.message : "")
      return
    }
    if (msg.method === "state") applyState(msg.params)
    else if (msg.method === "chat") chat = msg.params
  }

  function applyState(s) {
    if (!s) return
    agents = s.agents || []
    approvals = s.approvals || []
    accounts = s.accounts || []
    herdrAvailable = !!(s.herdr && s.herdr.available)
    herdrAgents = s.herdr ? (s.herdr.agents || []) : []
    totals = s.totals || ({ added: 0, removed: 0 })
    secretary = s.secretary || ({ path: "", present: false })
  }

  // ---- actions
  function decide(id, decision, done) {
    call("approval.decide", { id: id || "", decision: decision }, function(r, err) {
      if (err && island) island.showHud({ key: "approval", layout: "label", label: err, icon: "󰀦", valueText: "", color: island.orangeColor, duration: 2400 })
      if (done) done(!!r)
    })
  }

  function focusApproval(id) { call("approval.focus", { id: id || "" }) }
  function diffs(session, callback) { call("diffs.get", { session: session }, function(r) { callback(r ? r.diffs : []) }) }
  function markSeen(session) { if (session) call("session.seen", { id: session }) }
  function clearDiffs(session) { call("session.clearDiffs", { id: session }) }
  function setActive(id) { call("accounts.setActive", { id: id }) }
  function refreshAccounts() { call("accounts.refresh", {}) }

  function spawn(id) {
    call("accounts.spawn", { id: id }, function(r, err) {
      if (!island) return
      island.showHud({ key: "spawn", layout: "label", label: r ? "Opened in herdr" : (err || "Could not open"), icon: r ? "󰆍" : "󰀦",
                       valueText: "", color: r ? island.greenColor : island.orangeColor, duration: 2200 })
    })
  }

  function chatConfigure(opts) { call("chat.configure", opts) }
  function chatStop() { call("chat.stop", {}) }
  function chatReset() { call("chat.reset", {}) }

  function chatSend(text, files, done) {
    call("chat.send", { text: text, files: files || [] }, function(r, err) { if (done) done(!!r, err) })
  }

  function capture(done) {
    call("chat.capture", {}, function(r, err) { done(r ? r.path : "", err) })
  }
}
