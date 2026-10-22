.pragma library

// Pure helpers for the island. No QML types in here so the logic can be read
// (and reasoned about) without the scene around it.

// Base geometry for each view, in unscaled pixels. The island springs between
// these; `r` is the corner radius, which for the compact views is half the
// height so the shape stays a true capsule.
var sizes = {
  "idle":          { w: 126, h: 32, r: 16 },
  "idle-hover":    { w: 138, h: 34, r: 17 },
  "hidden":        { w: 0,   h: 32, r: 16 },
  "media":         { w: 300, h: 32, r: 16 },
  "recording":     { w: 232, h: 32, r: 16 },
  "mic":           { w: 214, h: 32, r: 16 },
  "hud-progress":  { w: 310, h: 36, r: 18 },
  "hud-label":     { w: 310, h: 36, r: 18 },
  "hud-track":     { w: 368, h: 66, r: 28 },
  "hud-toast":     { w: 368, h: 66, r: 28 },
  "media-expanded": { w: 404, h: 186, r: 42 },
  "recording-expanded": { w: 392, h: 76, r: 34 },
  "recording-media-expanded": { w: 404, h: 145, r: 40 },
  "idle-expanded": { w: 424, h: 150, r: 40 },
  "notification":  { w: 404, h: 78, r: 34 },
  "inbox":         { w: 200, h: 32, r: 16 },
  "timer":         { w: 236, h: 32, r: 16 },
  "stopwatch":     { w: 236, h: 32, r: 16 },
  "activity":      { w: 256, h: 32, r: 16 },
  "calendar":      { w: 300, h: 32, r: 16 },
  "agents":        { w: 320, h: 32, r: 16 },
  "clock-expanded": { w: 380, h: 132, r: 40 },
  "activity-expanded": { w: 392, h: 104, r: 38 },
  "calendar-expanded": { w: 500, h: 262, r: 40 },
  "notification-actions": { w: 404, h: 118, r: 38 },
  "approval":      { w: 540, h: 164, r: 40 },
  "workspace-expanded": { w: 720, h: 400, r: 44 }
}

// Compact activities in priority order. The first one present owns the pill;
// the second one, if any, gets the detached bubble on the right. Agents rank
// last and never own the pill: their toasts are the news, so they ride in the
// bubble beside whatever the pill shows, the resting ticker included.
var activityOrder = ["recording", "timer", "activity", "media", "stopwatch", "calendar", "mic", "inbox", "agents"]
var bubbleOnly = ["agents"]

function activities(flags) {
  var out = []
  for (var i = 0; i < activityOrder.length; i++)
    if (flags[activityOrder[i]]) out.push(activityOrder[i])
  return out
}

// -> { primary, secondary }: the pill's activity ("" for the resting pill)
// and the bubble's.
function slots(list) {
  var primary = list.length > 0 && bubbleOnly.indexOf(list[0]) === -1 ? list[0] : ""
  var rest = primary ? list.slice(1) : list
  return { primary: primary, secondary: rest.length > 0 ? rest[0] : "" }
}

// Which view the island shows. Transient HUDs win over everything except an
// island the user deliberately opened, since a volume tick while reading the
// expanded player should not throw the player away.
function viewFor(state) {
  // A coding agent waiting on a yes/no (or a question) opens the island by
  // itself, over anything but the workspace, which shows it in its own tab.
  if (state.approval && !(state.userExpanded && state.workspaceOpen)) return "approval"
  if (state.userExpanded && state.workspaceOpen) return "workspace-expanded"
  if (state.userExpanded && state.inboxOpen) return "inbox-expanded"
  if (state.userExpanded && state.outputsOpen) return "outputs-expanded"
  if (state.userExpanded && state.calendarOpen) return "calendar-expanded"
  if (state.userExpanded) {
    // Recording takes the top of an opened island so it can be stopped from
    // there; music, if any, rides along underneath.
    if (state.recording) return state.hasMedia ? "recording-media-expanded" : "recording-expanded"
    // Otherwise open whatever was clicked: the pill's activity, or the
    // bubble's when the bubble was the thing clicked.
    var focus = state.focus || state.primary
    if (focus === "timer" || focus === "stopwatch") return "clock-expanded"
    if (focus === "activity") return "activity-expanded"
    if (focus === "calendar") return "calendar-expanded"
    if (focus === "agents") return "agents-expanded"
    if (focus === "media" && state.hasMedia) return "media-expanded"
    return state.hasMedia && focus !== "calendar" ? "media-expanded" : "idle-expanded"
  }
  if (state.hud && state.hud.layout === "progress") return "hud-progress"
  if (state.notification) return state.notificationActions ? "notification-actions" : "notification"
  if (state.hud) return state.hud.layout === "progress" ? "hud-progress"
    : (state.hud.layout === "track" ? "hud-track"
      : (state.hud.layout === "toast" ? "hud-toast" : "hud-label"))
  if (state.primary) return state.primary
  if (state.idleHidden) return "hidden"
  return state.hovered ? "idle-hover" : "idle"
}

// The opened inbox grows with its contents, up to four rows (then scrolls).
var inboxRowHeight = 58
var inboxRowGap = 6

function inboxSize(count) {
  if (count <= 0) return { w: 420, h: 72, r: 32 }
  var rows = Math.min(4, count)
  return { w: 420, h: 14 + rows * inboxRowHeight + (rows - 1) * inboxRowGap + 10 + 30 + 14, r: 36 }
}

// Output picker: a header plus one row per audio output.
function outputsSize(count) {
  var rows = Math.max(1, Math.min(6, count))
  return { w: 392, h: 16 + 22 + 8 + rows * 40 + (rows - 1) * 4 + 16, r: 36 }
}

// Herdr agents: a header plus one row per live agent (five, then it scrolls).
var agentRowHeight = 46
var agentRowGap = 4

function agentsSize(count) {
  var rows = Math.max(1, Math.min(5, count))
  return { w: 440, h: 16 + 22 + 8 + rows * agentRowHeight + (rows - 1) * agentRowGap + 16, r: 36 }
}

// Calendar settings: header, link field, one row per calendar (up to five,
// then it scrolls), the exclude field and the holidays row.
function calendarSettingsSize(feeds) {
  var rows = Math.max(1, Math.min(5, feeds))
  return { w: 580, h: 18 + 26 + 8 + 30 + 10 + rows * 36 + (rows - 1) * 4 + 10 + 30 + 6 + 26 + 18, r: 36 }
}

// The tallest any view gets (lists at their longest), so the window that
// holds the island never crops one.
function tallestView() {
  var h = Math.max(inboxSize(4).h, outputsSize(6).h, agentsSize(5).h, calendarSettingsSize(5).h)
  for (var k in sizes) h = Math.max(h, sizes[k].h)
  return h
}

// Views that sit on the notch itself; with a measured notch they grow to
// clear the camera cutout with room for content on both sides.
var compactViews = ["idle", "idle-hover", "media", "recording", "mic", "inbox", "timer",
                    "stopwatch", "activity", "calendar", "agents"]

// The approval card: a header, what the tool wants to do, and the buttons; a
// question instead lists its options (four, then it scrolls).
function approvalSize(approval) {
  if (!approval) return sizes["approval"]
  var q = approval.questions && approval.questions.length > 0 ? approval.questions[0] : null
  if (!q) return sizes["approval"]
  var rows = Math.max(1, Math.min(4, q.options.length))
  return { w: 540, h: 18 + 22 + 6 + 36 + rows * 34 + (rows - 1) * 4 + (q.multiSelect ? 38 : 0) + 20, r: 40 }
}

function sizeFor(view, counts, notch) {
  var base
  if (view === "approval") base = approvalSize(counts && counts.approval)
  else if (view === "inbox-expanded") base = inboxSize(counts && counts.inbox || 0)
  else if (view === "outputs-expanded") base = outputsSize(counts && counts.outputs || 0)
  else if (view === "agents-expanded") base = agentsSize(counts && counts.agents || 0)
  else if (view === "calendar-expanded" && counts && counts.calendarSettings) base = calendarSettingsSize(counts.calendarSettings - 1)
  else base = sizes[view] || sizes["idle"]
  if (!notch || !(notch.w > 0) || compactViews.indexOf(view) === -1) return base
  var h = Math.max(base.h, notch.h > 0 ? notch.h : base.h)
  if (view === "idle" || view === "idle-hover") {
    var r = notch.r > 0 ? notch.r : h / 2
    return { w: notch.w + (view === "idle-hover" ? 12 : 0), h: h, r: Math.min(r, h / 2) }
  }
  // 60px of content either side of the cutout.
  return { w: Math.max(base.w, notch.w + 120), h: h, r: h / 2 }
}

// "25", "25m", "90s", "1h30m", "1:30" (m:s) or "1:30:00" (h:m:s) -> seconds.
function parseDuration(text) {
  var t = String(text || "").trim().toLowerCase()
  if (!t) return 0
  if (/^\d+$/.test(t)) return parseInt(t, 10) * 60
  if (/^\d+(:\d{1,2}){1,2}$/.test(t)) {
    var parts = t.split(":").map(function(p) { return parseInt(p, 10) })
    return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2]
  }
  var total = 0
  var matched = false
  var re = /(\d+(?:\.\d+)?)\s*(h|hr|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)/g
  var m
  while ((m = re.exec(t)) !== null) {
    matched = true
    var n = parseFloat(m[1])
    var u = m[2].charAt(0)
    total += u === "h" ? n * 3600 : (u === "m" ? n * 60 : n)
  }
  return matched ? Math.round(total) : 0
}

// 272.4s -> "4:32"; with tenths -> "4:32.4". Hours when needed.
function formatClock(seconds, tenths) {
  var s = Math.max(0, Number(seconds) || 0)
  var whole = Math.floor(s)
  var text = formatTime(whole)
  if (tenths) text += "." + Math.floor((s - whole) * 10)
  return text
}

// Bluetooth device icon names (freedesktop) -> Nerd Font glyph.
function deviceGlyph(icon) {
  var i = String(icon || "").toLowerCase()
  if (i.indexOf("headset") !== -1 || i.indexOf("headphone") !== -1) return "󰋋"
  if (i.indexOf("speaker") !== -1 || i.indexOf("audio") !== -1) return "󰓃"
  if (i.indexOf("keyboard") !== -1) return "󰌌"
  if (i.indexOf("mouse") !== -1 || i.indexOf("tablet") !== -1) return "󰍽"
  if (i.indexOf("gaming") !== -1 || i.indexOf("joystick") !== -1) return "󰊴"
  if (i.indexOf("phone") !== -1) return "󰄜"
  if (i.indexOf("watch") !== -1) return "󰖉"
  if (i.indexOf("computer") !== -1) return "󰌢"
  return "󰂱"
}

// ---------------------------------------------------------------- calendar
// A small iCalendar reader: enough for "what is my next meeting". Handles
// folded lines, UTC / floating / TZID times, all-day events, DAILY/WEEKLY
// recurrence with INTERVAL, BYDAY, COUNT, UNTIL and EXDATE, and moved or
// cancelled single instances (RECURRENCE-ID). Other recurrences show their
// first occurrence.
//
// TZID times are converted with the feed's own VTIMEZONE blocks (servers
// always send them, and Outlook's Windows names like "Central Standard
// Time" can only be read that way). Times are kept as "wall" milliseconds
// (the clock reading, as if it were UTC) until they are turned into real
// instants, so a weekly meeting stays at 10:00 in its own zone across DST.

// "20261020T100000Z" -> { wall, utc, allDay }
function icsWall(value) {
  var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(String(value || "").trim())
  if (!m) return null
  return { wall: Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)),
           utc: !!m[7], allDay: m[4] === undefined }
}

// Kept for callers that want a plain local reading.
function icsDate(value) {
  var w = icsWall(value)
  return w ? { time: toInstant(w.wall, w.utc, w.allDay, "", {}), allDay: w.allDay } : null
}

function icsUnescape(v) {
  return String(v || "").replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim()
}

// "DTSTART;TZID="Central Standard Time":..." -> Central Standard Time
function lineTzid(head) {
  var m = /;TZID=("?)([^;:"]*)\1/i.exec(head)
  return m ? m[2] : ""
}

var weekdayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]

function tzOffset(value) {
  var m = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(String(value || "").trim())
  if (!m) return null
  return (m[1] === "-" ? -1 : 1) * ((+m[2] * 60 + +m[3]) * 60 + +(m[4] || 0)) * 1000
}

// Every VTIMEZONE in the text: tzid -> { obs: [{ from, to, wall, rule }], years: {} }.
function parseZones(lines) {
  var zones = {}
  var tzid = "", list = null, ob = null
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]
    if (line === "BEGIN:VTIMEZONE") { tzid = ""; list = []; continue }
    if (!list) continue
    if (line === "END:VTIMEZONE") { if (tzid && list.length) zones[tzid] = { obs: list, years: {} }; list = null; continue }
    if (line === "BEGIN:STANDARD" || line === "BEGIN:DAYLIGHT") { ob = { from: null, to: null, wall: null, rule: null }; continue }
    if (line === "END:STANDARD" || line === "END:DAYLIGHT") {
      if (ob && ob.to !== null && ob.wall !== null) { if (ob.from === null) ob.from = ob.to; list.push(ob) }
      ob = null
      continue
    }
    var colon = line.indexOf(":")
    if (colon < 0) continue
    var name = line.substring(0, colon).split(";")[0].toUpperCase()
    var value = line.substring(colon + 1).trim()
    if (!ob) { if (name === "TZID") tzid = value; continue }
    if (name === "TZOFFSETFROM") ob.from = tzOffset(value)
    else if (name === "TZOFFSETTO") ob.to = tzOffset(value)
    else if (name === "DTSTART") { var w = icsWall(value); if (w) ob.wall = w.wall }
    else if (name === "RRULE") {
      var r = { month: 0, weekday: -1, ord: 0, monthday: 0 }
      value.split(";").forEach(function(part) {
        var kv = part.split("="), k = String(kv[0]).toUpperCase(), v = String(kv[1] || "")
        if (k === "BYMONTH") r.month = parseInt(v, 10) || 0
        else if (k === "BYMONTHDAY") r.monthday = parseInt(v, 10) || 0
        else if (k === "BYDAY") {
          var d = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(v.split(",")[0])
          if (d) { r.ord = d[1] ? parseInt(d[1], 10) : 1; r.weekday = weekdayCodes.indexOf(d[2]) }
        }
      })
      if (r.month) ob.rule = r
    }
  }
  return zones
}

// Day of month of the ord-th (or, negative, last) weekday; 0 if none.
function nthWeekday(year, month, weekday, ord) {
  var days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (ord > 0) {
    var d = 1 + (weekday - new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 7) % 7 + (ord - 1) * 7
    return d <= days ? d : 0
  }
  var last = days - (new Date(Date.UTC(year, month - 1, days)).getUTCDay() - weekday + 7) % 7 + (ord + 1) * 7
  return last >= 1 ? last : 0
}

// The zone's UTC offset at a wall time, or null when it can't tell.
function zoneOffset(zone, wall) {
  var year = new Date(wall).getUTCFullYear()
  var tr = zone.years[year]
  if (!tr) {
    tr = []
    zone.obs.forEach(function(ob) {
      var w = new Date(ob.wall)
      if (!ob.rule) { tr.push({ at: ob.wall, from: ob.from, to: ob.to }); return }
      for (var y = year - 1; y <= year + 1; y++) {
        if (y < w.getUTCFullYear()) continue
        var r = ob.rule
        var d = r.monthday ? Math.min(r.monthday, new Date(Date.UTC(y, r.month, 0)).getUTCDate())
                           : nthWeekday(y, r.month, r.weekday, r.ord)
        if (d) tr.push({ at: Date.UTC(y, r.month - 1, d, w.getUTCHours(), w.getUTCMinutes(), w.getUTCSeconds()),
                         from: ob.from, to: ob.to })
      }
    })
    tr.sort(function(a, b) { return a.at - b.at })
    zone.years[year] = tr
  }
  if (!tr.length) return null
  var off = tr[0].from
  for (var i = 0; i < tr.length && wall >= tr[i].at; i++) off = tr[i].to
  return off
}

// Wall time -> real instant. Floating times, all-day dates and zones the
// feed doesn't define are read as local time.
function toInstant(wall, utc, allDay, tzid, zones) {
  if (utc) return wall
  var zone = !allDay && tzid ? zones[tzid] : null
  if (zone) { var off = zoneOffset(zone, wall); if (off !== null) return wall - off }
  var d = new Date(wall)
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
                  d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()).getTime()
}

function occurrence(ev, start, duration) {
  return { title: ev.title, uid: ev.uid, start: start, end: start + duration, allDay: ev.allDay, url: ev.url,
           provider: ev.provider, location: ev.location, source: ev.source, calendar: ev.calendar, color: ev.color,
           feedUrl: ev.feedUrl }
}

function firstLink(text) {
  var m = /https?:\/\/[^\s<>"'\\]+/.exec(String(text || ""))
  return m ? m[0] : ""
}

// Video meeting links, checked before any other link an event carries.
var videoProviders = [
  { label: "Meet", re: /https:\/\/meet\.google\.com\/[a-z0-9][a-z0-9-]*/ },
  { label: "Zoom", re: /https?:\/\/(?:[\w-]+\.)*(?:zoom\.us|zoomgov\.com)\/(?:j|w|s|my)\/[^\s"'<>\\]+/ },
  { label: "Teams", re: /https?:\/\/(?:teams\.microsoft\.com|teams\.live\.com|(?:[\w-]+\.)?teams\.microsoft\.us)\/(?:l\/meetup-join|l\/meeting|meet|dl\/launcher)\/[^\s"'<>\\]+/ },
  { label: "Webex", re: /https?:\/\/(?:[\w-]+\.)*webex\.com\/(?:meet\/|join\/|[^\s"'<>]*j\.php\?)[^\s"'<>\\]+/ },
  { label: "GoTo", re: /https?:\/\/(?:(?:meet\.goto\.com|(?:www\.)?gotomeet\.me)\/[^\s"'<>\\]+|(?:[\w-]+\.)*gotomeeting\.com\/join\/[^\s"'<>\\]+)/ }
]

// The link worth opening for an event: a video meeting link from its URL,
// conference data, location or description (in that order), else the
// first link of any kind. -> { url, provider }
function meetingLink(ev) {
  var texts = [ev.url, ev.conference, ev.location, ev.description]
  for (var p = 0; p < videoProviders.length; p++)
    for (var i = 0; i < texts.length; i++) {
      var m = videoProviders[p].re.exec(String(texts[i] || ""))
      if (m) return { url: m[0].replace(/[.,;:!?)\]]+$/, ""), provider: videoProviders[p].label }
    }
  return { url: ev.url || ev.conference || firstLink(ev.location) || firstLink(ev.description), provider: "" }
}

// ---- calendar feeds: an entry in "calendars" is a link, optionally with a
// label and colour in front, as NextEvent writes them:
// "Work|#4285f4|https://…", "Work|https://…", "#4285f4|https://…".
var feedPalette = ["#4285f4", "#34a853", "#fbbc04", "#ea4335", "#a142f4",
                   "#24c1e0", "#fa7b17", "#f439a0", "#5c6bc0", "#00897b"]

function parseFeed(entry, index) {
  var parts = String(entry || "").split("|")
  var url = parts.pop().trim()
  var label = "", color = ""
  parts.forEach(function(p) {
    p = p.trim()
    if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(p)) color = p
    else if (p) label = p
  })
  // Google's secret address names whose calendar it is, which is how a
  // declined invite is told apart from everyone else's answers.
  var owner = ""
  var g = /calendar\.google\.com\/calendar\/ical\/([^\/]+)\//.exec(url)
  if (g) { try { owner = decodeURIComponent(g[1]) } catch (e) {} }
  if (owner.indexOf("@") === -1 || /calendar\.google\.com$/.test(owner)) owner = ""
  return { entry: String(entry || ""), url: url, label: label,
           color: color || feedPalette[(index || 0) % feedPalette.length], owner: owner.toLowerCase() }
}

// Rebuild an entry after its label or colour is edited.
function feedEntry(url, label, color) {
  var parts = []
  if (label) parts.push(String(label).replace(/\|/g, " ").trim())
  if (color) parts.push(color)
  parts.push(url)
  return parts.join("|")
}

// ---- opening links: which command opens a meeting. Settings (the same
// ones NextEvent reads, as JSON strings or objects):
//   launchers         { name: "command prefix" }
//   calendarLaunchers { "Calendar label": name | { default: name, teams: name, … } }
//   launcherRules     [{ match?, provider?, calendar?, launcher }] (first match wins)
//   browserCommand    "command prefix"
// plus `picks`, the profile chosen per feed link in the settings screen:
// { feedUrl: "command prefix" }. Order: rule → the calendar's launcher for
// the link's provider → picked profile → the calendar's default →
// browserCommand → xdg-open (returned as "").

function jsonSetting(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback
  if (typeof value === "object") return value
  try { return JSON.parse(String(value)) } catch (e) { return fallback }
}

function launchCommand(ev, cfg) {
  cfg = cfg || {}
  var launchers = jsonSetting(cfg.launchers, {})
  var byCalendar = jsonSetting(cfg.calendarLaunchers, {})
  var rules = jsonSetting(cfg.launcherRules, [])
  var picks = cfg.picks || {}
  var title = String(ev.title || "").toLowerCase()
  var cal = String(ev.calendar || "").trim().toLowerCase()
  var provider = String(ev.provider || "").toLowerCase()
  function named(name) {
    var cmd = name ? launchers[name] : ""
    return cmd && String(cmd).trim() ? String(cmd).trim() : ""
  }
  if (Array.isArray(rules))
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i] || {}
      if (!r.match && !r.provider) continue
      if (r.match && title.indexOf(String(r.match).toLowerCase()) === -1) continue
      if (r.provider && String(r.provider).toLowerCase() !== provider) continue
      if (r.calendar && String(r.calendar).trim().toLowerCase() !== cal) continue
      var hit = named(r.launcher)
      if (hit) return hit
    }
  var mapping = null
  for (var key in byCalendar) if (String(key).trim().toLowerCase() === cal && cal) mapping = byCalendar[key]
  if (mapping && typeof mapping === "object" && provider) {
    for (var pk in mapping) if (pk.toLowerCase() === provider && named(mapping[pk])) return named(mapping[pk])
  }
  if (ev.feedUrl && picks[ev.feedUrl]) return String(picks[ev.feedUrl])
  if (mapping) {
    var def = named(typeof mapping === "object" ? mapping["default"] : mapping)
    if (def) return def
  }
  return String(cfg.browserCommand || "").trim()
}

// A link quoted for bash, appended to a launcher command.
function shellQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'"
}

// Browsers whose profiles the settings screen offers, and where each keeps
// its profile list.
var browsers = [
  { id: "chrome", name: "Chrome", bin: "google-chrome-stable", dir: ".config/google-chrome" },
  { id: "chromium", name: "Chromium", bin: "chromium", dir: ".config/chromium" },
  { id: "brave", name: "Brave", bin: "brave", dir: ".config/BraveSoftware/Brave-Browser" },
  { id: "edge", name: "Edge", bin: "microsoft-edge-stable", dir: ".config/microsoft-edge" },
  { id: "vivaldi", name: "Vivaldi", bin: "vivaldi-stable", dir: ".config/vivaldi" }
]

// A browser's "Local State" JSON -> profile choices
// [{ id, name, detail, command }], Default first.
function browserProfiles(browser, localState) {
  var cache = {}
  try { cache = (JSON.parse(localState).profile || {}).info_cache || {} } catch (e) { return [] }
  return Object.keys(cache).sort(function(a, b) {
    return (a === "Default" ? -1 : b === "Default" ? 1 : 0) || a.localeCompare(b, undefined, { numeric: true })
  }).map(function(dir) {
    var p = cache[dir] || {}
    // Chrome's made-up names ("Person 1", "Your Chrome") say less than the
    // account signed in to it.
    var generic = !p.name || /^(Person \d+|Your Chrome|Default)$/.test(p.name)
    var name = generic && p.user_name ? p.user_name : (p.name || dir)
    return { id: browser.id + ":" + dir, name: browser.name + " · " + name,
             detail: (p.user_name && name !== p.user_name ? p.user_name + " · " : "") + dir,
             command: browser.bin + " --profile-directory=" + shellQuote(dir) }
  })
}

// "lunch, Focus time" or ["lunch"] -> ["lunch", "focus time"]
function keywords(value) {
  var list = Array.isArray(value) ? value : String(value || "").split(",")
  return list.map(function(k) { return String(k).trim().toLowerCase() }).filter(function(k) { return k })
}

// `skip` holds the instants (and moved instances) to leave out.
function expandEvent(ev, from, to, zones, skip) {
  var out = []
  if (!ev.rrule) {
    if (ev.end > from && ev.start < to) out.push(ev)
    return out
  }
  var rule = {}
  ev.rrule.split(";").forEach(function(part) {
    var kv = part.split("=")
    if (kv.length === 2) rule[kv[0].toUpperCase()] = kv[1]
  })
  var freq = rule.FREQ
  var interval = Math.max(1, parseInt(rule.INTERVAL || "1", 10))
  var until = Infinity
  if (rule.UNTIL) {
    var u = icsWall(rule.UNTIL)
    if (u) until = toInstant(u.wall, u.utc, u.allDay, ev.tzid, zones) + (u.allDay && !ev.allDay ? 86400000 - 1 : 0)
  }
  var count = rule.COUNT ? parseInt(rule.COUNT, 10) : Infinity
  var duration = ev.end - ev.start
  var f = new Date(ev.wall)
  var fy = f.getUTCFullYear(), fm = f.getUTCMonth(), fd = f.getUTCDate()
  function wallAt(y, mo, d) { return Date.UTC(y, mo, d, f.getUTCHours(), f.getUTCMinutes(), f.getUTCSeconds()) }
  function instant(w) { return toInstant(w, ev.utc, ev.allDay, ev.tzid, zones) }
  function skipped(t) { return ev.exdates.indexOf(t) !== -1 || skip[ev.uid + "@" + t] }
  if (freq === "MONTHLY" || freq === "YEARLY") {
    // Same date every month / year (the common cases: rent, birthdays).
    var step = freq === "MONTHLY" ? interval : interval * 12
    for (var k = 0, made = 0; k < 2400 && made < count; k++) {
      var ow = wallAt(fy, fm + k * step, fd)
      if (new Date(ow).getUTCDate() !== fd) continue
      var ot = instant(ow)
      if (ot > until || ot > to) break
      made += 1
      if (skipped(ot)) continue
      if (ot + duration > from) out.push(occurrence(ev, ot, duration))
    }
    return out
  }
  if (freq !== "DAILY" && freq !== "WEEKLY") {
    if (ev.end > from && ev.start < to) out.push(ev)
    return out
  }
  var days = freq === "WEEKLY" && rule.BYDAY
    ? rule.BYDAY.split(",").map(function(d) { return weekdayCodes.indexOf(d.replace(/^[+-]?\d+/, "")) })
        .filter(function(d) { return d >= 0 })
    : [f.getUTCDay()]
  var n = 0
  // Walk day by day (bounded): cheap for a week-ahead window.
  for (var i = 0; i < 3700 && n < count; i++) {
    var w = wallAt(fy, fm, fd + i)
    var t = instant(w)
    if (t > until || t > to) break
    var weeks = Math.floor(i / 7)
    var ok = freq === "DAILY" ? i % interval === 0
      : (weeks % interval === 0 && days.indexOf(new Date(w).getUTCDay()) !== -1)
    if (!ok) continue
    n += 1
    if (skipped(t)) continue
    if (t + duration > from) out.push(occurrence(ev, t, duration))
  }
  return out
}

// Events overlapping [from, to), soonest first. All-day ones only when
// asked for (the month view wants them, "next meeting" does not).
// `opts` (optional): { feeds: [parseFeed()...] in fetch order, exclude:
// [keywords] }. The fetch's "@@ISLAND-SOURCE <i>" lines say which feed an
// event came from; it then carries that feed's `calendar` label and
// `color`. Invites the calendar's owner declined, titles matching an
// exclude keyword, and the same event seen in two feeds are left out.
function parseIcs(text, from, to, includeAllDay, opts) {
  opts = opts || {}
  var feeds = opts.feeds || []
  var exclude = opts.exclude || []
  var source = -1, owner = ""
  var lines = String(text || "").replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/)
  var zones = parseZones(lines)
  var parsed = []
  // uid@instant of every instance a RECURRENCE-ID entry replaces or cancels.
  var skip = {}
  var ev = null
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]
    if (line.indexOf("@@ISLAND-SOURCE ") === 0) {
      source = parseInt(line.substring(16), 10)
      owner = feeds[source] ? feeds[source].owner : ""
      continue
    }
    if (!ev && line.indexOf("X-WR-CALNAME:") === 0 && !(feeds[source] && feeds[source].owner)) {
      var cn = line.substring(13).trim().toLowerCase()
      if (/^[^\s@]+@[^\s@]+$/.test(cn)) owner = cn
      continue
    }
    if (line === "BEGIN:VEVENT") {
      var feed = feeds[source]
      ev = { title: "", uid: "", start: 0, end: 0, wall: 0, utc: false, tzid: "", allDay: false, rrule: "",
             exdates: [], recurrenceId: null, cancelled: false, declined: false, url: "", conference: "",
             provider: "", location: "", description: "",
             source: source, calendar: feed ? feed.label : "", color: feed ? feed.color : "", feedUrl: feed ? feed.url : "" }
      continue
    }
    if (line === "END:VEVENT") {
      if (ev && ev.recurrenceId !== null) skip[ev.uid + "@" + ev.recurrenceId] = true
      if (ev && ev.start && !ev.cancelled && !ev.declined) {
        if (!ev.end) ev.end = ev.start + (ev.allDay ? 86400000 : 3600000)
        var link = meetingLink(ev)
        ev.url = link.url
        ev.provider = link.provider
        // A moved instance stands on its own; it never repeats.
        if (ev.recurrenceId !== null) ev.rrule = ""
        parsed.push(ev)
      }
      ev = null
      continue
    }
    if (!ev) continue
    var colon = line.indexOf(":")
    if (colon < 0) continue
    var head = line.substring(0, colon)
    var name = head.split(";")[0].toUpperCase()
    var value = line.substring(colon + 1)
    if (name === "SUMMARY") ev.title = icsUnescape(value)
    else if (name === "UID") ev.uid = value.trim()
    else if (name === "DTSTART") {
      var ds = icsWall(value)
      if (ds) {
        ev.wall = ds.wall; ev.utc = ds.utc; ev.allDay = ds.allDay; ev.tzid = lineTzid(head)
        ev.start = toInstant(ds.wall, ds.utc, ds.allDay, ev.tzid, zones)
      }
    }
    else if (name === "DTEND") { var de = icsWall(value); if (de) ev.end = toInstant(de.wall, de.utc, de.allDay, lineTzid(head), zones) }
    else if (name === "RECURRENCE-ID") {
      var dr = icsWall(value)
      if (dr) ev.recurrenceId = toInstant(dr.wall, dr.utc, dr.allDay, lineTzid(head), zones)
    }
    else if (name === "RRULE") ev.rrule = value
    else if (name === "URL") ev.url = value.trim()
    else if (name === "LOCATION") ev.location = icsUnescape(value)
    else if (name === "DESCRIPTION") ev.description = icsUnescape(value)
    else if (name === "X-GOOGLE-CONFERENCE") ev.conference = value.trim()
    else if (name === "ATTENDEE" && owner && /PARTSTAT=DECLINED/i.test(head)
             && value.trim().toLowerCase() === "mailto:" + owner) ev.declined = true
    else if (name === "EXDATE") {
      var xz = lineTzid(head)
      value.split(",").forEach(function(v) { var x = icsWall(v); if (x) ev.exdates.push(toInstant(x.wall, x.utc, x.allDay, xz, zones)) })
    }
    else if (name === "STATUS" && value.toUpperCase() === "CANCELLED") ev.cancelled = true
  }
  var events = []
  for (var j = 0; j < parsed.length; j++) events = events.concat(expandEvent(parsed[j], from, to, zones, skip))
  var seen = {}
  return events.filter(function(e) {
    if (!includeAllDay && e.allDay) return false
    var title = String(e.title || "").toLowerCase()
    for (var k = 0; k < exclude.length; k++) if (title.indexOf(exclude[k]) !== -1) return false
    // Shared with another feed: the first feed's copy wins.
    if (e.uid) {
      var key = e.uid + "@" + e.start
      if (seen[key]) return false
      seen[key] = true
    }
    return true
  }).sort(function(a, b) { return a.start - b.start || a.source - b.source })
}

function dayKey(time) {
  var d = new Date(time)
  return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate()
}

// Map of dayKey -> events for every day an event touches.
function eventsByDay(events) {
  var map = {}
  for (var i = 0; i < events.length; i++) {
    var e = events[i]
    var d = new Date(e.start)
    var day = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    var last = e.allDay ? e.end - 1 : e.end - 1
    for (var n = 0; n < 62 && day.getTime() <= last; n++) {
      var key = dayKey(day.getTime())
      if (!map[key]) map[key] = []
      map[key].push(e)
      day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
    }
  }
  return map
}

// Google's public holiday calendars, by ISO country code (each one checked
// to answer). Name is what the picker shows.
var holidayCalendars = [
  { code: "IN", name: "India", id: "indian" },
  { code: "US", name: "United States", id: "usa" },
  { code: "GB", name: "United Kingdom", id: "uk" },
  { code: "CA", name: "Canada", id: "canadian" },
  { code: "AU", name: "Australia", id: "australian" },
  { code: "NZ", name: "New Zealand", id: "new_zealand" },
  { code: "IE", name: "Ireland", id: "irish" },
  { code: "DE", name: "Germany", id: "german" },
  { code: "FR", name: "France", id: "french" },
  { code: "ES", name: "Spain", id: "spain" },
  { code: "IT", name: "Italy", id: "italian" },
  { code: "NL", name: "Netherlands", id: "dutch" },
  { code: "JP", name: "Japan", id: "japanese" },
  { code: "KR", name: "South Korea", id: "south_korea" },
  { code: "SG", name: "Singapore", id: "singapore" },
  { code: "MY", name: "Malaysia", id: "malaysia" },
  { code: "ID", name: "Indonesia", id: "indonesian" },
  { code: "PH", name: "Philippines", id: "philippines" },
  { code: "AE", name: "UAE", id: "ae" },
  { code: "PK", name: "Pakistan", id: "pk" },
  { code: "BD", name: "Bangladesh", id: "bd" },
  { code: "LK", name: "Sri Lanka", id: "lk" },
  { code: "BR", name: "Brazil", id: "brazilian" },
  { code: "MX", name: "Mexico", id: "mexican" }
]

function holidayCalendar(code) {
  var c = String(code || "").toUpperCase()
  for (var i = 0; i < holidayCalendars.length; i++)
    if (holidayCalendars[i].code === c) return holidayCalendars[i]
  return null
}

function holidayUrl(code) {
  var h = holidayCalendar(code)
  return h ? "https://calendar.google.com/calendar/ical/en." + h.id + "%23holiday%40group.v.calendar.google.com/public/basic.ics" : ""
}

// ---------------------------------------------------------------- herdr
// Agents running under herdr (https://herdr.dev), on this machine and on
// every saved SSH machine. The poll prints one section per machine:
//
//   @@HERDR <machine id, or "local"> <ssh target, or "-"> <session> <label>
//   <the JSON of `herdr [--machine <id>] agent list`>
//
// The target and session are what a window attached to that machine runs
// (`herdr --remote <target> [--session <name>]`), which is how a click finds
// that window or opens one.
//
// A section whose JSON is missing or unreadable means that machine did not
// answer this time.

// Herdr's states worth showing, most urgent first. `idle` (ready, already
// seen) and `unknown` are not news.
var agentRank = { blocked: 0, done: 1, working: 2 }

function baseName(path) {
  var p = String(path || "").replace(/\/+$/, "")
  return p.substring(p.lastIndexOf("/") + 1)
}

// -> { agents: [...], failed: [machine ids that did not answer] }
function herdrParse(text) {
  var agents = [], failed = []
  var sections = String(text || "").split(/^@@HERDR /m)
  for (var i = 1; i < sections.length; i++) {
    var body = sections[i]
    var nl = body.indexOf("\n")
    var head = nl < 0 ? body : body.substring(0, nl)
    var json = nl < 0 ? "" : body.substring(nl + 1).trim()
    var words = head.trim().split(" ")
    var id = words[0] || ""
    var machine = id === "local" ? "" : id
    var target = words[1] && words[1] !== "-" ? words[1] : ""
    var session = words[2] || "default"
    var label = words.slice(3).join(" ").trim()
    var list = null
    try {
      var parsed = JSON.parse(json)
      list = parsed && parsed.result && Array.isArray(parsed.result.agents) ? parsed.result.agents : null
    } catch (e) {}
    if (!list) { failed.push(machine); continue }
    for (var j = 0; j < list.length; j++) {
      var a = list[j] || {}
      var pane = String(a.pane_id || "")
      if (!pane) continue
      agents.push({
        key: (machine || "local") + "/" + pane,
        machine: machine,
        target: target,
        session: session,
        label: label,
        pane: pane,
        agent: String(a.agent || ""),
        status: String(a.agent_status || "unknown"),
        title: plainText(a.terminal_title_stripped || a.terminal_title || ""),
        // A herdr worktree is "<repo>--<branch>"; the title already says
        // which task it is, so the place is the repo.
        project: baseName(a.foreground_cwd || a.cwd).split("--")[0]
      })
    }
  }
  return { agents: agents, failed: failed }
}

// The agents worth showing: waiting on you, then finished unseen, then busy.
function herdrLive(agents) {
  return (agents || []).filter(function(a) { return agentRank[a.status] !== undefined })
    .sort(function(a, b) {
      return agentRank[a.status] - agentRank[b.status]
        || String(a.label).localeCompare(String(b.label)) || String(a.pane).localeCompare(String(b.pane))
    })
}

// What changed since the last poll that deserves a toast. `prev` maps agent
// key -> last status; `primed` is false on the very first poll, which only
// learns what is already there. -> [{ agent, kind: "blocked" | "done" }]
function herdrChanges(prev, agents, primed) {
  var out = []
  if (!primed) return out
  for (var i = 0; i < agents.length; i++) {
    var a = agents[i]
    var was = prev[a.key]
    if (was === a.status) continue
    if (a.status === "blocked") out.push({ agent: a, kind: "blocked" })
    // Finished: `done` if nobody was looking, `idle` if its pane was in view.
    else if (was === "working" && (a.status === "done" || a.status === "idle")) out.push({ agent: a, kind: "done" })
    else if (was === "blocked" && a.status === "done") out.push({ agent: a, kind: "done" })
  }
  return out
}

// "bss · helm-charts", or just the project for an agent on this machine.
function agentPlace(a) {
  return [a.label, a.project].filter(function(p) { return p }).join(" · ")
}

// What to call an agent in one line: its task, unless the terminal title
// is only the agent's own name ("Claude Code"), then where it runs.
function agentTitle(a) {
  var t = String(a.title || "").trim()
  if (!t || t.toLowerCase() === String(a.agent || "").toLowerCase()
      || /^(claude( code)?|codex|opencode|gemini( cli)?|amp|pi|cursor( agent)?)$/i.test(t))
    return agentPlace(a) || t || a.agent || a.pane
  return t
}

function agentStateText(status) {
  return status === "blocked" ? "needs you" : (status === "done" ? "done" : (status === "working" ? "working" : "ready"))
}

// "1 needs you · 2 working"
function agentsSummary(agents) {
  var counts = { blocked: 0, done: 0, working: 0 }
  for (var i = 0; i < agents.length; i++) if (counts[agents[i].status] !== undefined) counts[agents[i].status]++
  var parts = []
  if (counts.blocked) parts.push(counts.blocked + " needs you")
  if (counts.done) parts.push(counts.done + " done")
  if (counts.working) parts.push(counts.working + " working")
  return parts.join(" · ")
}

// "in 12m", "in 1h 5m", "now"
function untilText(start, now) {
  var s = Math.round((start - now) / 1000)
  if (s <= 30) return "now"
  var m = Math.ceil(s / 60)
  if (m < 60) return "in " + m + "m"
  return "in " + Math.floor(m / 60) + "h" + (m % 60 ? " " + (m % 60) + "m" : "")
}

// "now", "5m", "2h", "3d" — how long ago a notification arrived.
function ago(time, now) {
  var s = Math.max(0, Math.floor((Number(now) - Number(time)) / 1000))
  if (s < 60) return "now"
  if (s < 3600) return Math.floor(s / 60) + "m"
  if (s < 86400) return Math.floor(s / 3600) + "h"
  return Math.floor(s / 86400) + "d"
}

function pad2(n) {
  return n < 10 ? "0" + n : String(n)
}

function formatTime(seconds) {
  var s = Math.max(0, Math.floor(Number(seconds) || 0))
  var h = Math.floor(s / 3600)
  var m = Math.floor((s % 3600) / 60)
  var sec = s % 60
  return h > 0 ? h + ":" + pad2(m) + ":" + pad2(sec) : m + ":" + pad2(sec)
}

function clamp01(v) {
  var n = Number(v)
  if (!isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function volumeIcon(volume, muted) {
  if (muted || volume <= 0.001) return "󰝟"
  if (volume < 0.34) return "󰕿"
  if (volume < 0.67) return "󰖀"
  return "󰕾"
}

function brightnessIcon(level) {
  if (level < 0.34) return "󰃞"
  if (level < 0.67) return "󰃟"
  return "󰃠"
}

var batteryDischarging = ["󰂎", "󰁺", "󰁻", "󰁼", "󰁽", "󰁾", "󰁿", "󰂀", "󰂁", "󰂂", "󰁹"]
var batteryCharging = ["󰢟", "󰢜", "󰂆", "󰂇", "󰂈", "󰢝", "󰂉", "󰢞", "󰂊", "󰂋", "󰂅"]

function batteryIcon(fraction, charging) {
  var i = Math.max(0, Math.min(10, Math.round(clamp01(fraction) * 10)))
  return charging ? batteryCharging[i] : batteryDischarging[i]
}

function percentText(fraction) {
  return Math.round(clamp01(fraction) * 100) + "%"
}

// MPRIS proxies (playerctld) mirror another player; showing them would put
// every track in the island twice.
function isProxyPlayer(player) {
  var dbusName = String(player && player.dbusName || "").toLowerCase()
  var entry = String(player && player.desktopEntry || "").toLowerCase()
  return dbusName.indexOf("playerctld") !== -1 || entry === "playerctld"
}

function playerKey(player) {
  return player ? String(player.dbusName || player.identity || "") : ""
}

function hasTrack(player) {
  return !!(player && (player.trackTitle || player.trackArtist))
}

// How complete a player's track info is. When two players both claim to be
// playing (a music app plus a browser tab mirroring it), the one with cover
// art and a separate artist is the one worth showing.
function richness(player) {
  return (hasRealArt(player) ? 2 : 0) + (player.trackArtist ? 1 : 0)
}

// Chromium-based browsers hand MPRIS a temp file for artwork, and when the
// page gives none it is just the browser's own logo. It never outranks a
// player with a real cover.
function hasRealArt(player) {
  var url = String(player && player.trackArtUrl || "")
  if (!url) return false
  return url.indexOf("/.org.chromium.") === -1 && url.indexOf("/.com.google.Chrome.") === -1
    && url.indexOf("/.com.brave.") === -1 && url.indexOf("/.com.microsoft.Edge.") === -1
}

function normalizedTitle(player) {
  return String(player && player.trackTitle || "").toLowerCase().replace(/\s+/g, " ").trim()
}

// Two players showing one song: typically the Spotify app plus Chromium's
// mirror of it ("Boyfriend" vs "Boyfriend • Karan Aujla, Ikky", same length).
function sameTrack(a, b) {
  var ta = normalizedTitle(a)
  var tb = normalizedTitle(b)
  if (!ta || !tb) return false
  if (!(ta === tb || ta.indexOf(tb) === 0 || tb.indexOf(ta) === 0)) return false
  if (a.lengthSupported && b.lengthSupported && a.length > 0 && b.length > 0)
    return Math.abs(a.length - b.length) < 2
  return true
}

// Players worth considering: no proxies, something loaded, and of any pair
// playing the same song only the one with the better metadata.
function candidates(players) {
  var list = []
  for (var i = 0; i < players.length; i++) {
    var p = players[i]
    if (!p || isProxyPlayer(p) || !hasTrack(p)) continue
    var duplicateOf = -1
    for (var j = 0; j < list.length; j++)
      if (sameTrack(p, list[j])) { duplicateOf = j; break }
    if (duplicateOf === -1) list.push(p)
    else if (richness(p) > richness(list[duplicateOf])) list[duplicateOf] = p
  }
  return list
}

// The island sticks with the player it is already showing (`currentKey`), so
// pausing keeps that player on screen even while a browser tab keeps claiming
// "Playing". It moves on only when another player starts playing (handled by
// the caller) or the current one goes away. Without a current player: the
// richest playing one, then the richest one at all.
function pickPlayer(players, currentKey) {
  var list = candidates(players)
  var current = null
  var playing = null
  var fallback = null
  for (var i = 0; i < list.length; i++) {
    var p = list[i]
    if (currentKey && playerKey(p) === currentKey) current = p
    if (p.isPlaying && (!playing || richness(p) > richness(playing))) playing = p
    if (!fallback || richness(p) > richness(fallback)) fallback = p
  }
  return current || playing || fallback
}

// Capture streams (something is recording from a microphone). Peak meters and
// monitor taps are capture streams too, but they are not a privacy signal.
function isMicStream(node) {
  if (!node || !node.isStream || node.isSink !== false) return false
  var name = String(node.name || "").toLowerCase()
  return name.indexOf("peak") === -1 && name.indexOf("monitor") === -1 && name.indexOf("cava") === -1
}

// Pull `colorN = "#rrggbb"` pairs out of a theme's colors.toml.
function parseColors(text) {
  var out = {}
  var re = /^\s*([A-Za-z0-9_]+)\s*=\s*"(#[0-9A-Fa-f]{6,8})"/gm
  var m
  while ((m = re.exec(String(text || ""))) !== null) out[m[1]] = m[2]
  return out
}

function parseConfig(configText) {
  try {
    var cfg = JSON.parse(String(configText || "{}"))
    return cfg && typeof cfg === "object" ? cfg : {}
  } catch (e) {
    return {}
  }
}

// This plugin's own entry in shell.json's plugins[] array doubles as its
// settings block, e.g. { "id": "...", "style": "notch" }.
function entryFor(cfg, pluginId) {
  var list = cfg && Array.isArray(cfg.plugins) ? cfg.plugins : []
  for (var i = 0; i < list.length; i++)
    if (list[i] && list[i].id === pluginId) return list[i]
  return {}
}

// Senders that are feedback noise rather than messages (Omarchy's rule).
function isEphemeralApp(appName) {
  var name = String(appName || "")
  return name === "notify-send" || name === "omarchy-action"
}

function stringHint(hints, name) {
  try {
    if (hints) {
      var value = hints[name]
      if (value !== undefined && value !== null) return String(value)
    }
  } catch (e) {}
  return ""
}

// omarchy-notification-send --exec passes the click command as a JSON argv.
function parseExecArgv(value) {
  var text = String(value || "")
  if (!text) return null
  var parsed
  try { parsed = JSON.parse(text) } catch (e) { return null }
  if (!Array.isArray(parsed) || parsed.length === 0) return null
  for (var i = 0; i < parsed.length; i++)
    if (typeof parsed[i] !== "string") return null
  return parsed
}

// Notification bodies may carry a little markup; the island shows text.
function plainText(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
}

// Omarchy's OSD payloads ({ icon, message, value, max, duration }, as sent by
// `omarchy osd` and its callers), mapped onto island HUDs. `show` says
// whether volume and brightness levels should appear ({ volume, brightness });
// returns null for a payload the island should drop.
function osdGlyph(name) {
  var n = String(name || "").toLowerCase()
  if (n.indexOf("microphone-muted") === 0 || n === "microphone-off" || n === "mic-muted" || n === "mic-off") return "󰍭"
  if (n === "microphone" || n === "mic") return "󰍬"
  if (n === "keyboard") return "󰌌"
  if (n === "brightness" || n === "display") return "󰃠"
  if (n === "touchpad") return "󰟸"
  if (n === "touch" || n === "touchscreen") return "󰝁"
  if (n === "reboot" || n === "restart") return "󰜉"
  if (n === "shutdown" || n === "power" || n === "poweroff") return "󰐥"
  if (n === "logout" || n === "sign-out" || n === "leave") return "󰍃"
  if (n.indexOf("media") === 0 || n.indexOf("player") === 0) return "󰝚"
  if (n === "volume-muted" || n === "volume-mute" || n === "muted" || n === "mute") return "󰝟"
  if (n.indexOf("volume") === 0) return "󰕾"
  return String(name || "")
}

function osdHud(payload, show) {
  var p = payload || {}
  var key = String(p.icon || "").toLowerCase()
  var message = String(p.message || "")
  var max = Math.max(1, parseInt(p.max || "100", 10) || 100)
  var raw = parseInt(p.value, 10)
  var hasProgress = p.value !== undefined && p.value !== "" && !isNaN(raw) && message === ""
  var parsedDuration = parseInt(p.duration, 10)
  var duration = isNaN(parsedDuration) ? 1500 : Math.max(1500, parsedDuration)
  var volume = key.indexOf("volume") === 0 || key === "muted" || key === "mute"
  var off = /muted|-off$|^mute$/.test(key) || / disabled$/i.test(message)

  if (hasProgress) {
    var level = clamp01(raw / max)
    if (volume && !show.volume) return null
    if (key === "brightness" && !show.brightness) return null
    return {
      key: volume ? "volume" : (key === "brightness" ? "brightness" : "osd"),
      layout: "progress",
      icon: volume ? volumeIcon(level, off) : (key === "brightness" ? brightnessIcon(level) : osdGlyph(p.icon)),
      value: level,
      valueText: Math.round(level * 100) + "%",
      dim: off,
      duration: duration
    }
  }
  if (!message && !p.icon) return null
  return {
    key: "osd",
    layout: "label",
    // Switching outputs sends the device name with a volume icon.
    label: message,
    valueText: volume && !off && message ? "Playing on" : "",
    icon: osdGlyph(p.icon),
    dim: off,
    duration: duration
  }
}

// Every setting and its default, in the README's order. The island writes
// the missing ones into its shell.json entry so they can be edited in place.
var defaultSettings = {
  style: "notch",
  background: "theme",
  idle: "pill",
  idleFace: "ticker",
  scale: 1,
  topMargin: 6,
  reserveSpace: true,
  keybind: "SUPER + ALT + I",
  monitor: "primary",
  layer: "top",
  expandOnHover: false,
  clockFormat: "h:mm AP",
  mediaLingerSeconds: 30,
  notchWidth: 0,
  notchHeight: 0,
  notchRadius: 0,
  visualizerColor: "accent",
  textFont: "iA Writer Quattro V",
  glow: false,
  calendars: [],
  calendarLeadMinutes: 15,
  holidays: "auto",
  timerSound: true,
  bluetooth: true,
  camera: true,
  calendar: true,
  herdr: true,
  herdrToasts: true,
  herdrInterval: 5,
  notifications: true,
  inbox: true,
  osd: true,
  volume: true,
  brightness: true,
  charging: true,
  trackChange: true,
  recording: true,
  mic: true,
  assistant: true,
  planPill: true,
  avatarTracking: true,
  approvalCard: true,
  secretaryPath: "~/secretary"
}

function missingSettings(settings) {
  var s = settings || {}
  return Object.keys(defaultSettings).filter(function(k) { return !(k in s) })
}

// Hyprland's modifier mask for a key like "SUPER + ALT + I", and the key.
function parseKeybind(text) {
  var parts = String(text || "").split("+").map(function(p) { return p.trim() }).filter(function(p) { return p })
  if (parts.length === 0) return null
  var bits = { SHIFT: 1, CAPS: 2, CTRL: 4, CONTROL: 4, ALT: 8, MOD1: 8, MOD2: 16, MOD3: 32,
               SUPER: 64, WIN: 64, LOGO: 64, MOD4: 64, MOD5: 128 }
  var mask = 0
  for (var i = 0; i < parts.length - 1; i++) {
    var bit = bits[parts[i].toUpperCase()]
    if (bit === undefined) return null
    mask |= bit
  }
  return { mask: mask, key: parts[parts.length - 1] }
}

// ------------------------------------------------------------------
// Assistant: plan gauges, diff counts, the Omarchy avatar's mood, and a
// little syntax colour for the diff viewer.
// ------------------------------------------------------------------

// What a plan window counts as now: 0 once its reset time has passed.
function windowPct(w, now) {
  if (!w || !(w.resetsAt > 0)) return -1
  return w.resetsAt <= now ? 0 : Math.max(0, Math.min(100, Number(w.usedPct) || 0))
}

// "green" below 50 %, "orange" to 80 %, "red" above, "none" without numbers.
function planTier(pct) {
  if (!(pct >= 0)) return "none"
  return pct < 50 ? "green" : (pct <= 80 ? "orange" : "red")
}

// The pill's number: the active account's 5-hour share, or the highest
// burn among all accounts when the active one has none.
// -> { pct, account } or null
function planHeadline(accounts, now) {
  var list = accounts || []
  var best = null
  for (var i = 0; i < list.length; i++) {
    var a = list[i]
    var pct = windowPct(a.fiveHour, now)
    if (pct < 0) pct = windowPct(a.sevenDay, now)
    if (pct < 0) continue
    if (a.active) return { pct: pct, account: a }
    if (!best || pct > best.pct) best = { pct: pct, account: a }
  }
  return best
}

// "Resets in 1h 42m"
function resetText(resetsAt, now) {
  var s = Math.max(0, Math.round((resetsAt - now) / 1000))
  if (s <= 0) return "Resetting…"
  var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  if (d > 0) return "Resets in " + d + "d " + h + "h"
  if (h > 0) return "Resets in " + h + "h " + m + "m"
  return "Resets in " + Math.max(1, m) + "m"
}

// "+12 -3", or "" for no changes.
function diffText(added, removed) {
  if (!(added > 0) && !(removed > 0)) return ""
  return "+" + (added || 0) + " -" + (removed || 0)
}

// An editor-tab badge for a file: two letters and the language's colour.
var languages = {
  ts: ["TS", "#3178c6"], tsx: ["TS", "#3178c6"], js: ["JS", "#c9a400"], jsx: ["JS", "#c9a400"], mjs: ["JS", "#c9a400"],
  py: ["PY", "#3572a5"], go: ["GO", "#00add8"], rs: ["RS", "#b7410e"], rb: ["RB", "#cc342d"], java: ["JV", "#b07219"],
  qml: ["QM", "#41cd52"], sh: ["SH", "#4eaa25"], bash: ["SH", "#4eaa25"], lua: ["LU", "#000080"], md: ["MD", "#6e7681"],
  json: ["{}", "#8a6d00"], yaml: ["YM", "#cb171e"], yml: ["YM", "#cb171e"], toml: ["TM", "#9c4221"], tf: ["TF", "#7b42bc"],
  css: ["CS", "#663399"], html: ["HT", "#e34c26"], sql: ["SQ", "#e38c00"], c: ["C", "#555555"], cpp: ["C+", "#f34b7d"],
  cs: ["C#", "#178600"], php: ["PH", "#4f5d95"], swift: ["SW", "#f05138"], kt: ["KT", "#a97bff"], nix: ["NX", "#7e7eff"]
}
function languageOf(path) {
  var name = String(path || "").split("/").pop()
  var ext = name.indexOf(".") > 0 ? name.split(".").pop().toLowerCase() : ""
  if (name === "Dockerfile") return { badge: "DK", color: "#384d54" }
  var l = languages[ext]
  return l ? { badge: l[0], color: l[1] } : { badge: (ext || "··").slice(0, 2).toUpperCase(), color: "#6e7681" }
}

// The avatar's state, most pressing first.
function avatarMood(s) {
  if (s.approval) return "approval"
  if (s.poked) return "poked"
  if (s.working) return "working"
  if (s.done) return "done"
  if (s.music) return "music"
  return "idle"
}

var codeKeywords = /\b(import|export|from|const|let|var|function|return|if|else|for|while|class|new|async|await|def|fn|pub|use|struct|impl|match|type|interface|property|readonly|true|false|null|undefined|None|self|this)\b/g

function escapeHtml(t) {
  return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ /g, "&nbsp;")
}

// One line of code as StyledText: strings, comments, numbers and keywords
// tinted. Deliberately small: it only has to read well at a glance.
function highlightLine(text, c) {
  var line = String(text || "")
  if (line.length > 400) line = line.substring(0, 400) + "…"
  var comment = line.search(/(\/\/|#(?!include)|--\s)/)
  var code = comment >= 0 ? line.substring(0, comment) : line
  var rest = comment >= 0 ? line.substring(comment) : ""
  var out = ""
  var re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)/g
  var last = 0, m
  function paint(color, t) { return "<font color=\"" + color + "\">" + escapeHtml(t) + "</font>" }
  // Keywords and numbers in one pass over the raw text, so nothing matches
  // inside markup added earlier.
  function plain(t) {
    var res = "", at = 0, k
    var tok = new RegExp(codeKeywords.source + "|\\b(\\d+(?:\\.\\d+)?)\\b", "g")
    while ((k = tok.exec(t)) !== null) {
      res += escapeHtml(t.substring(at, k.index)) + paint(k[1] ? c.keyword : c.number, k[0])
      at = k.index + k[0].length
    }
    return res + escapeHtml(t.substring(at))
  }
  while ((m = re.exec(code)) !== null) {
    out += plain(code.substring(last, m.index))
    out += paint(c.string, m[0])
    last = m.index + m[0].length
  }
  out += plain(code.substring(last))
  if (rest) out += paint(c.comment, rest)
  return out
}
