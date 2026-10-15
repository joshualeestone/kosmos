#!/bin/bash
# kosmos#6266: install (or remove) the launchd job that runs tools/site-deploy-kick.sh every 15 minutes on Mortals,
# the box with the site's self-hosted runner and the gh login that may dispatch its workflow. Run it ON Mortals, as
# the runner's user, from a kosmos checkout:
#   bash tools/install-site-deploy-kick.sh              install or refresh (copies the script, loads the job)
#   bash tools/install-site-deploy-kick.sh --uninstall  stop the job and remove both files
# The script is COPIED into ~/.local/libexec/kosmos-site-deploy-kick/ (the pattern of the box's other ops jobs), so the
# job never runs from a checkout that a branch switch or a cut changes. Re-run after the script changes on main.
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
  rm -f "$DIR/kick.sh" "$DIR/kick.log"
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
"$LAUNCHCTL" bootstrap "$DOMAIN" "$PLIST"
echo "installed $LABEL: $DIR/kick.sh every 15 minutes, log $DIR/kick.log"
