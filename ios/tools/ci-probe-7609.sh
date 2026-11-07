#!/bin/bash
# kosmos#7609 throwaway: on GitHub's runner, what is busy while "attach-panel" takes 30 s to find at the largest text.
# Never merged. Sample data only.
set -u
D="${RUNNER_TEMP:-/tmp}/probe"; mkdir -p "$D"; L="$D/xb.log"; : > "$L"
echo "RUNNER ncpu=$(sysctl -n hw.ncpu) mem=$(sysctl -n hw.memsize) xcode=$(xcodebuild -version | paste -sd ' ' -)"
U=$(xcrun simctl create probe-7609 com.apple.CoreSimulator.SimDeviceType.iPhone-17e com.apple.CoreSimulator.SimRuntime.iOS-26-5) || exit 4
xcrun simctl boot "$U"; xcrun simctl bootstatus "$U" -b >/dev/null
apppid() { ps -axo pid=,command= | grep "Devices/$U/.*Kosmos.app/Kosmos" | grep -v grep | awk 'NR==1{print $1}'; }
watch_marker() { # $1 marker, $2 file prefix
  local seen=0 n arm pid
  while :; do
    n=$(grep -c "^$1 " "$L")
    if [ "$n" -gt "$seen" ]; then
      seen=$n; arm=$(grep "^$1 " "$L" | tail -1 | cut -d' ' -f2); pid=$(apppid)
      sleep 2
      echo "CPU $1 $arm #$n pid=$pid before=$(ps -o cputime= -p "$pid")" >> "$D/cpu.log"
      top -l 2 -s 3 -o cpu -n 10 -stats pid,command,cpu,time,state | tail -n 12 > "$D/top-$2-$arm-$n.txt" &
      /usr/bin/sample "$pid" 10 -file "$D/sample-$2-$arm-$n.txt" >/dev/null 2>&1
      wait %+ 2>/dev/null
      echo "CPU $1 $arm #$n after10s=$(ps -o cputime= -p "$pid")" >> "$D/cpu.log"
    fi
    sleep 1
  done
}
watch_marker PROBE-HOLD hold & W1=$!
watch_marker PROBE-QUERY query & W2=$!
cd "$GITHUB_WORKSPACE/ios" || exit 3
only="-only-testing:KosmosUITests/AttachMenuUITests"
# shellcheck disable=SC2086
TEST_RUNNER_KOSMOS_UI_PLUS=1 xcodebuild test -project Kosmos.xcodeproj -scheme Kosmos -destination "id=$U" $only -test-iterations 3 -parallel-testing-enabled NO -derivedDataPath "$D/dd" -resultBundlePath "$D/res.xcresult" > "$L" 2>&1
echo "REAL_EXIT=$?"
DATA=$(xcrun simctl get_app_container "$U" io.kosmos.app data); wc -l "$DATA/Documents/changes.txt"
cp "$DATA/Documents/changes.txt" "$D/changes.txt"
awk '/^START/{n++; print "== launch " n ": " $0} !/^START/{c[n" "$0]++} END{for(k in c) if (c[k]>20) print c[k], k}' "$D/changes.txt" | sort -k2,2n -k1,1rn | cut -c1-170 | tail -n 120
kill "$W1" "$W2" 2>/dev/null
grep -E '^PROBE|^Test [Cc]ase .*(passed|failed)' "$L" | cut -c1-220
echo "=== cpu"; cat "$D/cpu.log"
for f in "$D"/top-query-*-1.txt "$D"/top-query-*-4.txt; do [ -f "$f" ] && { echo "=== $f"; cat "$f"; }; done
exit 0
