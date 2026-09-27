#!/usr/bin/env bash
# #4109 control: is today's 1.3 s baseline the harness or the app? Runs the exact APK #4101
# measured (sha256 04e1bd7d..., stock LauncherActivity) and today's main back to back, gated.
set -uo pipefail
W=/Users/mortalkombat/work/agent-workforce-cct-warmup-4109
S=/opt/homebrew/share/android-commandlinetools
ADB=$S/platform-tools/adb
D=/Users/mortalkombat/work/workers/sonyablade/scratch-4109
H=$W/android/evidence/cct-warmup-4109/measure-cold-paint.py
GATE=/Users/mortalkombat/work/agent-workforce/tools/heavy-gate.sh
OLD=/Users/mortalkombat/work/workers/liukang/Files/Kosmos-android-test.apk

bash "$GATE" --twice --except-cwd "$W" || exit 1
"$S/emulator/emulator" -avd moto-g-play-2024-api35 -gpu host -no-snapshot-save -no-boot-anim > "$D/emulator-control.log" 2>&1 &
"$ADB" wait-for-device
for i in $(seq 1 120); do
  [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && { echo "booted after $((i * 2))s"; break; }
  sleep 2
done
sleep 30
rc=0
KOSMOS_LAUNCH_COMPONENT=io.kosmos.app/com.google.androidbrowserhelper.trusted.LauncherActivity \
  python3 "$H" "$OLD" apk4101 7 || rc=1
python3 "$H" "$D/before-ee8836281.apk" before3 7 || rc=1
"$ADB" emu kill
echo "ALL_DONE rc=$rc"
exit $rc
