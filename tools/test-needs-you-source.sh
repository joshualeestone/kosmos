#!/bin/bash
# needs-you-source.js, arm by arm, against fixture records.
#
# 🛑 THE ARM THAT MATTERS IS ARM 3: the tool must be able to print the
# UNCOMFORTABLE conclusion. A measurement whose instrument can only ever return
# "load-bearing on the scrape" is not evidence for that sentence, it is a
# decoration on it -- and this repo has spent a week finding checks that could
# not return the dangerous answer. If arm 3 ever stops passing, every other
# number this tool prints stops counting.
#
# ⚠️ ASSERTIONS MATCH ON WORDS, NEVER ON COLUMN PADDING. An earlier version
# matched "      1  written by the permission hook" and so coupled six arms to
# pad()'s width, where a cosmetic column change turns them red for a reason
# unrelated to what they test.
#
# Fixtures are driven through --dir, so nothing here reads or writes the live
# record. That promise rests on --dir never falling back, which arm 7 checks.
set -u
cd "$(dirname "$0")/.." || exit 1
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
run() { node tools/needs-you-source.js --dir "$1" 2>&1; }

line() { printf '{"v":1,"state":"%s","because":"%s","at":"2026-08-28T00:00:00.000Z"}\n' "$1" "$2"; }
filler() { local n="$1" i=0; while [ "$i" -lt "$n" ]; do line working "doing a thing"; i=$((i+1)); done; }
# Match on a count and a phrase without depending on pad() width.
has() { printf '%s\n' "$1" | grep -qE "^[[:space:]]*$2[[:space:]]+$3"; }

# --- ARM 1: every red written by the hook -> "no self-reported source at all"
mkdir -p "$T/hookonly"
{ filler 100; line needs_you "asking permission to use Bash: ls"; } > "$T/hookonly/alice.jsonl"
out="$(run "$T/hookonly")"
case "$out" in
  *"No working agent has EVER typed needs_you"*) ok "arm 1: hook-written reds are not counted as agent-typed" ;;
  *) bad "arm 1: a hook-only record did not read as zero agent-typed"; printf '%s\n' "$out" | tail -5 ;;
esac
has "$out" 1 "written by the permission hook" \
  && ok "arm 1: the hook line is counted, not merely excluded" \
  || bad "arm 1: the hook count is wrong"

# --- ARM 2: a rare agent-typed red -> the load-bearing conclusion
mkdir -p "$T/rare"
{ filler 2000; line needs_you "May I merge the PR?"; } > "$T/rare/bob.jsonl"
out="$(run "$T/rare")"
case "$out" in
  *"load-bearing on the PANE READER"*) ok "arm 2: one working agent under the cutoffs reads as load-bearing on the scrape" ;;
  *) bad "arm 2: the low-rate conclusion did not print"; printf '%s\n' "$out" | tail -6 ;;
esac

# --- 🔑 ARM 3, THE ONE THAT MAKES THE OTHERS EVIDENCE: agents using the verb
#     must produce the OPPOSITE conclusion.
mkdir -p "$T/used"
{ filler 90; i=0; while [ "$i" -lt 10 ]; do line needs_you "which of these two should I build?"; i=$((i+1)); done; } > "$T/used/carol.jsonl"
out="$(run "$T/used")"
case "$out" in
  *"working agents ARE reporting this state themselves"*) ok "arm 3: the tool CAN say the sentence in status.js no longer holds" ;;
  *) bad "arm 3: the tool cannot produce the uncomfortable answer -- its other outputs are worthless"; printf '%s\n' "$out" | tail -6 ;;
esac
case "$out" in
  *"load-bearing on the PANE READER"*) bad "arm 3: it printed BOTH conclusions" ;;
  *) ok "arm 3: it does not also print the conclusion it just contradicted" ;;
esac

# --- 🔑 ARM 3b: THE DISTINCT-AGENT CUTOFF, which is the half that does not
#     drift. Three working agents typing ONE red each, in a record big enough
#     that the SHARE stays under the cutoff, must still read as adoption.
#     Without this the verdict rests entirely on a share whose denominator is
#     77% heartbeats and rises on its own every day.
mkdir -p "$T/spread"
filler 3000 > "$T/spread/dana.jsonl"
for who in ea fi gi; do line needs_you "should I go ahead?" > "$T/spread/$who.jsonl"; done
out="$(run "$T/spread")"
case "$out" in
  *"working agents ARE reporting this state themselves"*) ok "arm 3b: adoption spread thin across agents still trips the verdict" ;;
  *) bad "arm 3b: three distinct agents using the verb read as no adoption"; printf '%s\n' "$out" | tail -8 ;;
esac

# --- 🔑 ARM 3c: A FIXTURE RUN MUST NOT FLIP THE VERDICT. 14 of the 15
#     agent-typed records on this machine belong to walk-* fixtures; one more
#     walkthrough at that volume would otherwise print "agents ARE reporting"
#     on the strength of test traffic, telling a reader that correct shipped
#     documentation is stale.
mkdir -p "$T/fixture"
filler 90 > "$T/fixture/hal.jsonl"
{ i=0; while [ "$i" -lt 30 ]; do line needs_you "waiting on you, this project is empty"; i=$((i+1)); done; } > "$T/fixture/walk-cedar.jsonl"
out="$(run "$T/fixture")"
case "$out" in
  *"No working agent has EVER typed needs_you"*) ok "arm 3c: heavy fixture traffic does not flip the verdict" ;;
  *) bad "arm 3c: a walkthrough fixture moved the verdict"; printf '%s\n' "$out" | tail -8 ;;
esac
has "$out" 30 "typed by a walkthrough FIXTURE" \
  && ok "arm 3c: and the fixture records are still counted and shown" \
  || bad "arm 3c: fixture records were dropped rather than separated"

# --- ARM 4: the impossible-state control must be able to move.
mkdir -p "$T/planted"
{ filler 10; line zzz_no_such_state "planted"; } > "$T/planted/dave.jsonl"
out="$(run "$T/planted")"
has "$out" 1 "a state no writer can produce" \
  && ok "arm 4: the impossible-state control reads non-zero when one is planted" \
  || bad "arm 4: the control cannot detect a planted impossible state, so its 0 on live data means nothing"
out="$(run "$T/rare")"
has "$out" 0 "a state no writer can produce" \
  && ok "arm 4: and reads zero on a clean record" \
  || bad "arm 4: the control is non-zero on a clean fixture"

# --- ARM 5: a MISSING record is refused, not reported as an answer.
out="$(run "$T/does-not-exist")"; rc=$?
case "$out" in
  *"there is no self-report record at"*"not an answer"*) ok "arm 5: a missing record refuses to be read as a finding" ;;
  *) bad "arm 5: a missing record produced a conclusion"; printf '%s\n' "$out" ;;
esac
[ "$rc" -ne 0 ] && ok "arm 5: and exits non-zero" || bad "arm 5: a missing record exited 0"

# --- 🔑 ARM 5b: an EMPTY-BUT-EXISTING record is the same non-result arriving
#     by a different door, and it used to print the tool's STRONGEST
#     conclusion from zero data. A fresh machine, a wrong --dir, or
#     AGENT_WORKFORCE_DATA pointed at a seeded test root all land here.
mkdir -p "$T/empty"
out="$(run "$T/empty")"; rc=$?
case "$out" in
  *"EMPTY"*"Nothing below can be concluded"*) ok "arm 5b: an empty record refuses, rather than reading as no adoption" ;;
  *) bad "arm 5b: an EMPTY record produced a conclusion from zero data"; printf '%s\n' "$out" | tail -6 ;;
esac
[ "$rc" -ne 0 ] && ok "arm 5b: and exits non-zero" || bad "arm 5b: an empty record exited 0"
case "$out" in
  *"has, in practice, almost no self-reported source"*|*"No working agent has EVER typed"*)
    bad "arm 5b: it printed a verdict anyway" ;;
  *) ok "arm 5b: and prints no verdict at all" ;;
esac

# --- 🔑 ARM 5c: UNREADABLE is not ABSENT. They have different fixes, and
#     reporting an EACCES/ENOTDIR as "not there" sends the reader to create
#     something that already exists. Driven with a FILE where a directory is
#     expected (ENOTDIR), which needs no permission games.
printf 'not a directory\n' > "$T/a-file-not-a-dir"
out="$(run "$T/a-file-not-a-dir")"; rc=$?
case "$out" in
  *"could not be read"*"not an answer"*) ok "arm 5c: an unreadable record says so, rather than reporting absence" ;;
  *) bad "arm 5c: unreadable was reported as absent"; printf '%s\n' "$out" | head -3 ;;
esac
[ "$rc" -ne 0 ] && ok "arm 5c: and exits non-zero" || bad "arm 5c: an unreadable record exited 0"
case "$out" in
  *"there is no self-report record at"*) bad "arm 5c: it used the ABSENT sentence for an unreadable path" ;;
  *) ok "arm 5c: and does not use the absent sentence" ;;
esac

# --- ARM 6: unparseable lines are counted, never silently dropped.
mkdir -p "$T/junk"
{ filler 5; echo '{not json'; } > "$T/junk/erin.jsonl"
out="$(run "$T/junk")"
# (this line is "phrase then count", the reverse of the others, so it needs its own shape)
printf '%s\n' "$out" | grep -qE "^[[:space:]]*unparseable[[:space:]]+1$" \
  && ok "arm 6: a corrupt line is surfaced rather than skipped into the totals" \
  || bad "arm 6: unparseable count wrong"

# --- 🔑 ARM 7: --dir MUST NOT FALL BACK TO THE LIVE RECORD. `--dir "$UNSET"`
#     used to report on production data while the caller believed it was
#     reading a fixture -- which silently breaks this file's own header promise.
UNSET_ON_PURPOSE=""
out="$(node tools/needs-you-source.js --dir "$UNSET_ON_PURPOSE" 2>&1)"; rc=$?
case "$out" in
  *"--dir was given with no value"*) ok "arm 7: an empty --dir is an error, not a silent fallback to the live record" ;;
  *) bad "arm 7: an empty --dir fell back somewhere"; printf '%s\n' "$out" | head -4 ;;
esac
[ "$rc" -ne 0 ] && ok "arm 7: and exits non-zero" || bad "arm 7: an empty --dir exited 0"

# --- 🔑 ARM 8, THE DRIFT LINK: the provenance split is a string match against
#     a sentence in ANOTHER FILE, and nothing but this check connects them. If
#     the hook is reworded, every hook record silently reclassifies as
#     agent-typed and the tool prints the same verdict with an inverted split.
#     Both arms, because a checker that cannot say no is not a checker.
live="$(node -e '
const m = require("./tools/needs-you-source.js");
console.log(m.hookPrefixIsLive(m.HOOK_SOURCE));
')"
[ "$live" = "true" ] && ok "arm 8: the hook source still contains HOOK_PREFIX (green arm)" \
  || bad "arm 8: HOOK_PREFIX is not in $(node -e 'console.log(require("./tools/needs-you-source.js").HOOK_SOURCE)') -- the split is misclassifying RIGHT NOW"
printf 'a hook that says something else entirely\n' > "$T/reworded-hook.sh"
dead="$(node -e '
const m = require("./tools/needs-you-source.js");
console.log(m.hookPrefixIsLive(process.argv[1]));
' "$T/reworded-hook.sh")"
[ "$dead" = "false" ] && ok "arm 8: and it reports FALSE on a hook that no longer writes the sentence (red arm)" \
  || bad "arm 8: the drift check cannot detect a reworded hook, so it is decoration"
gone="$(node -e '
const m = require("./tools/needs-you-source.js");
console.log(m.hookPrefixIsLive("/nonexistent/kosmos-report-hook.sh"));
')"
[ "$gone" = "null" ] && ok "arm 8: and an unreadable hook is UNVERIFIED (null), never reported as a mismatch" \
  || bad "arm 8: an unreadable hook was conflated with a reworded one"

echo
if [ "$FAILS" -eq 0 ]; then echo "all arms pass"; else echo "$FAILS arm(s) failed"; fi
exit "$FAILS"
