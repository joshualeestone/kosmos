#!/bin/bash
# The versions-page gate shown red and green on both of its axes (#1463).
#
# ⚠️ THE ARM THAT EARNS ITS KEEP IS "a publication stamp read at step 1".
# Running this gate early was nearly abandoned on an asserted-but-unmeasured
# claim that it would refuse correct entries, because an entry stamped for
# publication sits about fifteen minutes in the FUTURE when step 1 reads it.
# It passes because the FUTURE side is 20 at BOTH call sites. That arm is here so
# the claim is measured on every run instead of re-argued.
#
# 🛑 THIS SENTENCE USED TO SAY "the window is symmetric (|off| <= 20), so it
# passes", AND THAT IS EXACTLY THE SENTENCE tools/lib/versions-entry.sh KEEPS
# VISIBLE AS AN EXAMPLE OF ONE THAT WENT FALSE ONE CHANGE LATER. The lib caught
# its own copy and this sibling copy survived, unamended, sitting directly above
# four arms that prove the asymmetry. ⇒ Correcting a stale claim WHERE YOU FOUND
# IT is not the same as correcting it everywhere, and the second copy is the one
# nobody re-reads. The window is 5 past / 20 future at step 1, 20 / 20 at step 7.
set -u
# 🛑 UNSET BEFORE SOURCING. Both bounds are env-overridable, and docs/releasing.md
# now TELLS an operator to export them when a cut is running long. Step 3 of the
# cut runs `yarn test` in a subshell that inherits that export, so without this
# an operator who takes the documented escape hatch makes the cut die red at
# step 3, after the freeze, on a failure with nothing to do with the tree.
# ⇒ A suite that reads its expected values from the ambient environment is
# measuring the shell it was launched from, not the code.
unset KOSMOS_STEP1_PAST_BOUND KOSMOS_LATE_PAST_BOUND KOSMOS_FUTURE_BOUND
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib/versions-entry.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
F="$T/versions.html"
fails=0
pass() { echo "PASS  $1"; }
# 🛑 fail() IS DEFINED HERE, BESIDE pass(), AND THAT PLACEMENT IS THE FIX FOR A
# LIVE DEFECT. It used to sit below the assert_defaults call, so that arm's else
# branch died with `fail: command not found`, `fails` was never incremented, and
# the suite printed "all arms behaved" and exited 0 with the arm unable to report
# anything. ⚠️ The comment above that call claimed the problem was already fixed:
# I had moved the call below pass() and not below fail(), then wrote that both
# were now in scope. Verified by planting `= 5` -> `= 6` and watching it stay
# green. A note saying a defect is fixed is not a check that it is.
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
assert_defaults() {
  [ "$KOSMOS_STEP1_PAST_BOUND" = 4 ] && [ "$KOSMOS_LATE_PAST_BOUND" = 20 ] && [ "$KOSMOS_FUTURE_BOUND" = 20 ]
}
# ⚠️ Called HERE, after pass/fail exist. Placed above them it produced
# `command not found` for BOTH branches, incremented nothing, and printed
# nothing: an arm that could not fail, added by the same commit that exists to
# stop the suite reading its expectations from the ambient shell.
#
# 📌 WHAT THIS ARM ACTUALLY GUARDS, stated honestly because I first assumed
# otherwise: it does NOT catch environment pollution. The `unset` above runs
# first, so this always reads the post-unset values. What catches pollution is
# measured -- removing that `unset` and exporting KOSMOS_STEP1_PAST_BOUND=30
# turns the 12-minute arm and the bound-tighter arm red. This arm pins the
# documented constants 5/20/20, so it fires if somebody changes them in the lib
# without changing docs/releasing.md, which states those three numbers.
if assert_defaults; then pass "the suite measures the code's defaults, not the ambient shell"; else fail "bounds came from the environment: step1=$KOSMOS_STEP1_PAST_BOUND late=$KOSMOS_LATE_PAST_BOUND future=$KOSMOS_FUTURE_BOUND"; fi
has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

# $1 = minutes from now, positive = the past
#
# ⚠️ THIS IS A THIRD PRODUCER OF THE rel-d FORMAT, AGAINST ONE PARSER. The others
# are `versions_entry()` in tools.release-gate.test.js and the real writer,
# tools/insert-release-entry.js. If the page's stamp format ever changes, both
# fixtures keep passing while the real page fails -- the two-derivations habit
# this repo warns about, in test-only clothing. Kept because a fixture that
# imported the real writer would drag its file I/O into a unit test; noted so the
# next person changing the format knows there are three places, not one.
stamp_at() {
  node -e "
    const off = Number(process.argv[1]);
    const t = new Date(Date.now() - off*60000);
    const months='January February March April May June July August September October November December'.split(' ');
    let h=t.getHours(), ap=h>=12?'PM':'AM'; h=h%12; if(h===0)h=12;
    const mm=String(t.getMinutes()).padStart(2,'0');
    process.stdout.write(months[t.getMonth()]+' '+t.getDate()+', '+t.getFullYear()+', '+h+':'+mm+' '+ap+' CDT');
  " -- "$1"
}
entry() { printf '<article id="v0-6-06"><span class="rel-d">%s</span></article>\n' "$1" > "$F"; }

# default runs use the LATE bounds (+/-20); the step 1 arms pass the tighter one.
run()       { kosmos_versions_entry_gate 0.6.06 "$F" "cost sentence." "stamp hint." "$KOSMOS_LATE_PAST_BOUND" 2>&1; }
run_early_bound() { kosmos_versions_entry_gate 0.6.06 "$F" "cost sentence." "stamp hint." "$1" 2>&1; }
run_early() { kosmos_versions_entry_gate 0.6.06 "$F" "cost sentence." "stamp hint." "$KOSMOS_STEP1_PAST_BOUND" 2>&1; }

# --- presence axis ---
printf '<article id="v0-6-05"><span class="rel-d">%s</span></article>\n' "$(stamp_at 0)" > "$F"
out="$(run)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "has no entry"; then pass "refuses when the entry is absent"; else fail "refuses when absent (rc=$rc): $out"; fi
# and the control that makes that refusal mean something: the same file, the version it DOES carry
out="$(kosmos_versions_entry_gate 0.6.05 "$F" "cost." "hint." "$KOSMOS_LATE_PAST_BOUND" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ]; then pass "and accepts the version that file does carry (control)"; else fail "control: 0.6.05 should pass (rc=$rc): $out"; fi

# --- stamp axis ---
entry "$(stamp_at 0)"
out="$(run)"; rc=$?
if [ "$rc" -eq 0 ] && has "$out" "agrees with the clock"; then pass "accepts a stamp written now"; else fail "accepts now (rc=$rc): $out"; fi

entry "$(stamp_at -15)"
out="$(run)"; rc=$?
if [ "$rc" -eq 0 ]; then pass "accepts a publication stamp 15 min ahead, read at step 1"; else fail "publication stamp must pass early (rc=$rc): $out"; fi

st="$(stamp_at 25)"; entry "$st"
out="$(run)"; rc=$?
# ⚠️ the SAME stamp string, not a second stamp_at call. Calling it twice reads the
# clock again seconds later, so a failure message could print a minute the fixture
# never carried -- a diagnostic that disagrees with the thing under test.
off="$(kosmos_versions_entry_stamp_off "$st")"
# ⚠️ the count is asserted as a RANGE, not as 25: the stamp has minute
# granularity, so a fixture built 40 seconds past the minute reads 26. An exact
# assertion here fails once an hour for a reason that has nothing to do with
# the gate.
if [ "$rc" -eq 1 ] && has "$out" "minutes in the past" && [ "$off" -ge 24 ] 2>/dev/null; then pass "refuses a stale stamp, and says by how much ($off min)"; else fail "refuses stale (rc=$rc, off=$off): $out"; fi

st="$(stamp_at -25)"; entry "$st"
out="$(run)"; rc=$?
off="$(kosmos_versions_entry_stamp_off "$st")"
# the SIGN is the thing under test here, and it is what separates this arm from
# the unparseable one below: an empty fixture also refuses, for a different reason.
if [ "$rc" -eq 1 ] && has "$out" "minutes in the FUTURE" && [ "$off" -le -24 ] 2>/dev/null; then pass "refuses a stamp in the future (a guess cannot satisfy the clock) ($off min)"; else fail "refuses future (rc=$rc, off=$off): $out"; fi

entry "sometime tuesday"
out="$(run)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "refuses an unparseable stamp"; else fail "refuses unparseable (rc=$rc): $out"; fi


# --- THE ASYMMETRY: step 1 is stricter on the PAST side, and that is the point ---
# 🛑 A stamp 12 minutes old passes a symmetric +/-20 at step 1 and then dies at
# step 7, because the cut adds its own ~15 minutes on the way there. Step 1 can
# see that it is doomed; refusing it early is the entire value of the move.
st="$(stamp_at 12)"; entry "$st"
out="$(run)"; rc=$?
if [ "$rc" -eq 0 ]; then pass "12 minutes old passes the LATE gate, as it must"; else fail "late gate refused 12 min old (rc=$rc): $out"; fi
out="$(run_early)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "minutes in the past"; then pass "and the EARLY gate refuses it, because the cut will age it past 20"; else fail "early gate accepted a doomed 12-min-old stamp (rc=$rc): $out"; fi

# and the early gate must NOT refuse a correctly forward-stamped entry
st="$(stamp_at -15)"; entry "$st"
out="$(run_early)"; rc=$?
if [ "$rc" -eq 0 ]; then pass "the EARLY gate still accepts a publication stamp 15 min ahead"; else fail "early gate refused a correct publication stamp (rc=$rc): $out"; fi

# the future side is NOT widened at either call site
st="$(stamp_at -25)"; entry "$st"
out="$(run_early)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "FUTURE"; then pass "the EARLY gate still refuses a 25-min forward guess (future side not widened)"; else fail "early gate accepted a forward guess (rc=$rc): $out"; fi

# --- an unreadable file is not an absent entry ---
out="$(kosmos_versions_entry_gate 0.6.06 "$T/nope.html" "cost." "hint." "$KOSMOS_LATE_PAST_BOUND" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "cannot read"; then pass "an unreadable file says so, instead of 'write the entry'"; else fail "unreadable file (rc=$rc): $out"; fi

# --- a version that is not digits and dots never reaches the sed address ---
entry "$(stamp_at 0)"
out="$(kosmos_versions_entry_gate '0.6.*' "$F" "cost." "hint." "$KOSMOS_LATE_PAST_BOUND" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "not digits and dots"; then pass "refuses a version carrying a regex metacharacter"; else fail "metacharacter version (rc=$rc): $out"; fi


# --- FAIL-OPEN ARMS. Both of these were live regressions, not hypotheticals. ---
# 🛑 A guard that errors must refuse, not pass. `[ NaN -gt 5 ]` ERRORS rather than
# evaluating false, so before this arm existed the gate fell through both
# comparisons into "its timestamp agrees with the clock" and returned 0.
entry "August 28, 999999, 1:00 AM CDT"
out="$(run)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "a stamp whose offset is not a number REFUSES (fail closed)"; else fail "FAIL-OPEN: NaN offset passed the gate (rc=$rc): $out"; fi

# 🛑 THE SECOND DEFENCE, TESTED SEPARATELY BECAUSE THE FIRST ONE MASKS IT.
# There are two guards against a non-numeric offset: node prints `unparseable`
# when the value is not finite, and the shell refuses anything that is not an
# integer. A mutation test removing the SHELL guard stayed green, because the
# node guard still caught the NaN -- so the shell guard was protecting a case
# nothing exercised. This arm exercises it: with `node` unavailable the offset
# is EMPTY, which no node-side check can catch, and empty must still refuse.
entry "$(stamp_at 0)"
stub="$T/stub"; mkdir -p "$stub"
printf '#!/bin/sh\nexit 127\n' > "$stub/node"; chmod +x "$stub/node"
out="$(PATH="$stub:$PATH" run)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "an offset that cannot be computed at all REFUSES (node absent)"; else fail "FAIL-OPEN: unusable node passed the gate (rc=$rc): $out"; fi

# 🛑 An article with no rel-d must not borrow the NEXT article's stamp. Entries are
# newest-first, so on a same-session re-cut the neighbour's stamp is plausibly
# inside the window and would green-light an entry carrying no timestamp at all.
# ⚠️ ONE printf, not a heredoc plus a sed substitution: if that substitution ever
# no-opped, the literal PLACEHOLDER survived and the control below still passed,
# because it only asserted non-empty.
printf '<article class="rel" id="v0-6-06">\n  <h2>0.6.06</h2>\n</article>\n<article class="rel" id="v0-6-05">\n  <span class="rel-d">%s</span>\n</article>\n' "$(stamp_at 0)" > "$F"
got="$(kosmos_versions_entry_stamp 0.6.06 "$F")"
if [ -z "$got" ]; then pass "an entry with no rel-d reads empty, not the neighbour's stamp"; else fail "FAIL-OPEN: borrowed a neighbour's stamp: '$got'"; fi
got="$(kosmos_versions_entry_stamp 0.6.05 "$F")"
# ⚠️ the control asserts the stamp PARSES, not merely that it is non-empty, so it
# cannot pass on a literal placeholder that the fixture failed to substitute.
gotoff="$(kosmos_versions_entry_stamp_off "$got")"
case "$gotoff" in ''|*[!0-9-]*) parses=no ;; *) parses=yes ;; esac
if [ "$parses" = yes ]; then pass "CONTROL: the neighbour's own stamp is readable AND parses ($got)"; else fail "control did not parse ('$got' -> '$gotoff'); the reader or the fixture is broken"; fi
out="$(run)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "and the gate refuses the entry that has no timestamp"; else fail "FAIL-OPEN: no-timestamp entry passed (rc=$rc): $out"; fi


# --- EVERY bound must refuse when it is not an integer, on BOTH axes ---
# 🛑 This class was found three times in this file, on three different values:
# the offset, the past bound, the future bound. It was fixed where it was found
# twice, and the third survived both fixes. These arms cover all of them, and the
# future one is the arm that matters most: that axis is what the guard is FOR.
fut="$(node -e "const d=new Date(Date.now()+60*60000);const m='January February March April May June July August September October November December'.split(' ');let h=d.getHours(),a=h>=12?'PM':'AM';h=h%12||12;process.stdout.write(m[d.getMonth()]+' '+d.getDate()+', '+d.getFullYear()+', '+h+':'+String(d.getMinutes()).padStart(2,'0')+' '+a+' CDT')")"
entry "$fut"
out="$(run)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "FUTURE"; then pass "CONTROL: a stamp 60 min ahead refuses with a valid future bound"; else fail "control: +60 should refuse (rc=$rc): $out"; fi
out="$(KOSMOS_FUTURE_BOUND=abc bash -c '. "'"$HERE"'/lib/versions-entry.sh"; kosmos_versions_entry_gate 0.6.06 "'"$F"'" "c." "h." 20' 2>&1)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "a non-integer FUTURE bound REFUSES (fail closed, on the axis the guard is for)"; else fail "FAIL-OPEN: future bound 'abc' let a +60min stamp through (rc=$rc): $out"; fi

# --- a non-integer BOUND must refuse too, not just a non-integer offset ---
# ⚠️ stamp_at, not a hard-coded date. The literal it replaced said "1:00 AM CDT"
# and the control below called it a 90-minute-stale entry; its real staleness was
# whatever the wall clock said, and for a forty-minute window each night it sat
# INSIDE the +/-20 band and the control would have failed.
entry "$(stamp_at 90)"
huge=99999999999999999999
out="$(kosmos_versions_entry_gate 0.6.06 "$F" "c." "h." abc 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "refusing: the past-side bound"; then pass "a non-integer past bound REFUSES (fail closed)"; else fail "FAIL-OPEN: bound 'abc' passed (rc=$rc): $out"; fi

# 🛑 AN ALL-DIGIT BOUND THAT IS NOT A USABLE NUMBER. This is the fourth instance
# of the fail-open class and it lived INSIDE the validator written to end the
# class: a character-set test asks whether the string LOOKS like a number, and
# this one does. Measured before the fix: rc=0, "its timestamp agrees with the
# clock", on a ten-hour-stale entry.
out="$(kosmos_versions_entry_gate 0.6.06 "$F" "c." "h." "$huge" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "an all-digit but unusable past bound REFUSES"; else fail "FAIL-OPEN: 20-digit past bound passed (rc=$rc): $out"; fi
out="$(KOSMOS_FUTURE_BOUND=$huge bash -c '. "'"$HERE"'/lib/versions-entry.sh"; kosmos_versions_entry_gate 0.6.06 "'"$F"'" "c." "h." 20' 2>&1)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "an all-digit but unusable FUTURE bound REFUSES"; else fail "FAIL-OPEN: 20-digit future bound passed (rc=$rc): $out"; fi
out="$(kosmos_versions_entry_gate 0.6.06 "$F" "c." "h." " 20" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "CONTROL: a USABLE bound still refuses the stale entry, so the arms above are not refusing everything"; else fail "control: ' 20' should still refuse a stale entry (rc=$rc): $out"; fi
out="$(kosmos_versions_entry_gate 0.6.06 "$F" "c." "h." "$KOSMOS_LATE_PAST_BOUND" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "CONTROL: the same entry with a valid bound still refuses for staleness"; else fail "control: a 90-min-stale entry should refuse (rc=$rc): $out"; fi

# --- the bounds are overridable, because the runbook says they are ---
got="$(KOSMOS_LATE_PAST_BOUND=99 bash -c '. "'"$HERE"'/lib/versions-entry.sh"; echo "$KOSMOS_LATE_PAST_BOUND"')"
if [ "$got" = 99 ]; then pass "an exported bound survives sourcing (the runbook offers it as a knob)"; else fail "sourcing clobbered an exported bound: got '$got'"; fi
got="$(bash -c '. "'"$HERE"'/lib/versions-entry.sh"; echo "$KOSMOS_LATE_PAST_BOUND"')"
if [ "$got" = "$KOSMOS_LATE_PAST_BOUND" ]; then pass "CONTROL: with nothing exported it takes its default ($got)"; else fail "default bound wrong: '$got'"; fi


# --- the FOUR-ARGUMENT call, i.e. the default branch of ${5:-...} ---
# 🛑 NOTHING EXERCISED THIS. Every other arm passes five arguments, so the default
# never ran, and mutating it to the literal `${5:-20}` -- the exact "fourth copy
# of the late bound" the lib argues against -- left every suite green. A default
# that no arm reaches is not a default, it is dead code that happens to be right.
got="$(KOSMOS_LATE_PAST_BOUND=99 bash -c '
  . "'"$HERE"'/lib/versions-entry.sh"
  printf "<article id=\"v0-6-06\"><span class=\"rel-d\">%s</span></article>\n" "$1" > "$2"
  kosmos_versions_entry_gate 0.6.06 "$2" "c." "h." >/dev/null 2>&1; echo $?
' _ "$(stamp_at 30)" "$F")"
if [ "$got" = 0 ]; then pass "a four-argument call takes the bound from the CONSTANT, not a literal"; else fail "the default bound is a literal: a 30-min entry refused under KOSMOS_LATE_PAST_BOUND=99 (rc=$got)"; fi


# --- SHAPES THAT ARE VALID NUMBERS BUT BROKE THE DERIVED COMPARISON ---
# 🛑 The fifth instance of the fail-open. `" 20"` and `"+20"` are usable numbers
# and pass the validator CORRECTLY; what broke was the string `"-$BOUND"`,
# giving `"- 20"`, which is not. A stamp 60 minutes in the future PASSED.
# ⚠️ And the suite already fed `" 20"` to the PAST bound as a deliberate control,
# so the accepting shape was exercised on the axis where it is harmless and never
# on the axis where it is fatal.
fut60="$(stamp_at -60)"
for shape in "20" " 20" "+20" "020"; do
  entry "$fut60"
  out="$(KOSMOS_FUTURE_BOUND="$shape" bash -c '. "'"$HERE"'/lib/versions-entry.sh"; kosmos_versions_entry_gate 0.6.06 "'"$F"'" "c." "h." 20' 2>&1)"; rc=$?
  if [ "$rc" -eq 1 ]; then pass "a +60min stamp is refused with FUTURE_BOUND='$shape'"; else fail "FAIL-OPEN: '$shape' let a +60min stamp through (rc=$rc): $out"; fi
done
# CONTROL, the other direction: a legitimate publication stamp must still pass
# under every one of those shapes, or the fix above is just refusing everything.
pub15="$(stamp_at -15)"
for shape in "20" " 20" "+20"; do
  entry "$pub15"
  out="$(KOSMOS_FUTURE_BOUND="$shape" bash -c '. "'"$HERE"'/lib/versions-entry.sh"; kosmos_versions_entry_gate 0.6.06 "'"$F"'" "c." "h." 20' 2>&1)"; rc=$?
  if [ "$rc" -eq 0 ]; then pass "CONTROL: a +15min publication stamp still passes with FUTURE_BOUND='$shape'"; else fail "over-refusal: '$shape' rejected a correct publication stamp (rc=$rc): $out"; fi
done


# --- LEADING ZEROS, ON BOTH BOUNDS, IN BOTH DIRECTIONS ---
# 🛑 THE SIXTH INSTANCE, AND MY OWN SUITE COULD NOT SEE IT. `020` was exercised
# only on the FUTURE bound in the REFUSING direction, where 16 and 20 return the
# identical verdict, so the two outcomes were indistinguishable. `08` was never
# tried at all, and `$((08))` does not evaluate wrongly, it ABORTS the command
# list, so the gate returned 0 on a ninety-minute-stale entry.
# ⚠️ That is this file's own warning, one argument over: a control can be
# correct, deliberate, and aimed where the two answers look the same.
stale90="$(stamp_at 90)"
for shape in 08 09 020 010; do
  entry "$stale90"
  out="$(run_early_bound "$shape")"; rc=$?
  if [ "$rc" -eq 1 ]; then pass "a 90-min-stale entry is REFUSED with past bound '$shape'"; else fail "FAIL-OPEN: past bound '$shape' passed a 90-min-stale entry (rc=$rc): $out"; fi
  out="$(KOSMOS_FUTURE_BOUND="$shape" bash -c '. "'"$HERE"'/lib/versions-entry.sh"; kosmos_versions_entry_gate 0.6.06 "'"$F"'" "c." "h." 20' 2>&1)"; rc=$?
  if [ "$rc" -eq 1 ]; then pass "and REFUSED with future bound '$shape'"; else fail "FAIL-OPEN: future bound '$shape' passed (rc=$rc): $out"; fi
done

# 020 must mean TWENTY, not sixteen. The refusing direction cannot tell them
# apart, so this is asserted where they differ: an 18-minute-ahead publication
# stamp passes under 20 and would be refused under 16.
entry "$(stamp_at -18)"
out="$(KOSMOS_FUTURE_BOUND=020 bash -c '. "'"$HERE"'/lib/versions-entry.sh"; kosmos_versions_entry_gate 0.6.06 "'"$F"'" "c." "h." 20' 2>&1)"; rc=$?
if [ "$rc" -eq 0 ]; then pass "020 means TWENTY: an 18-min-ahead stamp still passes"; else fail "020 was read as octal 16: an 18-min-ahead stamp was refused (rc=$rc): $out"; fi

# and the magnitude bound, because fixing the octal case re-opened the 20-digit one
entry "$stale90"
out="$(run_early_bound 99999999999999999999)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "a 20-digit bound is still refused (it WRAPS rather than erroring)"; else fail "FAIL-OPEN: 20-digit bound passed (rc=$rc): $out"; fi


# --- THE SEVENTH INSTANCE: a leading zero in the OFFSET, not in a bound ---
# 🛑 The discriminating case is NEGATIVE. A positive `090` is caught first by the
# past comparison, which uses `test` and reads base 10; only a negative offset
# survives that and reaches `$((off + future_bound))`, where `-090` raises
# "value too great for base", aborts the command list, and lets a stamp NINETY
# MINUTES IN THE FUTURE through. Measured both ways: mutant rc=0 reached, fixed
# rc=1 refused, and the control `-90` refuses under both.
stub_dir="$T/nodestub"; mkdir -p "$stub_dir"
node_says() {
  printf '#!/bin/sh\necho "%s"\n' "$1" > "$stub_dir/node"; chmod +x "$stub_dir/node"
  entry "$(stamp_at 0)"
  PATH="$stub_dir:$PATH" kosmos_versions_entry_gate 0.6.06 "$F" "c." "h." "$KOSMOS_LATE_PAST_BOUND" 2>&1
}
out="$(node_says -090)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "an offset of -090 REFUSES (90 min in the future, leading zero)"; else fail "FAIL-OPEN: -090 passed, a 90-min-future stamp got through (rc=$rc): $out"; fi
out="$(node_says -90)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "CONTROL: -90 refuses too, so the arm above is not about the sign alone"; else fail "control: -90 should refuse (rc=$rc): $out"; fi
out="$(node_says 08)"; rc=$?
if [ "$rc" -eq 0 ]; then pass "CONTROL: an offset of 08 means EIGHT and passes a bound of 20"; else fail "08 was not read as 8 (rc=$rc): $out"; fi

# --- the magnitude boundary itself, which only a 20-digit value exercised ---
if kosmos_versions_entry_norm_or_die "b" 999999999 "" >/dev/null 2>&1; then pass "9 digits is accepted (the boundary, from below)"; else fail "9 digits should be accepted"; fi
if kosmos_versions_entry_norm_or_die "b" 1000000000 "" >/dev/null 2>&1; then fail "10 digits should be refused (the boundary, from above)"; else pass "10 digits is refused (the boundary, from above)"; fi


# --- THE 1b STEP LABEL, which had a long rationale and no arm ---
# 🛑 That label is the only thing giving a step 1 versions refusal its own bucket in
# cut-suite-runs.log, and the comment above it argues the measurement that justified this
# whole change depends on it. Deleting the line left BOTH suites fully green: a removed
# label looks exactly like one that was never there, and the failures just blend into
# step 1's bucket. Every other rationale on this branch is pinned by an arm; this was the
# one that was not.
n="$(grep -c 'step "== 1b' "$HERE/release.sh")"
if [ "$n" -eq 1 ]; then pass "the 1b step label exists, so step 1 refusals stay countable"; else fail "the 1b label is missing or duplicated (found $n); step 1 versions refusals would blend into step 1's bucket"; fi
lbl="$(grep -n 'step "== 1b' "$HERE/release.sh" | head -1 | cut -d: -f1)"
div="$(grep -n 'local main has commits' "$HERE/release.sh" | head -1 | cut -d: -f1)"
call="$(grep -n '^kosmos_versions_entry_gate ' "$HERE/release.sh" | head -1 | cut -d: -f1)"
if [ -n "$lbl" ] && [ -n "$div" ] && [ -n "$call" ] && [ "$lbl" -gt "$div" ] && [ "$lbl" -lt "$call" ]; then
  pass "and it sits after the divergence guard and before the gate call ($div < $lbl < $call)"
else fail "the 1b label is misplaced (divergence=$div label=$lbl call=$call)"; fi


# --- THE BOUND IS 4 AND NOT 5, AND THIS ARM IS WHY ---
# 🛑 At D=15.8 an entry 5 minutes old passes a bound of 5 and then reads 20.8 at
# step 7 and dies. The guarantee the design claims -- "step 1 can see that it is
# doomed" -- holds at 4 and not at 5. It was 5, "rounded in the operator's
# favour", and that rounding broke the guarantee in a one-minute band.
entry "$(stamp_at 5)"
out="$(run_early_bound "$KOSMOS_STEP1_PAST_BOUND")"; rc=$?
if [ "$rc" -eq 1 ]; then pass "a 5-minute-old entry is refused early (it would die at step 7)"; else fail "a 5-min-old entry passed step 1 and will die at step 7 (rc=$rc): $out"; fi
entry "$(stamp_at 3)"
out="$(run_early_bound "$KOSMOS_STEP1_PAST_BOUND")"; rc=$?
if [ "$rc" -eq 0 ]; then pass "CONTROL: a 3-minute-old entry still passes, so the bound is not refusing everything"; else fail "over-refusal: 3 min old was rejected (rc=$rc): $out"; fi

# --- the two call sites give DIFFERENT stamp advice, and early must not say "now" ---
# 🛑 THE ARM THAT PINS THE ACTUAL BUG: telling the operator at step 1 to stamp NOW
# guarantees a second failure at step 7, because the entry ages by the length of the
# cut in between. Early must say PUBLISH.
# ⚠️ Take each call site as a WHOLE continued command rather than assuming a
# fixed line count: awk joins lines while the previous one ends in a backslash,
# so re-wrapping either call cannot silently make this read the wrong lines.
# Each joined call is printed on ONE line, so line N is call N.
joined="$T/calls.txt"
awk '/^kosmos_versions_entry_gate /{c=$0; while (c ~ /\\$/) {sub(/\\$/,"",c); if ((getline nx) <= 0) break; c=c nx} print c}' \
  "$HERE/release.sh" > "$joined"
ncalls="$(wc -l < "$joined" | tr -d ' ')"
if [ "$ncalls" -eq 2 ]; then pass "found exactly two whole call sites to compare"; else fail "expected 2 call sites, parsed $ncalls -- the extraction, not the code, may be stale"; fi
early="$(sed -n 1p "$joined")"
late="$(sed -n 2p "$joined")"
if [ -n "$early" ] && [ -n "$late" ]; then pass "both call sites extracted non-empty"; else fail "extraction empty: early='$early' late='$late'"; fi
if has "$early" "PUBLISH"; then pass "the step 1 call tells the operator to stamp for publication"; else fail "step 1 stamp advice: $early"; fi
if has "$late" "Paste the clock line"; then pass "the step 7 call tells the operator to stamp now"; else fail "step 7 stamp advice: $late"; fi
# ⚠️ AND ASSERT WHICH BOUND EACH CALL SITE PASSES. Comparing only the prose let a
# swap of the two bounds through untouched -- measured, both suites stayed green.
if has "$early" "KOSMOS_STEP1_PAST_BOUND"; then pass "the step 1 call passes the TIGHT past bound"; else fail "step 1 does not pass KOSMOS_STEP1_PAST_BOUND: $early"; fi
if has "$late" "KOSMOS_LATE_PAST_BOUND"; then pass "the step 7 call passes the LATE past bound"; else fail "step 7 does not pass KOSMOS_LATE_PAST_BOUND: $late"; fi
if [ "$KOSMOS_STEP1_PAST_BOUND" -lt "$KOSMOS_LATE_PAST_BOUND" ]; then pass "and the early bound is genuinely tighter ($KOSMOS_STEP1_PAST_BOUND < $KOSMOS_LATE_PAST_BOUND)"; else fail "the early bound is not tighter: $KOSMOS_STEP1_PAST_BOUND vs $KOSMOS_LATE_PAST_BOUND"; fi

if [ "$early" = "$late" ]; then fail "both call sites give the same stamp advice; step 1 must not say 'now'"; else pass "the two call sites do not share one remediation sentence"; fi

# --- the gate is actually wired at BOTH call sites, in the right ORDER ---
# ⚠️ counting occurrences is not enough: a comment naming the function inflates it,
# and two calls both sitting in step 7 would still count 2. Assert the CALL shape
# (line-anchored) and that one of them precedes the step 2 banner.
n="$(grep -c '^kosmos_versions_entry_gate ' "$HERE/release.sh")"
if [ "$n" -eq 2 ]; then pass "release.sh calls the gate exactly twice"; else fail "release.sh should call the gate twice, found $n"; fi
first_call="$(grep -n '^kosmos_versions_entry_gate ' "$HERE/release.sh" | head -1 | cut -d: -f1)"
last_call="$(grep -n '^kosmos_versions_entry_gate ' "$HERE/release.sh" | tail -1 | cut -d: -f1)"
step2="$(grep -n 'step "== 2\. ' "$HERE/release.sh" | head -1 | cut -d: -f1)"
# ⚠️ ANCHOR THE LATE CALL ON STEP 7, NOT MERELY ON "after step 2". Pinned only
# as after-step-2, the late call could be moved to step 3 with every arm in both
# suites still green, re-opening the unguarded deploy window it exists to close.
# "After something early" is not a position.
step7="$(grep -n 'step "== 7\. ' "$HERE/release.sh" | head -1 | cut -d: -f1)"
if [ -n "$step2" ] && [ "$first_call" -lt "$step2" ]; then pass "one call runs BEFORE step 2, which is the whole point of the change"; else fail "no call before step 2 (first=$first_call step2=$step2)"; fi
if [ -n "$step7" ] && [ "$last_call" -gt "$step7" ]; then pass "and the late call sits inside step 7, where the deploy is"; else fail "the late call is not in step 7 (last=$last_call step7=$step7)"; fi

[ "$fails" -eq 0 ] || { echo "$fails failed"; exit 1; }
echo "all versions-entry gate arms behaved"
