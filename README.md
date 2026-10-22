# Dynamic Island for Omarchy

An Apple-style Dynamic Island for [Omarchy](https://omarchy.org). A pill sits at
the top of the screen and springs open into live activities: now playing,
screen recording, microphone in use, volume, brightness, charging, and custom
messages. It is drawn in your current Omarchy theme's colors and font, and
re-colors itself when you switch themes.

It is a native Omarchy shell plugin (Quickshell QML running inside
`omarchy-shell`), so it adds no extra process, and every data source is live:
MPRIS, PipeWire and UPower through Quickshell's services, sysfs for the
backlight, and `gpu-screen-recorder` for recording.

![The island's states: player, notifications, inbox, calendar, recording, timer, script activity, output picker, and the resting pills](assets/overview.webp)

## What it shows

| State | Looks like |
|---|---|
| Idle | A glance ticker: every few seconds the next of the time, date, battery, next meeting, today's festival or "Silenced" flips in like a split-flap board, and the pill resizes to fit |
| Music playing | Cover art on the left, the song and artist scrolling through the middle, a live equalizer on the right. When paused it stays on the same player, with the text stopped and dimmed |
| Screen recording | Pulsing record dot, `REC`, and the running time |
| Microphone / camera in use | Mic glyph and an orange dot; for the camera, a camera glyph and a green dot |
| Timer | A ring that fills as time runs out, and the time left. At zero a message and an alarm sound |
| Stopwatch | The running time. It keeps going across restarts |
| Next meeting | 15 minutes before an event: the title scrolling past and a countdown, then a "Starting now" message. Once it starts it turns red and takes the pill (music moves to the bubble), and joining the call from the island pauses the music |
| Script activities | Any script can put a live activity in the island: glyph, progress ring, value, title |
| Coding agents | [herdr](https://herdr.dev) agents here and on your saved SSH machines: the most urgent one's task and state ("needs you", "done", "working"), a toast when one needs you or finishes, and a click to land on it |
| Bluetooth devices | Headphones, speakers, keyboards, mice, controllers: the device's name and battery when it connects, and a message when it disconnects |
| Two at once | The second activity splits off into its own bubble. Click the bubble to open that one |
| Play on | The speaker button in the player lists every audio output (speakers, headphones, Bluetooth, HDMI) to switch to |
| Volume / brightness | The island stretches into a slim level bar |
| Plugged in / low battery | `Charging 80%` or `Low Battery 10%` |
| Track change | A short now-playing card |
| Click (idle) | The time, date, next meeting and battery, plus one-tap 5, 15 and 25 minute timers and a stopwatch |
| Click | Expands into a full player (seekable progress, prev/play/next). While recording it shows the recording with a Stop button, with the player underneath if music is on. With nothing live it shows the time, date and battery |

Mouse:

* **Left click**: expand or collapse. The island also closes when the pointer leaves it.
* **Middle click**: play/pause.
* **Scroll**: change the volume.

| | | |
|---|---|---|
| ![The full player, washed in the album cover](assets/player.webp) | ![Clicking the resting island: time, battery and one-tap timers](assets/quick-actions.webp) | ![A script reporting build progress in the island](assets/live-activity.webp) |
| The full player | Quick timers and a stopwatch | Live progress from your own scripts |

## Look

The island is drawn as a piece of dark glass in your theme's colors: a body
shaded slightly from top to bottom with a hairline rim, words set in iA
Writer Quattro (Omarchy ships it) with numbers and icons in your theme's
monospace. A thin light along its lower edge shows what it's doing: a faint
accent line when idle, pulsing in the music's color while something plays,
draining orange as a timer runs down, red while recording, filling as a
script reports progress, and a bead of light running across when a
notification arrives or the charger goes in. The expanded player shows a
soft wash of the album cover behind it.

## Notifications

The island is also your notification daemon. On first run it disables
Omarchy's own `omarchy.notifications` service (only one program can receive
notifications), and it answers the same `omarchy-shell notifications ...`
commands, so Omarchy's keybinds and scripts keep working:

| | |
|---|---|
| ![A notification banner with Reply and Mark as Read buttons](assets/notification.webp) | ![The inbox with three missed notifications and Clear all](assets/inbox.webp) |
| A notification with its actions | Everything you missed, in the inbox |

* **New notification**: it drops out of the island as a banner with the app
  icon, title and body, plus the sender's buttons if it has any. Hovering
  keeps it up.
* **Click a notification**: runs the sender's action and focuses the app's
  window. Right-click or the × clears it without opening it.
* **Not clicked**: when the banner's time runs out the notification is not
  lost. It waits in the inbox, shown as a bell with a count, in the pill or as
  a bubble next to what's playing. The inbox survives shell restarts.
* **Inbox**: click the bell (or press `SUPER+SHIFT+ALT+,`) to see everything
  waiting. Click a row to open that app, × on a row to clear it, or
  **× Clear all** at the bottom.
* **Do not disturb** (`SUPER+CTRL+,`): nothing pops up, and everything still
  goes to the inbox.
* `SUPER+,` clears the newest, `SUPER+SHIFT+,` clears everything,
  `SUPER+ALT+,` opens the newest.

Omarchy's own quick feedback toasts ("Theme changed" and similar) show as
banners but don't pile up in the inbox.

To go back to Omarchy's notifications, set `"notifications": false` in the
island's settings. Disabling or removing the plugin also hands
notifications back automatically.

## Install

```bash
omarchy plugin add https://github.com/Arjun010011/omarchy-dynamic-island --enable
```

Or from a checkout:

```bash
./dev-install.sh
omarchy-shell shell rescanPlugins
omarchy plugin enable omarchy-dynamic-island
```

## Settings

Settings live in the plugin's entry in `~/.config/omarchy/shell.json`. On
first start the island fills that entry with every setting below at its
default, so you only change values; any you set yourself are kept. Changes
apply as soon as you save the file.

```json
"plugins": [
  { "id": "omarchy-dynamic-island", "style": "island", "scale": 1.1 }
]
```

| Key | Default | Meaning |
|---|---|---|
| `style` | `"notch"` | `"notch"` is attached to the top edge like a MacBook notch; `"island"` floats just below it |
| `background` | `"theme"` | `"theme"` uses the theme background; `"black"` is true black like the hardware island |
| `idle` | `"pill"` | `"hidden"` removes the pill when nothing is live |
| `idleFace` | `"ticker"` | What the resting pill shows: `"ticker"`, `"clock"`, `"lens"` (a camera lens, like the hardware island) or `"none"` |
| `scale` | `1` | Size multiplier (0.6–2) |
| `topMargin` | `6` | Gap above the island in `island` style |
| `reserveSpace` | `true` | Keep a strip free across the top for the island. `false` lets windows fill the top of the screen and the island/notch sits over them, so no empty band is left beside it |
| `keybind` | `"SUPER + ALT + I"` | Key that toggles `reserveSpace`. The island adds it to `~/.config/hypr/bindings.lua` (skipped if the key is already taken) and removes it on uninstall; `false` for none |
| `monitor` | `"primary"` | `"primary"`, `"focused"`, or a monitor name like `"eDP-1"` |
| `layer` | `"top"` | `"overlay"` keeps it above fullscreen windows |
| `expandOnHover` | `false` | Open on hover instead of on click |
| `assistant` | `true` | Connect to island-agent-daemon (see [Assistant](#assistant-approvals-diffs-plans-and-chat)); `false` turns the avatar, approvals, workspace and plan pill off |
| `planPill` | `true` | The plan gauge (5-hour usage of the default account) at the right of the resting pill |
| `avatarTracking` | `true` | The avatar's eyes follow the pointer while it is on screen |
| `approvalCard` | `true` | Open the island by itself when an agent asks for permission or asks a question |
| `secretaryPath` | `"~/secretary"` | Your [secretary](#secretary) checkout, for Island Chat's Secretary workspace |
| `chatWorkspace` | `"island"` | Where Island Chat starts: `"island"` or `"secretary"` (needs a CLAUDE.md in `secretaryPath`) |
| `chatModel` | `""` | The model Island Chat starts on, e.g. `"claude-sonnet-5-5"`, when the account offers it; empty for the account's default |
| `clockFormat` | `"h:mm AP"` | Qt date format for the expanded clock |
| `mediaLingerSeconds` | `30` | How long a paused track stays in the island |
| `notchWidth`, `notchHeight`, `notchRadius` | `0` | Fit a real display cutout: see below |
| `visualizerColor` | `"accent"` | `"artwork"` colors the equalizer and glow from the album cover |
| `textFont` | `"iA Writer Quattro V"` | Font for words; `"theme"` uses your theme font everywhere |
| `glow` | `false` | Soft light behind the island in the music's color |
| `calendars` | `[]` | iCalendar links or files for the next-meeting activity, e.g. `["https://…/basic.ics", "~/cal.ics"]` |
| `calendarLeadMinutes` | `15` | How early a meeting takes the pill; from two hours out it takes the side bubble over the agents |
| `calendarExclude` | `""` | Comma-separated keywords; matching event titles are hidden |
| `calendarRefreshMinutes` | `15` | How often calendar feeds are re-read |
| `launchers`, `calendarLaunchers`, `launcherRules`, `browserCommand` | | How meeting links open (see Calendar settings) |
| `holidays` | `"auto"` | Public holidays: `"auto"` (from the timezone), `"off"`, or a country code |
| `timerSound` | `true` | Play the alarm sound when a timer ends |
| `transcription` | `true` | The calendar's 󰍬 button: transcribe a meeting on this machine with [voxtype](https://voxtype.io)'s meeting mode (your mic plus the speakers' PipeWire monitor, no bot on the call). Stopping writes `<date>-<title>.transcript.md` and `.summary.md` (summary by the Ollama model set in voxtype's `[meeting.summary]`) |
| `transcribeOnJoin` | `false` | Start transcribing when a meeting is joined from the island |
| `meetingsDir` | `~/.local/share/omarchy-dynamic-island/meetings` | Where those files go |
| `bluetooth`, `camera`, `calendar` | `true` | Turn those activities off |
| `herdr` | `true` | Show herdr agents (see below) |
| `herdrToasts` | `true` | Toast when an agent needs you or finishes |
| `herdrInterval` | `5` | Seconds between asks to every herdr machine |
| `notifications` | `true` | Show notifications in the island (replaces Omarchy's notification popups) |
| `inbox` | `true` | Show the bell for notifications waiting in the inbox |
| `osd` | `true` | Show Omarchy's on-screen popups (volume, brightness, mic, …) in the island instead of at the bottom |
| `volume`, `brightness`, `charging`, `trackChange`, `recording`, `mic` | `true` | Turn individual activities off |

The island also replaces Omarchy's on-screen display: the popups at the
bottom of the screen for volume, brightness, microphone mute, keyboard
backlight, audio output, touchpad, power actions and downloads. It turns off
Omarchy's `omarchy.osd` plugin and answers the same `omarchy osd` calls, so
every key and script that popped the OSD now shows in the island. Set
`"osd": false` to go back to Omarchy's popups.

## Uninstalling

Disabling or removing the plugin gives back everything it took over: Omarchy's
notifications and on-screen display are switched back on, and its keybinding
is removed from `bindings.lua`. The plugin checks a
few seconds after it unloads, so a shell restart doesn't trigger this.

## Calendar

Open it by clicking the island when nothing is playing and then the date
(or the 󰃭 button), by clicking a meeting in the island, or with
`omarchy-shell dynamic-island calendar` (bind it to a key if you like).

![The calendar: a month view with event dots and the selected day's meetings](assets/calendar.webp)

It shows the month with today highlighted and a dot on every day that has
something on it; click a day to see its events, and click an event to open
its meeting link (Meet, Zoom, Teams). Press **+** to paste a calendar link (they are kept in
`~/.config/omarchy/dynamic-island/calendars.json`);
each added calendar has an × to remove it. Scripts can do the same with
`omarchy-shell dynamic-island addCalendar <link>` / `removeCalendar <link>`.

**Holidays** are on out of the box: the island picks your country from the
system timezone and shows its public holidays and festivals (from Google's
holiday calendars) as all-day entries, with today's festival next to the
date. In the calendar's **+** panel, tap **Holidays** to choose another
country (24 are available) or turn them off. The `"holidays"` setting does the
same: `"auto"`, `"off"`, or a country code like `"IN"`.

Any calendar that can give you an `.ics` link works:

* **Google Calendar**: Settings → your calendar → Integrate calendar → **"Secret
  address in iCal format"**. The "Public address" only works if the calendar
  is public (otherwise Google answers 404). Each calendar, and each Google
  account (personal, work), has its own secret address. Google refreshes these
  feeds on its own schedule, so a brand-new event can take a few hours to appear
* **iCloud**: share the calendar as a public calendar (a `webcal://` link works)
* **Outlook**: Settings → Shared calendars → Publish a calendar → ICS link
* **Nextcloud and Fastmail**: the calendar's export or subscription link

Local `.ics` files also work. Feeds are re-read every 15 minutes
(`calendarRefreshMinutes`), and the last fetch is cached in
`~/.cache/omarchy-dynamic-island/` so events show at once after a restart.
Daily, weekly, monthly and yearly repeats (birthdays) are understood, times
are converted from the event's own time zone (including Outlook's Windows
zone names), and a moved or cancelled single meeting replaces its slot in the
series. A feed over 4 MiB is trimmed to this month and the next.

An entry can carry a label and colour in front of the link, the same format
NextEvent uses, so its events get a coloured bar and a tag:

```json
"calendars": ["Work|#4285f4|https://…/work.ics", "Personal|https://…/personal.ics"]
```

Unlabelled feeds get a colour from a palette. The same event in two feeds is
shown once (the first feed wins), invites you declined are hidden (the owner
is taken from Google's secret address or the feed's calendar name), and
`"calendarExclude": "lunch, focus time"` hides events whose title contains any
of the keywords. Clicking an event opens its Meet, Zoom, Teams, Webex or GoTo
link in preference to any other link it carries.

### Calendar settings

The 󰒓 button in the calendar (or `omarchy-shell dynamic-island calendarSettings`)
opens the settings: paste a link, and for each calendar tap its colour to
change it, edit its label, and pick the **browser profile** its meetings open
in. Profiles are found automatically for Chrome, Chromium, Brave, Edge and
Vivaldi and shown by the account signed in to them. Below that are the
keywords to hide and the holiday calendar. All of it is kept in
`~/.config/omarchy/dynamic-island/` (`calendars.json`, `prefs.json`). The
island takes keyboard input only while the settings are open.

`omarchy-shell dynamic-island joinNext` opens the next meeting with a link
(bind it to a key).

For more control, the island reads the same launcher settings as the
NextEvent bar widget:

```json
"launchers": "{\"work\":\"google-chrome-stable --profile-directory='Profile 1'\",\"teams\":\"teams-for-linux\"}",
"calendarLaunchers": "{\"Work\":{\"default\":\"work\",\"teams\":\"teams\"}}",
"launcherRules": "[{\"match\":\"Book club\",\"launcher\":\"teams\"}]",
"browserCommand": "firefox"
```

A link opens with the first of: a matching rule (`match` on the title,
`provider`, `calendar` label), the calendar's launcher for that video
provider, the profile picked in the settings, the calendar's default
launcher, `browserCommand`, then `xdg-open`. Named launchers also appear in
the settings' profile list.

## Coding agents (herdr)

If [herdr](https://herdr.dev) is installed, the island follows the coding
agents it runs: the ones on this machine and the ones on every SSH machine
saved with `herdr machine add`. Only the live ones show up:

| State | Means | Looks like |
|---|---|---|
| **needs you** | herdr saw an approval or a question on screen | red |
| **done** | finished, and you have not looked at it yet | green |
| working | busy | accent, the robot breathes |

Idle agents ("ready") are not shown, so with nothing going on the island
stays quiet. When an agent starts waiting on you or finishes, a toast says
which one and where (machine · repo). Agents never take the pill: they
ride in the bubble beside whatever it shows (the resting ticker with your next
meeting, the calendar, a timer), and only when nothing else wants the bubble. Click the toast, or a row in the opened
list, to land on that agent, the way the herdr bar widget does: its pane is
focused on the machine running it (which also clears its "done"), then the
window attached to that machine comes up (`herdr --remote <ssh target>`, or
plain `herdr` for this machine). With no such window, one is opened in foot
with the widget's app id, so the two share windows.

The island asks every enabled machine at once every `herdrInterval` seconds
(`herdr --machine <id> agent list`). A machine that doesn't answer keeps what
it last reported. The local server is only asked while it is running, so the
island never starts one.

```bash
omarchy-shell dynamic-island agents          # the live agents, as JSON
omarchy-shell dynamic-island openAgents      # open the list
omarchy-shell dynamic-island demo agents     # preview: agents, agents-expanded, agent-done
```

## Assistant: approvals, diffs, plans and chat

With the island's daemon running, the island becomes a small personal
assistant for your coding agents. An Omarchy avatar sits in the resting pill
(drawn in your theme, tinted by the agent at work, its eyes following the
pointer) with a plan gauge beside it. It breathes and blinks when idle, reads
along with a typing badge while an agent works, hops with an amber "!" when one
needs you, smiles with a green check when it finishes, and bobs to music. Poke it to open
the workspace: icon tabs for Home, Chat, Plans and Settings, and + to start a new agent in
herdr.

| Piece | What it does |
|---|---|
| Approval card | When Claude Code asks for permission, the island opens by itself with the command or file, and **Allow**, **Always** (adds Claude's suggested rule), **Deny** and **Pane** (jump to its herdr pane). Questions (`AskUserQuestion`) show their options, one step at a time. Answering in the terminal instead works too; the card goes away |
| Home | One agent at a time (‹ › pages through them, the one that needs you first): its avatar, what it did this turn step by step (Read ✓, Edit ✓, Bash …, Done), the file it is changing shown like an editor tab, and the last command with the tail of its output (PASS/FAIL). Every session's diffs are kept (the last 50 per session, up to 4,000 lines each) |
| Plans | Every account's 5-hour and weekly usage, when each resets ("Resets in 1h 42m"), how many sessions use it, **Default** (new shells use it) and **herdr** (open a tab signed in to it). The pill is green below 50 %, orange to 80 % and red above |
| Meetings | Everything you transcribed, grouped by meeting title, newest first. Per meeting: open the summary or transcript, **Ask** (attaches the transcript to Chat), **To-dos** (asks the agent for decisions, action items and open questions) and delete (press twice). Opens with `SUPER + ALT + M` (`island-ctl meetings`) |
| Chat | Chat with Claude (any of your logins or an API key) or a local Ollama model from the island (tool-capable models such as Qwen3 get the same tools as Claude). Pick the model in the header. Hover a message and press 󰆏 to copy its text. `SUPER + A` opens a fresh chat on the defaults (Secretary, `chatModel`, the default account) with the cursor in the box; **Ctrl+A** switches Island/Secretary, **Ctrl+M** the model, **Ctrl+S** the account and **Ctrl+N** starts a new chat. Secretary runs like its `start.sh`: its `secretary.env` 1Password references are resolved once (one prompt, kept until the daemon restarts) and it has the Chrome tools Drop files on the island or press 󰹑 to capture a region with grim and slurp. The chat can list your agents, read a pane, see a session's diffs, read your transcribed meetings, and, after you allow it on the approval card, type into a pane, open a new herdr pane or apply a patch |

Set it up once from a checkout:

```bash
./install-hooks.sh               # add --keybinds for the keys below
```

It builds the daemon into `~/.local/share/omarchy-dynamic-island`, links
`island-hook`, `island-agent-daemon` and `island-ctl` into `~/.local/bin`,
starts the `omarchy-island-daemon` systemd user service, and adds the
island's hooks to `~/.claude/settings.json`. The file is backed up first
(`settings.json.island-backup-<time>`), your own hooks stay, and a file that
isn't valid JSON is left alone. The status line is chained: yours keeps
running and its output is shown as before, while the island reads the plan
numbers Claude Code passes to it. More logins: `--config-dir ~/.claude-work`
(repeatable), which also adds each one to `accounts.json`.
Undo everything with `./install-hooks.sh --uninstall`.

The hooks fail open. With the daemon down, or the island not answering,
Claude Code carries on exactly as without them. Approvals are held on the
`PermissionRequest` hook, so the island only asks when Claude Code itself
would ask you; `PreToolUse` only reports what the agent is doing.

### Keys

`./install-hooks.sh --keybinds` (or `island-ctl keybinds --install`) adds
these to `~/.config/hypr/bindings.lua`, skipping any key already taken.
Omarchy may already use `SUPER + A`; remove that binding first and run it
again, and Island Chat takes the key.
`island-ctl keybinds --print` shows them, including `hyprland.conf` lines.

| Key | Does |
|---|---|
| `SUPER + A` | Open or close Island Chat |
| `SUPER + SHIFT + A` | Open or close the workspace on Home |
| `SUPER + ALT + U` | Open or close the workspace on Plans (usage) |
| `SUPER + ALT + C` | Open or close the calendar |
| `SUPER + ALT + M` | Open the Meetings tab |
| `island-ctl transcribe` | Start or stop transcribing the meeting that is on now (not bound by default) |
| `SUPER + ALT + Y` | Allow the waiting request |
| `SUPER + ALT + N` | Deny the waiting request |
| `SUPER + ALT + J` | Jump to the agent that needs you |
| `SUPER + ALT + P` | Pin the workspace open |

```bash
island-ctl chat | agents | plans | settings   # open (or close) the workspace on a tab
island-ctl home | usage | calendar   # Home, Plans, the calendar
island-ctl approve | always | deny   # the oldest waiting request; works with the island down
island-ctl jump | pin | capture
island-ctl attach ~/notes.md         # attach a file to Island Chat
island-ctl profile work              # make an account the default
island-ctl state                     # as JSON
```

### Accounts

`~/.config/omarchy-dynamic-island/accounts.json` is created with your default
Claude login and a local Ollama. Each extra Claude login you install the hooks
into gets its profile there too:

```bash
./install-hooks.sh --config-dir ~/.claude-pythian --config-dir ~/.claude-lanvera
```

adds `pythian` and `lanvera` (named after the folder; rename the `label` as
you like). A login that already has a profile is left as it is. Other kinds
you add by hand:

```json
{
  "version": 1,
  "active": "claude",
  "profiles": [
    { "id": "claude", "label": "Personal", "kind": "claude" },
    { "id": "work", "label": "Work", "kind": "claude", "configDir": "~/.claude-work" },
    { "id": "api", "label": "API", "kind": "anthropic-api",
      "apiKeyCommand": "op read op://Private/Anthropic/credential" },
    { "id": "codex", "label": "Codex", "kind": "codex" },
    { "id": "ollama", "label": "Ollama", "kind": "ollama", "baseUrl": "http://127.0.0.1:11434" }
  ]
}
```

| Kind | Plan numbers from | Notes |
|---|---|---|
| `claude` | the status line of sessions using that `configDir` (Claude Code's `CLAUDE_CONFIG_DIR`), and Island Chat | `install-hooks.sh --config-dir DIR` adds the profile and the hooks |
| `anthropic-api` | none (it shows whether the key is there) | The key is never stored: `apiKeyEnv` names an environment variable, or `apiKeyCommand` prints it (`op read …`) |
| `codex` | `codex app-server` (`account/rateLimits/read`) | `codexHome` for a second login |
| `ollama` | whether the server answers, and its models | Chat only |

**Default** writes `active-profile.env` (and an `active-claude` symlink) next
to accounts.json. To have new shells use it, add this to `~/.bashrc`:

```bash
[ -f ~/.config/omarchy-dynamic-island/active-profile.env ] && . ~/.config/omarchy-dynamic-island/active-profile.env
```

### Secretary

If the Secretary folder (the 󰒓 Settings tab, or `secretaryPath` in the
island's entry in `~/.config/omarchy/shell.json`, default `~/secretary`) points to a checkout of your
[secretary](https://github.com/DanielUlisses/secretary) repo, Island Chat's
header gets a **Secretary** switch. In that workspace the chat runs in the
repo with its `CLAUDE.md`, rules and skills (`/refresh`, `/book-time`,
`/mail`, `/meetings`, …) and the Claude login you picked, so "plan my day" or
"what did I book this week" works from the island. It runs in auto mode:
Claude Code's classifier approves or denies each tool call, and only the ones
it can't decide come to the approval card. Its own rules (preview every
write and wait for an ok, secrets only as `op://` references) still apply.

`~/.config/omarchy-dynamic-island/daemon.json` (optional): `herdrInterval`
(seconds, default 4) and `reportToHerdr` (default `true`: a waiting approval
also shows as "blocked" in herdr's sidebar).

## MacBook notch

On a MacBook with a notch, keep the default `"style": "notch"` and set the island to the
size of the notch so it looks like the notch itself coming alive:

```json
{ "id": "omarchy-dynamic-island", "style": "notch",
  "background": "black", "notchWidth": 200, "notchHeight": 32, "notchRadius": 10 }
```

`notchWidth` and `notchHeight` are in the same pixels as the rest of the
island. Adjust them until the idle island exactly covers the cutout; the
settings apply as soon as you save. Live activities then grow out to both
sides of the camera, like on an iPhone. This hasn't been tried on Apple
Silicon hardware yet. If your notch area is hidden by the kernel (the
default on Asahi Linux), the island simply sits in the black band there.

## Scripting

```bash
omarchy-shell dynamic-island toast "Build finished" "0 errors" "󰄬" green
omarchy-shell dynamic-island toggle        # bind it to a key in hyprland.conf
omarchy-shell dynamic-island reserveSpace toggle   # on | off | toggle: windows below the island or under it
omarchy-shell dynamic-island state         # JSON snapshot
omarchy-shell dynamic-island demo media    # preview: media paused split recording mic recording-expanded
                                           # volume brightness charging lowbattery notification
                                           # notification-actions inbox
                                           # track toast expanded idle-expanded timer stopwatch
                                           # activity calendar camera device outputs
                                           # agents agents-expanded agent-done off
```

Timers, the stopwatch, and live activities for your own scripts:

```bash
omarchy-shell dynamic-island timer 25m "Focus"     # also 90s, 1h30m, 10:00, or plain minutes
omarchy-shell dynamic-island timerToggle           # pause / resume
omarchy-shell dynamic-island timerCancel
omarchy-shell dynamic-island stopwatch toggle      # start | pause | toggle | reset

# Start or update a live activity (all fields optional):
omarchy-shell dynamic-island activity backup \
  '{"title":"Backing up","subtitle":"~/Projects","icon":"󰁯","progress":0.4,"value":"4/10","color":"green","ttl":600}'
# End it, optionally with a closing message:
omarchy-shell dynamic-island endActivity backup "Backup complete"
```

`ttl` (seconds) ends an activity by itself if the script dies without ending
it.

A toast's color can be `accent`, `green`, `orange`, `red`, `foreground` or a hex
value.

For example, to have a long command tell you when it's done:

```bash
make && omarchy-shell dynamic-island toast "make" "done" "󰄬" green \
     || omarchy-shell dynamic-island toast "make" "failed" "󰅚" red
```

## Development

`dev-install.sh` copies the working tree into
`~/.config/omarchy/plugins/omarchy-dynamic-island` and validates it. The
shell does not always pick up a changed entry file for a keep-loaded panel on
hot reload, so run `omarchy restart shell` after editing `Island.qml`.

Files:

* `Island.qml`: state machine, data sources, window and IPC
* `IslandModel.js`: pure logic (sizes, priorities, formatting, player choice)
* `views/`: one file per island state, plus shared pieces
* `sources/Assistant.qml`: the socket to island-agent-daemon
* `daemon/`: island-agent-daemon and island-hook (TypeScript; `npm test` builds and runs the tests)
* `scripts/island-ctl`, `install-hooks.sh`: keybind commands and the assistant's setup

## License

MIT
