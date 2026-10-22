import QtQuick
import Quickshell
import Quickshell.Io
import "../IslandModel.js" as Model

// Next meeting from iCalendar feeds. Any calendar that can publish an .ics
// link works (Google "secret address in iCal format", iCloud public
// calendar, Outlook "publish calendar", Nextcloud, Fastmail) as can local
// .ics files. Configured with "calendars": [...] in the island's settings.
// An entry can carry a label and colour in front of the link, the way
// NextEvent writes them: "Work|#4285f4|https://…" (see Model.parseFeed).
// "calendarExclude" hides events whose title contains any of its
// comma-separated keywords, and "calendarRefreshMinutes" sets how often the
// feeds are re-read.
Item {
  id: calendar

  property var island: null
  // Links written by hand into shell.json's "calendars" setting...
  readonly property var configured: {
    var v = island ? island.setting("calendars", []) : []
    return Array.isArray(v) ? v.map(function(x) { return String(x) }) : (v ? [String(v)] : [])
  }
  // ...plus links added from the calendar view, which live in the island's
  // own file. Writing shell.json makes the shell rebuild the whole island
  // (closing the view mid-add), so the view never writes there.
  property var added: []
  // ---- holidays: the country's public holiday calendar, on by default.
  // "auto" follows the system timezone; the calendar view can pick another
  // country or turn it off (kept in the island's own prefs file).
  property string detectedCountry: ""
  property string holidayChoice: "auto"
  readonly property string holidayCountry: {
    var c = holidayChoice === "auto" ? String(island ? island.setting("holidays", "auto") : "auto") : holidayChoice
    if (c === "auto") c = detectedCountry
    return c === "off" ? "" : String(c || "").toUpperCase()
  }
  readonly property string holidayLink: Model.holidayUrl(holidayCountry)
  readonly property string holidayName: { var h = Model.holidayCalendar(holidayCountry); return h ? h.name : "" }

  function setHolidays(code) {
    holidayChoice = String(code || "auto")
    savePrefs()
  }

  // ---- settings made in the settings screen, kept in the island's prefs
  // file next to the holiday choice: extra exclude keywords, and the
  // browser profile each feed's meetings open in ({ feedUrl: choice id }).
  property string excludeText: ""
  property var picks: ({})

  function savePrefs() {
    prefsFile.setText(JSON.stringify({ holidays: holidayChoice, exclude: excludeText, profiles: picks }, null, 2) + "\n")
  }

  function setExclude(text) {
    excludeText = String(text || "").trim()
    savePrefs()
  }

  function setPick(url, id) {
    var next = {}
    for (var k in picks) if (k !== url) next[k] = picks[k]
    if (id) next[url] = id
    picks = next
    savePrefs()
  }

  // Change a feed's label or colour: rewrite its entry where it lives.
  function setFeed(entry, label, color) {
    var f = Model.parseFeed(entry)
    var next = Model.feedEntry(f.url, label, color)
    if (next === entry) return
    if (added.indexOf(entry) !== -1) {
      added = added.map(function(x) { return x === entry ? next : x })
      addedFile.setText(JSON.stringify(added, null, 2) + "\n")
    } else if (configured.indexOf(entry) !== -1 && island) {
      // Hand-written in shell.json: edit it there (the island reloads).
      island.saveSettings({ calendars: configured.map(function(x) { return x === entry ? next : x }) })
    }
  }

  // ---- browser profiles on this machine, offered per feed. Each browser's
  // "Local State" is printed after a "@@BROWSER <id>" line.
  property var profiles: []
  Process {
    id: profileScan
    running: true
    command: ["bash", "-c", 'for b in "$@"; do IFS="|" read -r id bin dir <<< "$b"; ' +
      'f="$HOME/$dir/Local State"; command -v "$bin" >/dev/null && [ -f "$f" ] && { echo "@@BROWSER $id"; head -c 4194304 "$f"; echo; }; done', "bash"]
      .concat(Model.browsers.map(function(b) { return b.id + "|" + b.bin + "|" + b.dir }))
    stdout: StdioCollector {
      onStreamFinished: {
        var out = []
        var parts = String(text || "").split(/^@@BROWSER (\S+)\n/m)
        for (var i = 1; i + 1 < parts.length; i += 2) {
          var b = Model.browsers.filter(function(x) { return x.id === parts[i] })[0]
          if (b) out = out.concat(Model.browserProfiles(b, parts[i + 1]))
        }
        calendar.profiles = out
      }
    }
  }
  function rescanProfiles() { if (!profileScan.running) profileScan.running = true }

  // Everything a feed's meetings can open with: the browser profiles found,
  // then the named launchers from the "launchers" setting.
  readonly property var launchChoices: {
    var named = Model.jsonSetting(island ? island.setting("launchers", "") : "", {})
    var out = profiles.slice()
    for (var n in named) out.push({ id: "launcher:" + n, name: n, detail: String(named[n]), command: String(named[n]) })
    return out
  }
  function choice(id) {
    for (var i = 0; i < launchChoices.length; i++) if (launchChoices[i].id === id) return launchChoices[i]
    return null
  }
  function pickFor(url) { return choice(picks[url] || "") }

  // Open an event's link with the profile/launcher that applies to it.
  function open(ev) {
    if (!ev || !ev.url) return
    var cmds = {}
    for (var u in picks) { var c = choice(picks[u]); if (c) cmds[u] = c.command }
    var cmd = Model.launchCommand(ev, {
      launchers: island.setting("launchers", ""), calendarLaunchers: island.setting("calendarLaunchers", ""),
      launcherRules: island.setting("launcherRules", ""), browserCommand: island.setting("browserCommand", ""),
      picks: cmds })
    if (cmd) Quickshell.execDetached(["bash", "-lc", cmd + " " + Model.shellQuote(ev.url)])
    else Quickshell.execDetached(["xdg-open", String(ev.url)])
  }

  // Timezone -> ISO country (Asia/Kolkata -> IN) via tzdata's zone.tab.
  Process {
    running: true
    command: ["sh", "-c", "tz=$(timedatectl show -p Timezone --value 2>/dev/null || readlink /etc/localtime | sed 's#.*zoneinfo/##'); " +
                          "awk -v tz=\"$tz\" '$3==tz{print $1; exit}' /usr/share/zoneinfo/zone.tab 2>/dev/null"]
    stdout: StdioCollector { onStreamFinished: calendar.detectedCountry = String(text || "").trim() }
  }

  FileView {
    id: prefsFile
    path: calendar.addedDir + "/prefs.json"
    printErrors: false
    atomicWrites: true
    onLoaded: {
      try {
        var p = JSON.parse(text() || "{}")
        if (p.holidays) calendar.holidayChoice = String(p.holidays)
        calendar.excludeText = String(p.exclude || "")
        if (p.profiles && typeof p.profiles === "object") calendar.picks = p.profiles
      } catch (e) {}
    }
  }

  readonly property var sources: {
    var out = []
    var all = configured.concat(added).concat(holidayLink ? [holidayLink] : [])
    for (var i = 0; i < all.length; i++)
      if (all[i] && out.indexOf(all[i]) === -1) out.push(all[i])
    return out
  }

  // Each source as { entry, url, label, color, owner }; the holiday feed is
  // labelled with its country.
  readonly property var feeds: sources.map(function(entry, i) {
    var f = Model.parseFeed(entry, i)
    if (entry === holidayLink) { f.label = holidayName; f.color = "" }
    return f
  })
  // Keywords from shell.json's "calendarExclude" plus the settings screen's.
  readonly property var exclude: Model.keywords(island ? island.setting("calendarExclude", "") : "")
    .concat(Model.keywords(excludeText))
  // What every parse is told: the feeds in the order they were fetched.
  readonly property var parseOpts: {
    var byEntry = {}
    feeds.forEach(function(f) { byEntry[f.entry] = f })
    return { feeds: fetchedSources.map(function(e, i) { return byEntry[e] || Model.parseFeed(e, i) }), exclude: exclude }
  }

  readonly property string addedDir: Quickshell.env("HOME") + "/.config/omarchy/dynamic-island"
  readonly property string addedPath: addedDir + "/calendars.json"

  function add(link) {
    var l = String(link || "").trim()
    if (!l) return
    justAdded = l
    lastResult = null
    var next = added.filter(function(x) { return x !== l })
    next.push(l)
    added = next
    addedFile.setText(JSON.stringify(next, null, 2) + "\n")
  }

  function remove(link) {
    var l = String(link || "")
    if (l === holidayLink) { setHolidays("off"); return }
    if (added.indexOf(l) !== -1) {
      added = added.filter(function(x) { return x !== l })
      addedFile.setText(JSON.stringify(added, null, 2) + "\n")
    }
    // A hand-written one: take it out of shell.json too (this reloads the
    // island, which is fine for a removal).
    if (configured.indexOf(l) !== -1 && island) island.editCalendars("remove", l)
  }

  Process {
    running: true
    command: ["mkdir", "-p", calendar.addedDir]
    onExited: { addedFile.reload(); prefsFile.reload() }
  }

  FileView {
    id: addedFile
    path: calendar.addedPath
    printErrors: false
    atomicWrites: true
    watchChanges: true
    onFileChanged: reload()
    onLoaded: {
      try {
        var list = JSON.parse(text() || "[]")
        if (Array.isArray(list)) calendar.added = list.map(function(x) { return String(x) })
      } catch (e) {}
    }
  }
  readonly property int leadMinutes: island ? Math.max(1, Number(island.setting("calendarLeadMinutes", 15)) || 15) : 15

  property var events: []
  property double now: Date.now()
  // The fetched feeds, kept so the month view can read any month on demand.
  property string raw: ""
  property int version: 0

  // Every event (all-day ones too) in one month, grouped by day, for the
  // calendar view. Recomputed when the feeds are re-read.
  function month(year, monthIndex) {
    version
    var from = new Date(year, monthIndex, 1).getTime() - 7 * 86400000
    var to = new Date(year, monthIndex + 1, 1).getTime() + 14 * 86400000
    return Model.eventsByDay(Model.parseIcs(raw, from, to, true, parseOpts))
  }

  // The next event that has not ended yet.
  readonly property var next: {
    for (var i = 0; i < events.length; i++)
      if (events[i].end > now) return events[i]
    return null
  }
  // Today's all-day events (festivals, holidays, birthdays) for the idle
  // view's date line.
  readonly property var todayAllDay: {
    version
    var d = new Date(now)
    var from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    var list = raw ? Model.parseIcs(raw, from, from + 86400000 - 1, true, parseOpts) : []
    return list.filter(function(e) { return e.allDay }).map(function(e) { return e.title })
  }

  // Live activity from `leadMinutes` before until 5 minutes after it starts.
  readonly property bool soon: next !== null && next.start - now <= leadMinutes * 60000
    && now - next.start < 5 * 60000
  // Within two hours: enough to take the bubble from the agents (Island.qml).
  readonly property bool upcoming: next !== null && next.start - now <= 2 * 3600000
    && now - next.start < 5 * 60000
  readonly property bool started: next !== null && next.start <= now
  readonly property string countdown: next ? Model.untilText(next.start, now) : ""

  property string announced: ""

  Timer {
    interval: 20000
    repeat: true
    running: calendar.events.length > 0
    triggeredOnStart: true
    onTriggered: {
      calendar.now = Date.now()
      var ev = calendar.next
      // One heads-up as it starts.
      if (ev && ev.start <= calendar.now && calendar.now - ev.start < 60000) {
        var key = ev.title + "@" + ev.start
        if (calendar.announced !== key && calendar.island) {
          calendar.announced = key
          calendar.island.toast({ title: ev.title || "Event", body: "Starting now", icon: "󰃭", color: "accent", duration: 8000 })
        }
      }
    }
  }

  // Fetch every source (URLs with curl, local files; ~ expands) and parse
  // the next week.
  // Each source is announced with a status line before its contents
  // ("@@ISLAND-SOURCE <index> ok", or "HTTP 404", "unreachable", "file not
  // found", "too large", "not a calendar"), so a bad link can be reported
  // instead of silently showing nothing.
  // Everything read is capped, since the shell holds it in memory: 4 MiB a
  // source (a busy calendar is a few hundred KiB), local paths must be
  // regular files, and the whole output stops at 16 MiB.
  // A feed over 4 MiB (years of history) is downloaded up to 64 MiB and
  // trimmed by windowAwk to this month and the next, so it still shows.
  // (Passed as an argument: the plugin loader doesn't give a usable file
  // path for a sibling file.) Everything outside VEVENT (header, VTIMEZONE)
  // is kept, and so is every recurring event still running in the window,
  // since its first DTSTART can be years back.
  readonly property string windowAwk: [
    'function day(l) { sub(/\\r$/, "", l); sub(/^[^:]*:/, "", l); return substr(l, 1, 8) }',
    '/^BEGIN:VEVENT/ { inev = 1; buf = $0 "\\n"; start = ""; end = ""; rid = ""; rrule = 0; until = ""; next }',
    'inev {',
    '  buf = buf $0 "\\n"',
    '  if ($0 ~ /^DTSTART[;:]/) start = day($0)',
    '  else if ($0 ~ /^DTEND[;:]/) end = day($0)',
    '  else if ($0 ~ /^RECURRENCE-ID[;:]/) rid = day($0)',
    '  else if ($0 ~ /^RRULE:/) { rrule = 1; if (match($0, /UNTIL=[0-9]+/)) until = substr($0, RSTART + 6, 8) }',
    '  if ($0 ~ /^END:VEVENT/) {',
    '    inev = 0; if (end == "") end = start; keep = 0',
    '    if (rrule) keep = (until == "" || until >= from) && start <= to',
    '    else if (start != "" && start <= to && end >= from) keep = 1',
    '    else if (rid != "" && rid >= from && rid <= to) keep = 1',
    '    if (keep) printf "%s", buf',
    '  }',
    '  next',
    '}',
    '{ print }'
  ].join("\n")
  readonly property string fetchScript:
    'awkp="$1"; shift; max=4194304; big=67108864; ' +
    'm0=$(date +%Y-%m-01); wf=$(date -d "$m0 -7 days" +%Y%m%d); wt=$(date -d "$m0 +2 months +14 days" +%Y%m%d); ' +
    'trim() { if [ "$(wc -c < "$1")" -gt "$max" ]; then awk -v from="$wf" -v to="$wt" "$awkp" "$1" > "$1.w" && mv "$1.w" "$1"; fi; }; ' +
    '{ i=0; for u in "$@"; do s="${u/#\\~/$HOME}"; t=$(mktemp); h=$(mktemp); st=ok; ' +
    'case "$s" in webcal://*) s="https://${s#webcal://}" ;; esac; ' +
    'case "$s" in ' +
    'http://*|https://*) curl -sL --max-time 60 --max-filesize "$big" -D "$h" -o - "$s" 2>/dev/null ' +
    '    | head -c $((big + 1)) > "$t"; rc=${PIPESTATUS[0]}; ' +
    '  code=$(awk \'/^HTTP\\//{c=$2} END{print c+0}\' "$h"); ' +
    '  if [ "$rc" = 63 ] || [ "$(wc -c < "$t")" -gt "$big" ]; then st="too large"; ' +
    '  elif [ "$code" = 0 ]; then st=unreachable; elif [ "$code" != 200 ]; then st="HTTP $code"; fi ;; ' +
    '*) if [ ! -f "$s" ]; then st="file not found"; ' +
    '  elif [ "$(wc -c < "$s")" -gt "$big" ]; then st="too large"; ' +
    '  else head -c "$big" "$s" > "$t"; fi ;; ' +
    'esac; ' +
    '[ "$st" = ok ] && trim "$t" && [ "$(wc -c < "$t")" -gt "$max" ] && st="too large"; ' +
    '[ "$st" = ok ] && ! grep -q "BEGIN:VCALENDAR" "$t" && st="not a calendar"; ' +
    'echo "@@ISLAND-SOURCE $i $st"; [ "$st" = ok ] && cat "$t"; echo; rm -f "$t" "$h"; i=$((i+1)); done; } ' +
    '| head -c 16777216'

  // source link -> "ok" or what went wrong, from the last fetch.
  property var status: ({})
  // A link just added from the calendar view: report how it went.
  property string justAdded: ""

  // The outcome of the last add, shown inside the calendar view (the HUD
  // is hidden while the view is open): { ok: bool, text: string }.
  property var lastResult: null
  Timer { id: resultTimer; interval: 7000; onTriggered: calendar.lastResult = null }

  function statusOf(link) { return status[String(link)] || "" }

  Process {
    id: fetch
    stdout: StdioCollector {
      onStreamFinished: {
        var from = Date.now() - 3600000
        var map = {}
        var lines = String(text || "").split("\n")
        for (var i = 0; i < lines.length; i++) {
          var m = /^@@ISLAND-SOURCE (\d+) (.*)$/.exec(lines[i].replace(/\r$/, ""))
          if (m && calendar.fetchedSources[+m[1]] !== undefined) map[calendar.fetchedSources[+m[1]]] = m[2]
        }
        calendar.status = map
        calendar.raw = text
        calendar.events = Model.parseIcs(text, from, from + 8 * 86400000, false, calendar.parseOpts)
        cacheFile.setText(JSON.stringify({ sources: calendar.fetchedSources, raw: text }))
        calendar.now = Date.now()
        calendar.version++
        calendar.reportAdded()
        if (calendar.refetch) {
          calendar.refetch = false
          Qt.callLater(calendar.refresh)
        }
      }
    }
  }

  function refresh() {
    if (sources.length === 0) { events = []; raw = ""; version++; return }
    // A fetch already in flight has the old list: fetch again when it ends.
    if (fetch.running) { refetch = true; return }
    // Set here rather than bound: a binding can lag the sources change that
    // triggered this refresh and fetch the old list.
    fetchedSources = sources.slice()
    fetch.command = ["bash", "-c", fetchScript, "bash", windowAwk]
      .concat(fetchedSources.map(function(e) { return Model.parseFeed(e).url }))
    fetch.running = true
  }

  property var fetchedSources: []
  property bool refetch: false

  function reportAdded() {
    var link = justAdded
    if (!link || !island) return
    var st = statusOf(link)
    if (!st) return
    justAdded = ""
    if (st === "ok") {
      var count = Model.parseIcs(raw, Date.now() - 30 * 86400000, Date.now() + 60 * 86400000, true, parseOpts).length
      lastResult = { ok: true, text: "󰄬  Calendar added · " + count + (count === 1 ? " event" : " events") + " around now" }
      resultTimer.restart()
      island.showHud({ key: "calendar", layout: "label", label: "Calendar added", icon: "󰃭",
                       valueText: count + (count === 1 ? " event" : " events"), color: island.greenColor, duration: 2600 })
    } else {
      // Google's "public address" 404s unless the calendar is public; the
      // secret address is what people almost always want.
      var google = link.indexOf("calendar.google.com") !== -1 && link.indexOf("/public/") !== -1 && st === "HTTP 404"
      lastResult = { ok: false, text: google
        ? "󰀦  Google refused the public address (404). Use \"Secret address in iCal format\"."
        : "󰀦  That link didn't work: " + st }
      resultTimer.restart()
      island.showHud({ key: "calendar", layout: "label",
                       label: google ? "Use Google's secret iCal address" : "Calendar link didn't work",
                       icon: "󰃮", valueText: google ? "404" : st, color: island.urgentColor, duration: 5000 })
    }
  }

  // Deferred: sources is often first read lazily from inside another
  // binding (the month view's), and writing raw/version there is a loop.
  onSourcesChanged: Qt.callLater(function() { calendar.useCache(); calendar.refresh() })

  Timer {
    interval: Math.max(1, Number(calendar.island ? calendar.island.setting("calendarRefreshMinutes", 15) : 15) || 15) * 60000
    repeat: true
    running: calendar.sources.length > 0
    onTriggered: calendar.refresh()
  }

  // The last fetch, so events are there at once when the shell starts while
  // the feeds are re-read. Holds event details, never the feed links.
  FileView {
    id: cacheFile
    path: Quickshell.env("HOME") + "/.cache/omarchy-dynamic-island/calendar.json"
    printErrors: false
    atomicWrites: true
    onLoaded: {
      try { calendar.cached = JSON.parse(text() || "{}") } catch (e) {}
      calendar.useCache()
    }
  }
  property var cached: null

  // Show the cached fetch until the first real one lands, but only when it
  // came from the same feeds in the same order (the added list loads after
  // the cache, so this is tried again as the sources settle).
  function useCache() {
    var c = cached
    if (raw || !c || !c.raw || !Array.isArray(c.sources)) return
    if (JSON.stringify(c.sources) !== JSON.stringify(sources)) return
    cached = null
    if (!fetch.running) fetchedSources = c.sources
    raw = c.raw
    var from = Date.now() - 3600000
    events = Model.parseIcs(c.raw, from, from + 8 * 86400000, false, { feeds: c.sources.map(Model.parseFeed), exclude: exclude })
    now = Date.now()
    version++
  }
  Process {
    running: true
    command: ["mkdir", "-p", Quickshell.env("HOME") + "/.cache/omarchy-dynamic-island"]
  }

  // Demo: a meeting in eight minutes.
  function demo() {
    var start = Date.now() + 8 * 60000
    events = [{ title: "Design review", start: start, end: start + 30 * 60000, allDay: false, url: "" }]
    // A little month to look at in the calendar view.
    function stamp(t) {
      var d = new Date(t)
      function p(n) { return n < 10 ? "0" + n : "" + n }
      return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "T" + p(d.getHours()) + p(d.getMinutes()) + "00"
    }
    var today = new Date()
    var d0 = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    function at(days, h, m) { return d0.getTime() + days * 86400000 + (h * 60 + m) * 60000 }
    raw = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT", "SUMMARY:Design review", "DTSTART:" + stamp(start), "DTEND:" + stamp(start + 1800000),
      "LOCATION:https://meet.google.com/abc-defg-hij", "END:VEVENT",
      "BEGIN:VEVENT", "SUMMARY:Standup", "DTSTART:" + stamp(at(-20, 10, 0)), "DTEND:" + stamp(at(-20, 10, 15)),
      "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "END:VEVENT",
      "BEGIN:VEVENT", "SUMMARY:Lunch with Priya", "DTSTART:" + stamp(at(1, 13, 0)), "DTEND:" + stamp(at(1, 14, 0)), "END:VEVENT",
      "BEGIN:VEVENT", "SUMMARY:Omarchy release", "DTSTART;VALUE=DATE:" + stamp(at(4, 0, 0)).substring(0, 8), "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n") + "\r\n" + raw   // keep real feeds (holidays) alongside
    now = Date.now()
    version++
  }
}
