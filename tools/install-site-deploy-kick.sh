#!/bin/bash
# kosmos#6266: install (or remove) the launchd job that runs tools/site-deploy-kick.sh every 15 minutes on Mortals,
# the box with the site's self-hosted runner and the gh login that may dispatch its workflow. Run it ON Mortals, as
# the runner's user, from a kosmos checkout. It loads into gui/<uid>, so that user needs a logged-in desktop session
# (Mortals logs in at boot); from a bare ssh session with none, bootstrap fails and this says so:
#   bash tools/install-site-deploy-kick.sh              install or refresh (copies the script, loads the job)
#   bash tools/install-site-deploy-kick.sh --uninstall  stop the job and remove both files
# The script is COPIED into ~/.local/libexec/kosmos-site-deploy-kick/ (as Mortals' com.stonesyndicate.kosmos-review-pending
# job keeps its script in ~/.local/libexec/kosmos-review/), so the job never runs from a checkout that a branch switch
# or a cut changes. Re-run after the script changes on main.
# After installing, check it runs under launchd (its gh login, PATH and keychain are launchd's, not this shell's):
#   bash ~/.local/libexec/kosmos-site-deploy-kick/kick.sh --check     what a tick would decide, dispatching nothing
#   launchctl print gui/$(id -u)/com.stonesyndicate.kosmos-site-deploy-kick | grep -E 'state|last exit code'
#   cat ~/.local/libexec/kosmos-site-deploy-kick/last-tick            the time of the last tick launchd ran
# To stop dispatching without uninstalling, create ~/.kosmos-site-autodeploy/paused (it stops the deploy job too).
# Env (tests only): KOSMOS_KICK_HOME (the home it installs into), KOSMOS_LAUNCHCTL (the launchctl to call).
set -eu
HOME_DIR="${KOSMOS_KICK_HOME:-$HOME}"
LAUNCHCTL="${KOSMOS_LAUNCHCTL:-/bin/launchctl}"
LABEL=com.stonesyndicate.kosmos-site-deploy-kick
DIR="$HOME_DIR/.local/libexec/kosmos-site-deploy-kick"
PLIST="$HOME_DIR/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
SRC="$(cd "$(dirname "$0")" && pwd)/site-deploy-kick.sh"

if [ "${1:-}" = "--uninstall" ]; then
  "$LAUNCHCTL" bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
  rm -f "$PLIST"
  rm -f "$PLIST.new"
  rm -f "$DIR/kick.sh" "$DIR/kick.sh.new" "$DIR/kick.log" "$DIR/last-tick"
  rmdir "$DIR" 2>/dev/null || true
  echo "removed $LABEL"
  exit 0
fi
[ $# -eq 0 ] || { echo "usage: $0 [--uninstall]" >&2; exit 2; }
[ -f "$SRC" ] || { echo "cannot find $SRC" >&2; exit 1; }

mkdir -p "$DIR" "$(dirname "$PLIST")"
cp "$SRC" "$DIR/kick.sh.new" && chmod 755 "$DIR/kick.sh.new" && mv "$DIR/kick.sh.new" "$DIR/kick.sh"
cat > "$PLIST.new" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$DIR/kick.sh</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>KOSMOS_KICK_HEARTBEAT</key><string>$DIR/last-tick</string>
    <key>HOME</key><string>$HOME_DIR</string>
    <key>LANG</key><string>en_US.UTF-8</string>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$DIR/kick.log</string>
  <key>StandardErrorPath</key><string>$DIR/kick.log</string>
</dict>
</plist>
PLIST
mv "$PLIST.new" "$PLIST"
"$LAUNCHCTL" bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
# A bootstrap right after a bootout can fail while launchd is still tearing the old job down; try once more.
if ! "$LAUNCHCTL" bootstrap "$DOMAIN" "$PLIST" 2>/dev/null; then
  sleep 2
  "$LAUNCHCTL" bootstrap "$DOMAIN" "$PLIST" || { echo "the files are in place but launchd did not load $LABEL; run: launchctl bootstrap $DOMAIN $PLIST" >&2; exit 1; }
fi
echo "installed $LABEL: $DIR/kick.sh every 15 minutes, log $DIR/kick.log, heartbeat $DIR/last-tick"
