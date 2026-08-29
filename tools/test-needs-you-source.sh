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
has "$out" 1 "written automatically, not by an agent" \
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
#     mostly heartbeats and rises on its own every day (the tool prints the
#     proportion each run; no number is pinned here, because it would go stale).
mkdir -p "$T/spread"
filler 3000 > "$T/spread/dana.jsonl"
for who in ea fi gi; do line needs_you "should I go ahead?" > "$T/spread/$who.jsonl"; done
out="$(run "$T/spread")"
case "$out" in
  *"working agents ARE reporting this state themselves"*) ok "arm 3b: adoption spread thin across agents still trips the verdict" ;;
  *) bad "arm 3b: three distinct agents using the verb read as no adoption"; printf '%s\n' "$out" | tail -8 ;;
esac
# 🔑 AND PIN THE MARGIN. This arm only isolates TYPERS_CUTOFF while the SHARE
# stays UNDER its cutoff (3/3003 = 0.0999% against 0.1%). Shrink the filler for
# speed and the share crosses 0.1%, the arm passes through the share branch
# instead, and it silently stops testing the thing it exists for.
obs="$(printf '%s\n' "$out" | sed -n 's/.*observed: \([0-9.]*\)%.*/\1/p')"
awk -v o="$obs" 'BEGIN{exit !(o+0 < 0.1 && o+0 > 0)}' \
  && ok "arm 3b: and the share ($obs%) is still under the cutoff, so it is the typers clause doing the work" \
  || bad "arm 3b: share is $obs% -- at or over the cutoff, so this arm no longer isolates TYPERS_CUTOFF"

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
out="$(run "$T/planted")"; rc=$?
case "$out" in
  *"CONTROL VIOLATED"*"1 record(s)"*) ok "arm 4: a planted impossible state is detected and NAMED" ;;
  *) bad "arm 4: the control cannot detect a planted impossible state, so its 0 on live data means nothing" ;;
esac
# 🛑 AND THE CONSEQUENCE, WHICH IS WHAT THIS ARM USED TO LACK. It asserted the
# NUMBER MOVED and never that anything happened as a result -- so the tool
# printed "<- must be 0" beside a non-zero and went on to print its strongest
# conclusion, exiting 0, entirely invisibly to this suite.
[ "$rc" -eq 1 ] && ok "arm 4: and it REFUSES (exit 1), because a violated control is a broken instrument" \
  || bad "arm 4: exited $rc -- the control is violated and the tool answered anyway"
so="$(node tools/needs-you-source.js --dir "$T/planted" 2>/dev/null | wc -l | tr -d ' ')"
[ "$so" = "0" ] && ok "arm 4: and prints nothing at all to stdout" \
  || bad "arm 4: printed $so stdout lines despite a violated control"
out="$(run "$T/rare")"; rc=$?
has "$out" 0 "a state no writer can produce" \
  && ok "arm 4: and reads zero on a clean record" \
  || bad "arm 4: the control is non-zero on a clean fixture"
[ "$rc" -eq 0 ] && ok "arm 4: and a clean record still answers, so the refusal is not blanket" \
  || bad "arm 4: refused on a clean record, exit $rc"

# --- 🔑 ARM 4b: THE CONTROL COVERS THE CLASS, NOT ONE STRING. It used to
#     detect exactly `zzz_no_such_state`; ANY other unrecognised state was
#     counted into `records` -- which is the share DENOMINATOR, so it inflated
#     it in the flattering direction -- and was PRINTED VERBATIM in BY STATE,
#     a second channel for agent-authored text the header did not name.
mkdir -p "$T/junkstate"
{ filler 5; printf '{"v":1,"state":"leaked: rm -rf HOME/secrets","because":"y","at":"2026-08-28T00:00:00.000Z"}\n'; } > "$T/junkstate/oz.jsonl"
out="$(run "$T/junkstate")"; rc=$?
case "$out" in
  *"CONTROL VIOLATED"*) ok "arm 4b: an arbitrary unrecognised state trips the control, not just the one string" ;;
  *) bad "arm 4b: only the hardcoded string is detected; the class is open"; printf '%s\n' "$out" | head -6 ;;
esac
[ "$rc" -eq 1 ] && ok "arm 4b: and it refuses" || bad "arm 4b: exited $rc with an unrecognised state present"
# 🔑 AND THE VALUE MUST NOT BE ECHOED: a state string is agent-authored text.
case "$out" in
  *"rm -rf"*) bad "arm 4b: the unrecognised state VALUE was echoed into the output" ;;
  *) ok "arm 4b: and the offending value is never echoed, only the file naming it" ;;
esac
case "$out" in
  *"oz.jsonl"*) ok "arm 4b: while the FILE is named, which is what a person needs" ;;
  *) bad "arm 4b: refused without saying where to look" ;;
esac

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
printf '%s\n' "$out" | grep -qE "^[[:space:]]*unparseable lines[[:space:]]+1$" \
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

# --- 🔑 ARM 7b: AN UNRECOGNISED ARGUMENT IS REJECTED. Arm 7 covers an empty
#     --dir; ignoring an unknown flag is the same failure through a second
#     door. Measured before the fix: `--dirr <fixture>` and a bare positional
#     path BOTH read the live record while the caller believed otherwise.
for badarg in "--dirr" "--verbose"; do
  out="$(node tools/needs-you-source.js "$badarg" "$T/rare" 2>&1)"; rc=$?
  case "$out" in
    *"unrecognised argument"*) ok "arm 7b: $badarg is rejected, not ignored" ;;
    *) bad "arm 7b: $badarg was ignored and something was read anyway"; printf '%s\n' "$out" | head -3 ;;
  esac
  [ "$rc" -eq 2 ] || bad "arm 7b: $badarg exited $rc, expected 2"
done
out="$(node tools/needs-you-source.js "$T/rare" 2>&1)"
case "$out" in
  *"unrecognised argument"*) ok "arm 7b: a bare positional path is rejected too" ;;
  *) bad "arm 7b: a bare positional was ignored and the LIVE record was read"; printf '%s\n' "$out" | head -3 ;;
esac

# --- 🔑 ARM 7c: AN UNREADABLE FILE IS COUNTED AND NAMED. It used to be skipped
#     with no counter while an unreadable LINE was counted -- so an EACCES on
#     one agent's file removed that agent's reds from every number, silently,
#     while "agent files" still counted it.
if [ "$(id -u)" -eq 0 ]; then
  bad "arm 7c: running as root, so chmod 000 is a no-op and this arm would pass vacuously"
else
mkdir -p "$T/noperm"
{ filler 10; line needs_you "May I ask you something?"; } > "$T/noperm/ida.jsonl"
line working "visible" > "$T/noperm/jo.jsonl"
chmod 000 "$T/noperm/ida.jsonl"
out="$(run "$T/noperm")"
case "$out" in
  *"UNREADABLE files"*"ida.jsonl"*) ok "arm 7c: an unreadable file is counted and named" ;;
  *) bad "arm 7c: an unreadable file vanished silently"; printf '%s\n' "$out" | head -6 ;;
esac
chmod 644 "$T/noperm/ida.jsonl"
out="$(run "$T/noperm")"
case "$out" in
  *"UNREADABLE files"*"ida.jsonl"*) bad "arm 7c: still reported unreadable after chmod -- the check is not reading permissions" ;;
  *) ok "arm 7c: and reads zero once the file is readable (the arm can go both ways)" ;;
esac
fi

# --- 🔑 ARM 7d: A LINE THAT IS NOT A RECORD DOES NOT INFLATE THE DENOMINATOR.
#     A JSON array parses fine and is not a report; an object with no `state`
#     is not one either. Both used to land in the totals as `state: ''`, which
#     pads the share denominator in the direction that flatters the verdict.
mkdir -p "$T/notrecords"
{ filler 5; echo '[1,2,3]'; echo '{"v":1,"because":"no state here"}'; echo '{"v":1,"state":"   "}'; } > "$T/notrecords/ken.jsonl"
out="$(run "$T/notrecords")"
printf '%s\n' "$out" | grep -qE "^[[:space:]]*records[[:space:]]+5$" \
  && ok "arm 7d: non-records are excluded from the total, not counted as a blank state" \
  || bad "arm 7d: the denominator was inflated by lines that are not reports"
printf '%s\n' "$out" | grep -qE "^[[:space:]]*unparseable lines[[:space:]]+3$" \
  && ok "arm 7d: and all three are surfaced as unparseable" \
  || bad "arm 7d: non-records were dropped silently rather than counted"

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

# --- 🔑 ARM 8b: THE TWO LINES status.js QUOTES BACK. Rule 3 cites the tool's
#     "typed by a working agent" count and its "last typed" DATE by name, so
#     both must be asserted here or the engine comment rests on output nothing
#     checks. Driven on a fixture with a known date and two distinct typers.
mkdir -p "$T/dated"
filler 3000 > "$T/dated/lyn.jsonl"
printf '{"v":1,"state":"needs_you","because":"q","at":"2026-01-02T03:04:05.000Z"}\n' > "$T/dated/mo.jsonl"
printf '{"v":1,"state":"needs_you","because":"q","at":"2026-07-08T09:10:11.000Z"}\n' > "$T/dated/nia.jsonl"
out="$(run "$T/dated")"
has "$out" 2 "distinct working agents that have EVER typed it" \
  && ok "arm 8b: the distinct-agent count is asserted, not just printed" \
  || bad "arm 8b: distinct working agents miscounted"
printf '%s\n' "$out" | grep -q "last typed by a working agent:    2026-07-08T09:10:11.000Z" \
  && ok "arm 8b: and the last-typed date is the LATEST, not the first or the file order" \
  || bad "arm 8b: last-typed date wrong -- status.js quotes this line"
# 🔑 AND PIN THE VERDICT, because this fixture sits exactly ON the
# TYPERS_CUTOFF boundary (2 typers, share under the cutoff). The boundary was
# being exercised and not asserted, so a change to either cutoff could move the
# verdict here and no arm would say so.
case "$out" in
  *"load-bearing on the PANE READER"*) ok "arm 8b: and exactly AT the typers cutoff the verdict still holds (boundary is inclusive)" ;;
  *) bad "arm 8b: the verdict flipped at exactly TYPERS_CUTOFF typers -- the boundary moved" ;;
esac

# --- 🔑 ARM 7e: --dir TWICE REFUSES. Same stance as an unrecognised argument:
#     silently last-wins is how a caller reads a fixture and gets production.
out="$(node tools/needs-you-source.js --dir "$T/rare" --dir "$T/used" 2>&1)"; rc=$?
case "$out" in
  *"--dir was given twice"*) ok "arm 7e: a repeated --dir is refused, not last-wins" ;;
  *) bad "arm 7e: a repeated --dir silently took one of them"; printf '%s\n' "$out" | head -3 ;;
esac
[ "$rc" -eq 2 ] || bad "arm 7e: exited $rc, expected 2"

# --- 🔑 ARM 12: THE RECORD'S OWN WORD BEATS THE STRING MATCH (#1457).
#     🛑 THE FIXTURE MUST BE ASYMMETRIC. My first version put one record wrong
#     in each direction, so the two COUNTS were 1 and 1 whether the `by` field
#     was honoured or ignored -- only which record sat in which bucket changed,
#     and I was asserting the counts. It passed under perturbation: a guard
#     that cannot fail, in the arm written to prevent exactly that. Both
#     records now point the SAME way, so honouring `by` gives 0 hook / 2 typed
#     and ignoring it gives 2 hook / 0 typed.
mkdir -p "$T/stated"
filler 50 > "$T/stated/pat.jsonl"
# BOTH say agent, and BOTH have a sentence that matches the hook prefix exactly.
printf '{"v":1,"state":"needs_you","by":"agent","because":"asking permission to use Bash: ls","at":"2026-08-28T00:00:00.000Z"}\n' > "$T/stated/quinn.jsonl"
printf '{"v":1,"state":"needs_you","by":"agent","because":"asking permission to use AskUserQuestion","at":"2026-08-28T00:00:00.000Z"}\n' > "$T/stated/rex.jsonl"
out="$(run "$T/stated")"
has "$out" 0 "written automatically, not by an agent" \
  && ok "arm 12: by=agent beats a sentence that matches the hook prefix (0 hook, not 2)" \
  || bad "arm 12: the string match overrode by=agent: $(printf '%s\n' "$out" | grep 'written automatically')"
has "$out" 2 "typed by a working agent" \
  && ok "arm 12: and both land in typed, which is the opposite bucket from the fallback" \
  || bad "arm 12: by=agent records did not count as typed: $(printf '%s\n' "$out" | grep 'typed by a working')"
printf '%s\n' "$out" | grep -qE "^[[:space:]]*2[[:space:]]+of the 2 classified by the record" \
  && ok "arm 12: and it reports that both rested on the record's own word" \
  || bad "arm 12: the stated/inferred split is wrong"

# --- and the mirror, so `by` cannot simply be hardcoded to one answer
mkdir -p "$T/stated-auto"
filler 50 > "$T/stated-auto/sam.jsonl"
printf '{"v":1,"state":"needs_you","by":"auto","because":"a sentence a person would type","at":"2026-08-28T00:00:00.000Z"}\n' > "$T/stated-auto/tam.jsonl"
printf '{"v":1,"state":"needs_you","by":"auto","because":"another such sentence","at":"2026-08-28T00:00:00.000Z"}\n' > "$T/stated-auto/uma.jsonl"
out="$(run "$T/stated-auto")"
has "$out" 2 "written automatically, not by an agent" \
  && ok "arm 12: by=auto beats a sentence that does NOT match the prefix (2 hook, not 0)" \
  || bad "arm 12: the string match overrode by=auto: $(printf '%s\n' "$out" | grep 'written automatically')"
case "$out" in
  *"No working agent has EVER typed needs_you"*) ok "arm 12: and none of them counts as agent-typed" ;;
  *) bad "arm 12: a by=auto record was counted as agent-typed" ;;
esac

# --- the fallback must still work where `by` is absent
out="$(run "$T/hookonly")"
printf '%s\n' "$out" | grep -qE "^[[:space:]]*0[[:space:]]+of the 1 classified by the record" \
  && ok "arm 12: a pre-#1457 record reports ZERO stated, so the split is honest about its evidence" \
  || bad "arm 12: claimed the record's own word on lines that predate the field"
printf '%s\n' "$out" | grep -qE "^[[:space:]]*1[[:space:]]+classified by the weaker string-match fallback" \
  && ok "arm 12: and counts it under the weaker marker instead" \
  || bad "arm 12: the fallback count is wrong"

# --- 🔑 ARM 11, AND IT IS THE ARM WHOSE ABSENCE LET A FALSE PROMISE SHIP.
#     The tool header promises "only a real reading goes to stdout". Two of the
#     four refusal paths printed a PARTIAL reading to stdout before exiting,
#     and no arm noticed BECAUSE run() merges 2>&1 -- so every refusal arm
#     would have passed identically either way. These assert the SPLIT.
printf 'a hook that says something else\n' > "$T/reworded-hook.sh"
so="$(node tools/needs-you-source.js --dir "$T/empty" 2>/dev/null | wc -l | tr -d ' ')"
[ "$so" = "0" ] && ok "arm 11: an empty record prints NOTHING to stdout" \
  || bad "arm 11: an empty record printed $so stdout lines before refusing"
so="$(KOSMOS_HOOK_SOURCE="$T/reworded-hook.sh" node tools/needs-you-source.js --dir "$T/rare" 2>/dev/null | wc -l | tr -d ' ')"
[ "$so" = "0" ] && ok "arm 11: a drifted marker prints NOTHING to stdout" \
  || bad "arm 11: a drifted marker printed $so stdout lines before refusing"
so="$(node tools/needs-you-source.js --dir "$T/does-not-exist" 2>/dev/null | wc -l | tr -d ' ')"
[ "$so" = "0" ] && ok "arm 11: a missing record prints NOTHING to stdout" \
  || bad "arm 11: a missing record printed $so stdout lines"
so="$(node tools/needs-you-source.js --dirr x 2>/dev/null | wc -l | tr -d ' ')"
[ "$so" = "0" ] && ok "arm 11: a bad argument prints NOTHING to stdout" \
  || bad "arm 11: a bad argument printed $so stdout lines"
# the other arm: a REAL reading must actually use stdout, or the four above
# would pass on a tool that prints nothing at all.
so="$(node tools/needs-you-source.js --dir "$T/rare" 2>/dev/null | wc -l | tr -d ' ')"
[ "$so" -gt 10 ] && ok "arm 11: and a real reading DOES go to stdout ($so lines), so the four zeros mean something" \
  || bad "arm 11: a real reading produced $so stdout lines -- the zeros above prove nothing"

# --- 🔑 ARM 9: A DRIFTED MARKER REFUSES, IT DOES NOT WARN AND CARRY ON. The
#     first version printed "the verdict cannot be trusted" and then printed
#     the verdict anyway, exiting 0 -- the editorialising-past-your-own-data
#     defect committed by the line written to prevent it. HOOK_SOURCE is
#     overridable for exactly this arm; without an injection point the refusal
#     could not be tested at all, which is how it shipped broken.
out="$(KOSMOS_HOOK_SOURCE="$T/reworded-hook.sh" node tools/needs-you-source.js --dir "$T/rare" 2>&1)"; rc=$?
case "$out" in
  *"MISMATCH"*) ok "arm 9: a drifted marker is reported" ;;
  *) bad "arm 9: no mismatch reported on a reworded hook"; printf '%s\n' "$out" | head -3 ;;
esac
[ "$rc" -eq 1 ] && ok "arm 9: and it REFUSES (exit 1), rather than warning and continuing" \
  || bad "arm 9: exited $rc -- a broken instrument was allowed to print a verdict"
case "$out" in
  *"load-bearing on the PANE READER"*|*"ARE reporting this state themselves"*|*"BY PROVENANCE"*)
    bad "arm 9: it printed the split or the verdict anyway" ;;
  *) ok "arm 9: and prints neither the split nor the verdict" ;;
esac
# the other arm: the real hook must NOT trigger the refusal
out="$(run "$T/rare")"; rc=$?
[ "$rc" -eq 0 ] && ok "arm 9: and the real hook does not trigger it (exit 0)" \
  || bad "arm 9: the refusal fires against the real hook, exit $rc"

# --- 🔑 ARM 9b: AN UNVERIFIED MARKER IS NOT A MISMATCH, END TO END. Arm 8
#     checks hookPrefixIsLive returns null for an unreadable hook; nothing drove
#     that through main(), so the DECISION -- unverified still prints a verdict,
#     mismatched refuses -- was untested. Those two must not converge.
out="$(KOSMOS_HOOK_SOURCE="$T/no-such-hook.sh" node tools/needs-you-source.js --dir "$T/rare" 2>&1)"; rc=$?
case "$out" in
  *"MISMATCH"*) bad "arm 9b: an unreadable hook was reported as a MISMATCH" ;;
  *"UNVERIFIED"*) ok "arm 9b: an unreadable hook reads UNVERIFIED, not mismatched" ;;
  *) bad "arm 9b: no marker line at all for an unreadable hook"; printf '%s\n' "$out" | head -4 ;;
esac
[ "$rc" -eq 0 ] && ok "arm 9b: and it still prints a verdict (exit 0), unlike a drifted marker" \
  || bad "arm 9b: an UNVERIFIED marker refused (exit $rc) -- it has converged with MISMATCH"

# --- 🔑 ARM 10: THE SUCCESS PATH EXITS 0. Codes 1 and 2 are asserted above;
#     0 was not, and this script runs without `set -e` while run() discards
#     status -- so a regression making the good path exit non-zero would leave
#     every other assertion green.
node tools/needs-you-source.js --dir "$T/rare" >/dev/null 2>&1
[ $? -eq 0 ] && ok "arm 10: a successful read exits 0" || bad "arm 10: the success path did not exit 0"

echo
if [ "$FAILS" -eq 0 ]; then echo "all arms pass"; else echo "$FAILS arm(s) failed"; fi
exit "$FAILS"
