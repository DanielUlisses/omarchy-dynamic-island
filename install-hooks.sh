#!/bin/bash
# Set up the island's assistant: build island-agent-daemon, link island-hook,
# island-agent-daemon, island-ctl, herdr-open and devbox-open into ~/.local/bin,
# run the daemon as a systemd user service, register herdr-open for herdr://
# links and devbox-open for devbox:// links, and
# add the island's hooks (and plan-reading status line) to Claude Code's settings. Safe to re-run; every step is idempotent.
#
#   ./install-hooks.sh                       ~/.claude (or $CLAUDE_CONFIG_DIR)
#   ./install-hooks.sh --config-dir ~/.claude-work   also another Claude login,
#                                            added to accounts.json (repeatable)
#   ./install-hooks.sh --no-statusline       leave the status line alone
#   ./install-hooks.sh --keybinds            also bind SUPER + A, SUPER + ALT + Y/N/J/P
#   ./install-hooks.sh --uninstall           undo all of it (keeps accounts.json)
#
# settings.json is backed up beside itself (settings.json.island-backup-<time>)
# before each change and written atomically; a file that isn't valid JSON is
# left untouched.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
share="${XDG_DATA_HOME:-$HOME/.local/share}/omarchy-dynamic-island"
bin="$HOME/.local/bin"
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
unit="omarchy-island-daemon.service"
apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
opener="omarchy-herdr-open.desktop"
boxopener="omarchy-devbox-open.desktop"

uninstall=false keybinds=false hook_args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --uninstall) uninstall=true ;;
    --keybinds) keybinds=true ;;
    --no-statusline) hook_args+=("--no-statusline") ;;
    --config-dir) hook_args+=("--config-dir" "$2"); shift ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\033[1m%s\033[0m\n' "$*"; }

reload_shell() {
  command -v omarchy-shell >/dev/null || return 0
  omarchy-shell shell rescanPlugins >/dev/null 2>&1 || true
}

if $uninstall; then
  say "Removing the island's hooks from Claude Code"
  [ -x "$bin/island-hook" ] && "$bin/island-hook" --uninstall-hooks "${hook_args[@]}" || true
  [ -x "$bin/island-ctl" ] && "$bin/island-ctl" keybinds --uninstall >/dev/null || true
  say "Stopping the daemon"
  systemctl --user disable --now "$unit" 2>/dev/null || true
  rm -f "$units/$unit"
  systemctl --user daemon-reload 2>/dev/null || true
  for f in island-hook island-agent-daemon island-ctl herdr-open devbox-open; do
    [ -L "$bin/$f" ] && rm -f "$bin/$f"
  done
  rm -f "$apps/$opener" "$share/herdr-open" "$apps/$boxopener" "$share/devbox-open"
  command -v update-desktop-database >/dev/null && update-desktop-database "$apps" >/dev/null 2>&1 || true
  rm -rf "$share/daemon"
  echo "Done. ~/.config/omarchy-dynamic-island (accounts.json) was kept."
  exit 0
fi

for need in node npm jq; do
  command -v "$need" >/dev/null || { echo "install-hooks.sh needs $need (sudo pacman -S nodejs npm jq)" >&2; exit 1; }
done

say "Building island-agent-daemon in $share/daemon"
mkdir -p "$share/daemon"
rm -rf "$share/daemon/src" "$share/daemon/test" "$share/daemon/bin" "$share/daemon/scripts" "$share/daemon/dist"
( cd "$here/daemon" && tar cf - --exclude ./node_modules --exclude ./dist . ) | ( cd "$share/daemon" && tar xf - )
( cd "$share/daemon" && npm ci --no-audit --no-fund --loglevel=error && npm run --silent build )

say "Linking commands into $bin"
mkdir -p "$bin"
ln -sfn "$share/daemon/bin/island-hook" "$bin/island-hook"
ln -sfn "$share/daemon/bin/island-agent-daemon" "$bin/island-agent-daemon"
install -m 755 "$here/scripts/island-ctl" "$share/island-ctl"
ln -sfn "$share/island-ctl" "$bin/island-ctl"
install -m 755 "$here/scripts/herdr-open" "$share/herdr-open"
ln -sfn "$share/herdr-open" "$bin/herdr-open"
install -m 755 "$here/scripts/devbox-open" "$share/devbox-open"
ln -sfn "$share/devbox-open" "$bin/devbox-open"
case ":$PATH:" in *":$bin:"*) ;; *) echo "  note: $bin is not on your PATH" ;; esac

say "Starting the daemon (systemd user service $unit)"
mkdir -p "$units"
cat >"$units/$unit" <<EOF
[Unit]
Description=Omarchy Dynamic Island agent daemon (hooks, approvals, plans, chat)
# Started with the graphical session, not at login: the session's WAYLAND_DISPLAY, DISPLAY and
# XDG_SESSION_TYPE reach the systemd user manager only then, and the agents the daemon spawns
# need them to open a browser (xdg-open, Python's webbrowser).
PartOf=graphical-session.target
After=graphical-session.target

[Service]
ExecStart=$bin/island-agent-daemon
Restart=on-failure
RestartSec=3
Environment=PATH=$bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=graphical-session.target
EOF
if systemctl --user daemon-reload 2>/dev/null; then
  # reenable: drops an older install's default.target link
  systemctl --user reenable "$unit" >/dev/null 2>&1 || true
  systemctl --user restart "$unit"
else
  echo "  no systemd user session; the island starts $bin/island-agent-daemon by itself"
fi

say "Registering herdr-open for herdr:// links (the hub's Herdr button)"
mkdir -p "$apps"
cat >"$apps/$opener" <<EOF
[Desktop Entry]
Type=Application
Name=Herdr session
Comment=Open a herdr:// link in a terminal attached to that box
Exec=$bin/herdr-open %u
NoDisplay=true
Terminal=false
MimeType=x-scheme-handler/herdr;
EOF
command -v update-desktop-database >/dev/null && update-desktop-database "$apps" >/dev/null 2>&1 || true
command -v xdg-mime >/dev/null && xdg-mime default "$opener" x-scheme-handler/herdr || true

say "Registering devbox-open for devbox:// links (the hub's Terminal button)"
cat >"$apps/$boxopener" <<EOF
[Desktop Entry]
Type=Application
Name=Devbox session
Comment=Open a devbox:// link in a terminal attached to that session's tmux pane
Exec=$bin/devbox-open %u
NoDisplay=true
Terminal=false
MimeType=x-scheme-handler/devbox;
EOF
command -v update-desktop-database >/dev/null && update-desktop-database "$apps" >/dev/null 2>&1 || true
command -v xdg-mime >/dev/null && xdg-mime default "$boxopener" x-scheme-handler/devbox || true

say "Adding the island's hooks to Claude Code"
"$bin/island-hook" --install-hooks "${hook_args[@]}"

if $keybinds; then
  say "Adding keybindings to ~/.config/hypr/bindings.lua"
  "$bin/island-ctl" keybinds --install || true
fi

reload_shell

plugin="$HOME/.config/omarchy/plugins/omarchy-dynamic-island"
[ -d "$plugin" ] || echo "  note: the island plugin isn't installed yet; run ./dev-install.sh and enable it"

cat <<EOF

Done. Running Claude Code sessions pick the hooks up when they restart.

  Accounts:   ${XDG_CONFIG_HOME:-$HOME/.config}/omarchy-dynamic-island/accounts.json
  Default:    island-ctl profile <id>, or "Default" on the Plans tab.
              For new shells to follow it, add to ~/.bashrc:
                [ -f ~/.config/omarchy-dynamic-island/active-profile.env ] && . ~/.config/omarchy-dynamic-island/active-profile.env
  Keybinds:   island-ctl keybinds --install   (or --print for hyprland.conf lines)
EOF
