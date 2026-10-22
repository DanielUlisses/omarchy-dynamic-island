#!/usr/bin/env bash
# Every herdr machine's agent list in one go, the same poll the island's
# sources/Herdr.qml runs on its own when the daemon is not there. Each
# section starts with "@@HERDR <id> <target> <session> <label>" and is
# followed by that machine's `herdr agent list` JSON. The local server is only
# asked while it is running, so a poll never starts one.
command -v herdr >/dev/null 2>&1 || { echo @@NOHERDR; exit 0; }
d=$(mktemp -d) || exit 1
trap 'rm -rf "$d"' EXIT
if herdr session list --json 2>/dev/null | jq -e '.sessions[]? | select(.default and .running)' >/dev/null 2>&1; then
  echo 'local - default' > "$d/m0"
  (timeout 6 herdr agent list > "$d/0" 2>/dev/null) &
fi
i=1
while IFS=$'\t' read -r id target session label; do
  [[ $id =~ ^[A-Za-z0-9_-]{1,64}$ ]] || continue
  [[ $target =~ ^(ssh://)?([A-Za-z0-9._-]+@)?[A-Za-z0-9._-]+(:[0-9]{1,5})?$ ]] || target=-
  [[ $session =~ ^[A-Za-z0-9._-]{1,64}$ ]] || session=default
  printf '%s %s %s %s\n' "$id" "$target" "$session" "$label" > "$d/m$i"
  (timeout 8 herdr --machine "$id" agent list > "$d/$i" 2>/dev/null) &
  i=$((i + 1))
done < <(herdr machine list --json 2>/dev/null | jq -r '.[]? | select(.enabled != false)
  | [.id, (.target // "-"), (.session // "default"), (.label // "")] | @tsv' 2>/dev/null)
wait
for ((j = 0; j < i; j++)); do
  [ -f "$d/m$j" ] || continue
  printf '@@HERDR %s\n' "$(head -c 200 "$d/m$j")"
  head -c 1048576 "$d/$j" 2>/dev/null
  echo
done
