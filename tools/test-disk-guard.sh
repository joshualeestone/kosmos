#!/usr/bin/env bash
# The disk guard goes red on purpose, and green, before anyone trusts it (#736).
# Each outcome is captured into variables first and judged with case, so no
# status is ever read through a pipe (#632).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib/disk-guard.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }
printf '#!/bin/sh\nprintf "Filesystem 1M-blocks Used Available Capacity Mounted on\\n/dev/disk9 100000 98976 1024 99%%%% /Volumes/Tiny\\n"\n' > "$T/df-tiny"; chmod +x "$T/df-tiny"
printf '#!/bin/sh\nprintf "Filesystem 1M-blocks Used Available Capacity Mounted on\\n/dev/disk3 228000 176800 51200 78%%%% /\\n"\n' > "$T/df-big"; chmod +x "$T/df-big"
printf '#!/bin/sh\nexit 1\n' > "$T/df-dead"; chmod +x "$T/df-dead"

out="$(KOSMOS_DF="$T/df-tiny" kosmos_require_free_mb 2048 /tmp "the harness" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "refuses at 1 GB free when 2 GB are needed"; else fail "refuses at 1 GB free when 2 GB are needed (rc=$rc)"; fi
if has "$out" "/Volumes/Tiny"; then pass "and names the disk"; else fail "and names the disk: $out"; fi
if has "$out" "only 1024 MB free" && has "$out" "about 2048 MB"; then pass "and says the numbers"; else fail "and says the numbers: $out"; fi

out="$(KOSMOS_DF="$T/df-big" kosmos_require_free_mb 2048 /tmp "the harness" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ -z "$out" ]; then pass "passes at 50 GB free, silently"; else fail "passes at 50 GB free (rc=$rc, out=$out)"; fi

out="$(KOSMOS_DF="$T/df-dead" kosmos_require_free_mb 2048 /tmp "the harness" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "could not read free space"; then pass "a df that cannot answer is a refusal, not a pass"; else fail "a df that cannot answer is a refusal (rc=$rc, out=$out)"; fi

out="$(kosmos_require_free_mb 1 / "a real look" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ]; then pass "the real df on this Mac is readable (1 MB needed)"; else fail "the real df on this Mac is readable: $out"; fi

echo "disk guard: $fails failures"; [ "$fails" -eq 0 ]
