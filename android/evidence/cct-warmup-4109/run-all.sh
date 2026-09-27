#!/usr/bin/env bash
# #4109 measurement run: gate, boot, four arms of seven cold runs, shut down.
set -uo pipefail
W=/Users/mortalkombat/work/agent-workforce-cct-warmup-4109
S=/opt/homebrew/share/android-commandlinetools
ADB=$S/platform-tools/adb
D=/Users/mortalkombat/work/workers/sonyablade/scratch-4109
H=$W/android/evidence/cct-warmup-4109/measure-cold-paint.py
GATE=/Users/mortalkombat/work/agent-workforce/tools/heavy-gate.sh

wait_gate() {
  local i=0 rc
  while :; do
    bash "$GATE" --twice --except-cwd "$W" --quiet; rc=$?
    [ "$rc" = 0 ] && { echo "gate CLEAR after $i busy reads at $(date -u +%FT%TZ)"; return 0; }
    [ "$rc" = 2 ] && { echo "gate exit 2"; return 2; }
    i=$((i + 1)); [ "$i" -ge 60 ] && { echo "gate still BUSY after ~2h"; return 1; }
    sleep 120
  done
}

wait_gate || exit 1
"$S/emulator/emulator" -avd moto-g-play-2024-api35 -gpu host -no-snapshot-save -no-boot-anim > "$D/emulator.log" 2>&1 &
"$ADB" wait-for-device
for i in $(seq 1 120); do
  [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && { echo "booted after $((i * 2))s"; break; }
  sleep 2
done
"$ADB" shell wm size; "$ADB" shell wm density
"$ADB" shell dumpsys package com.android.chrome | grep -m1 versionName
sleep 30   # let the post-boot work settle, the same for every arm

rc=0
for arm in before:before-ee8836281.apk bindonly:armA-bind-only.apk bindpreload:armB-bind-mayLaunch.apk before2:before-ee8836281.apk; do
  label=${arm%%:*}; apk=${arm#*:}
  wait_gate || { rc=1; break; }
  python3 "$H" "$D/$apk" "$label" 7 || rc=1
done
"$ADB" emu kill
echo "ALL_DONE rc=$rc"
exit $rc
