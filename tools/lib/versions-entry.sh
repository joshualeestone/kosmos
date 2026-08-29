# The versions-page gate (#1463), factored out of step 7 so it can also run at
# step 1.
#
# 🛑 THE CHECK WAS NEVER WRONG. ITS POSITION WAS. Both halves need only `$V`
# (release.sh, `^V="`, taken from argv) and `$SITE` (`^SITE=`), and both exist
# before the script does any work at all -- yet the gate ran at step 7, after
# the suite, the browser gate, the install gate and the build. Four cuts died
# there (0.5.80, 0.5.90, 0.5.91, 0.6.06), each paying about fifteen minutes of
# machine time to be told something knowable in three seconds.
#
# 🔑 THE EARLY CALL DOES NOT REPLACE THE LATE ONE, AND THEY ASK DIFFERENT
# QUESTIONS. Early asks "can this cut finish?" before spending the machine.
# Late asks "is the page right at the moment we deploy?", which still has to
# hold because the site checkout can change under a cut that runs for fifteen
# minutes. Moving the gate instead of adding to it would trade a slow failure
# for an unguarded deploy.
#
# ⚠️ ONE FUNCTION, TWO CALL SITES, ON PURPOSE. Two copies of a window is the
# stale-assertion shape: somebody widens one and the other keeps refusing, and
# a guard that disagrees with itself is worse than either answer alone.
#
# ⭐ THE FUTURE SIDE IS 20 AT BOTH CALL SITES AND STAYS THERE. A stamp written
# for publication sits about fifteen minutes ahead at step 1, giving off = -15,
# which passes -- measured, not assumed. Widening the future side was proposed
# and REJECTED: release.sh's own comment records that the four newest entries of
# 2026-08-21 "claimed release times that had not happened yet", so forward stamps
# are precisely what the guard catches, and a wider future window would make a
# guess satisfiable again.
#
# 🛑 THE PAST SIDE IS **NOT** THE SAME AT BOTH, AND AN EARLIER VERSION OF THIS
# HEADER SAID IT WAS. Step 1 accepts 5 minutes, step 7 accepts 20. The reasoning
# is at the gate function below, which is where the numbers live. The REASONING
# is also stated in release.sh beside the step 1 call and at length in
# docs/releasing.md, because each has a different reader; the NUMBERS are only
# here. If you are reading this header for the window, read the gate.
#
# ⚠️ That earlier sentence ("the window is symmetric and stays symmetric") was
# true when written and false one change later, and it sat directly above code
# doing the opposite. It is called out rather than quietly deleted because a
# header that contradicts its own file is the failure this note now guards: a
# reader who stops at the top leaves with a false model of the gate.

# 📌 The anchors in the header are grep patterns, not line numbers, on purpose: a
# line number in a comment goes stale with the next edit and nothing notices.
# This tree has a live example: tools/browser-checks.sh carries a comment saying
# "release.sh:243 invokes this from inside ( ... )", and the invocation is
# nowhere near 243 on any branch.
#
# 📌 I first wrote "and the invocation is at 357". It was 370 here and 336 on
# main, so my illustration of a stale line number was itself a stale line
# number, inside the paragraph arguing against them. The figure is gone rather
# than corrected: any number I write here needs maintaining, which is the whole
# point being made. Run `grep -n browser-checks tools/release.sh` if you want
# today`s value.
kosmos_versions_entry_id() { echo "v$(echo "$1" | tr . -)"; }

# 🛑 ONE VALIDATOR FOR EVERY BOUND, BECAUSE FIXING THIS PER-ARGUMENT FAILED TWICE.
# The same fail-open has now been found three times in this file, on three
# different values: the offset, then the past bound, then the future bound. Each
# time it was fixed where it was found, and each time the next one was left. The
# mechanism is identical every time -- `[ x -gt y ]` with a non-integer does not
# evaluate false, it EXITS 2, so the `if` reads false, the next one errors too,
# and control reaches "its timestamp agrees with the clock" and returns 0.
#
# ⚠️ AND THE FUTURE BOUND WAS THE WORST PLACE TO LEAVE IT: that axis is the one
# the guard exists for. On 2026-08-21 the four newest entries claimed release
# times that had not happened yet; a non-integer KOSMOS_FUTURE_BOUND made a stamp
# 60 minutes in the future PASS, printing "its timestamp agrees with the clock"
# with nothing but a stray `[: integer expression expected` on stderr to notice.
#
# ⇒ So this is a validator rather than three more `case` blocks: any bound this
# gate compares against goes through here, and adding a fourth bound without
# validating it is now the unusual thing to write rather than the default.
kosmos_versions_entry_int_or_die() {
  # 🛑 AN ARITHMETIC PROBE, NOT A CHARACTER-CLASS TEST, AND THAT DISTINCTION IS
  # THE FOURTH INSTANCE OF THIS BUG. The previous version tested
  # `case "$2" in ''|*[!0-9]*)`, which asks whether the string LOOKS like a
  # number. `99999999999999999999` looks like one and is not usable as one: it
  # passed the validator, and then `[ "$off" -gt "$bound" ]` exited 2 exactly as
  # `abc` did, both comparisons read false, and the gate returned 0 on a
  # ten-hour-stale entry, printing "its timestamp agrees with the clock".
  #
  # ⚠️ SO THE VALIDATOR I WROTE TO END THIS CLASS CONTAINED THE CLASS. Three
  # instances were the offset, the past bound and the future bound; this is the
  # fourth, one layer up, in the thing that was supposed to make a fourth
  # impossible. Generalising the FIX is not the same as generalising the TEST:
  # I asked every bound the same question and the question was the wrong one.
  #
  # ✅ The probe asks the shell to USE the value the way the gate will, which is
  # the only question that matters. Refuses '', abc, 1-5, -5 and the 20-digit
  # value; accepts 20, 0 and 020.
  # ⚠️ EMPTY IS CHECKED SEPARATELY BECAUSE THE PROBE IS SHELL-DEPENDENT ON IT.
  # Measured: `[ "" -ge 0 ]` REFUSES under bash and ACCEPTS under zsh. release.sh
  # is bash, so the probe alone would be correct there and wrong if this lib were
  # ever sourced from a zsh context. A guard whose verdict depends on which shell
  # is running is the same defect class as a check that depends on which node the
  # runner shipped (kosmos#1462), and it costs one line to remove.
  if [ -z "$2" ] || ! [ "$2" -ge 0 ] 2>/dev/null; then
    echo "   refusing: $1 is not a usable whole number of minutes: '$2'"
    return 1
  fi
  return 0
}

# Prints the entry's rel-d string, or nothing when there is no entry.
# ⚠️ ONE awk PROCESS, NOT `sed | sed | head -1`. release.sh runs with
# `set -o pipefail`, and a `head -1` that exits early can SIGPIPE the upstream
# sed. Today both call sites sit inside an `|| exit 1` list, which suppresses
# errexit for the whole function body, so it would have been harmless -- and a
# third call site written without the `||` would have aborted the cut with no
# message at all. Removing the pipe removes the trap instead of documenting it.
kosmos_versions_entry_stamp() {
  local v="$1" file="$2" id
  id="$(kosmos_versions_entry_id "$v")"
  awk -v id="$id" '
    index($0, "id=\"" id "\"") { inentry = 1 }
    inentry && match($0, /rel-d">[^<]*</) {
      print substr($0, RSTART + 7, RLENGTH - 8); exit
    }
    # 🛑 STOP AT THE END OF **THIS** ARTICLE. Without this, `inentry` never clears
    # and an article carrying NO rel-d silently takes the next entry`s stamp --
    # measured against the sed version it replaced, which returned empty on the
    # same fixture while this returned the following release`s timestamp. Empty
    # refuses; a neighbour`s stamp can PASS, and entries are newest-first, so on
    # a same-session re-cut the previous release`s stamp is plausibly inside the
    # window. That turns a missing timestamp into a green gate.
    # ⚠️ Per RECORD, so an article whose closing tag shares a physical line with
    # the NEXT article`s rel-d would still borrow it. Unreachable against the
    # real page and against all three fixture producers, which all emit the
    # multi-line shape -- recorded because that means a page reformat is the one
    # thing that would reopen this, and no fixture would notice.
    # (Backtick, not apostrophe: this comment is INSIDE the single-quoted awk
    # program, and an apostrophe here ends the quote and breaks the file. I did
    # exactly that writing this line.)
    inentry && /<\/article>/ { exit }
  ' "$file" 2>/dev/null
}

# Prints `unparseable`, or the SIGNED minute offset (positive = the entry is in
# the past). It deliberately applies NO window: the two call sites need different
# past-side bounds, and a function that pre-judged would force a second copy of
# the comparison. One offset, one comparison, in the gate below.
#
# ⚠️ KNOWN AND NOT FIXED HERE: this parses the entry in the MACHINE's local
# timezone and ignores the page's trailing timezone token entirely, while
# tools/insert-release-entry.js writes America/Chicago and hard-codes the literal
# `CDT`. On a non-Central machine, or in winter when that literal is simply
# wrong, the gate measures a different quantity than the page claims. Pre-existing
# in the step 7 inline version and carried here verbatim; it is a correctness bug
# in its own right and is carded as #1464, not a quiet rewrite inside a
# positioning change.
kosmos_versions_entry_stamp_off() {
  V_ENTRY="$1" node -e "
  const s = process.env.V_ENTRY || '';
  const m = s.match(/^(\w+) (\d+), (\d+), (\d+):(\d+) (AM|PM)/);
  if (!m) { console.log('unparseable'); process.exit(0); }
  const months = 'January February March April May June July August September October November December'.split(' ');
  let h = Number(m[4]) % 12; if (m[6] === 'PM') h += 12;
  const t = new Date(Number(m[3]), months.indexOf(m[1]), Number(m[2]), h, Number(m[5]));
  const off = Math.round((Date.now() - t.getTime()) / 60000);
  // A parseable-looking date can still yield NaN (month 13, year 999999).
  console.log(Number.isFinite(off) ? String(off) : 'unparseable');
"
}

# The whole gate.
#   $1 version
#   $2 versions.html
#   $3 the cost sentence -- what is and is not already spent at this call site
#   $4 the stamp remediation -- DIFFERENT at the two call sites, deliberately
#   $5 the accepted PAST-side bound in minutes -- SMALLER at step 1, deliberately
#
# 🛑 $4 EXISTS BECAUSE ONE REMEDIATION SENTENCE CANNOT SERVE BOTH GATES, AND THE
# OBVIOUS ONE IS WRONG EARLY. "Paste the clock line above" means "stamp it now".
# Stamp now at step 1 and the entry arrives at step 7 reading `off = +D`, where D
# is how long the cut takes to get there -- so the advice guarantees a SECOND
# failure whenever D > 20, and no stamp satisfies both gates once D > 40.
#
# 🛑 $5 EXISTS BECAUSE A SYMMETRIC WINDOW AT STEP 1 CLOSES ONLY HALF THE BUG, AND
# THE HALF IT LEAVES OPEN IS THE ONE THAT ACTUALLY KEEPS HAPPENING. An entry
# already 15 minutes old reads `off = +15` at step 1, passes a +/-20 window, then
# reads `off = +15+D` at step 7 and dies AFTER the suite, the browser gate, the
# install gate and the build. That is precisely the re-cut failure
# docs/releasing.md describes: "the entry is written once, by hand, so every
# failed attempt ages it."
#
# 🔑 SO STEP 1 IS STRICTER ON THE PAST SIDE THAN STEP 7, AND THAT ASYMMETRY IS THE
# POINT rather than an inconsistency. Step 1 can see that an already-stale entry
# is DOOMED; step 7 only has to judge the entry in front of it. The arithmetic:
# an entry `P` minutes old at step 1 arrives at step 7 reading `P + D`, so it
# survives only while `P + D <= 20`. With D measured at 15m46s on the 0.6.06
# attempt, P must be about 4 or less. STEP1_PAST_BOUND is 5, which is that number
# with the rounding in the operator's favour.
#
# ⚠️ THE FUTURE SIDE STAYS AT 20 AT BOTH CALL SITES AND IS NOT WIDENED. A forward
# stamp is what the guard was built to catch: on 2026-08-21 the four newest
# entries "claimed release times that had not happened yet", and a wider future
# window makes a guess satisfiable again. Tightening the past is not the same
# move as loosening the future, and only one of them reopens a known hole.
# ⚠️ `:-` SO AN EXPORTED VALUE SURVIVES BEING SOURCED. docs/releasing.md tells an
# operator stuck against the D > 40 ceiling that one option is to widen
# KOSMOS_LATE_PAST_BOUND, which reads as a knob -- and a bare assignment silently
# clobbered it, so the refusal came back unchanged with nothing on screen to
# explain why. Measured: KOSMOS_LATE_PAST_BOUND=99 . versions-entry.sh -> 20.
KOSMOS_STEP1_PAST_BOUND="${KOSMOS_STEP1_PAST_BOUND:-5}"
KOSMOS_LATE_PAST_BOUND="${KOSMOS_LATE_PAST_BOUND:-20}"
KOSMOS_FUTURE_BOUND="${KOSMOS_FUTURE_BOUND:-20}"

kosmos_versions_entry_gate() {
  local v="$1" file="$2" cost="${3:-}" stamp_fix="${4:-}"
  # ⚠️ DEFAULT FROM THE CONSTANT, NOT A LITERAL. A bare `${5:-20}` is a fourth
  # copy of the late bound, which is the exact stale-assertion shape this file's
  # header warns about: raise KOSMOS_LATE_PAST_BOUND and the literal keeps
  # enforcing the old value, silently.
  local past_bound="${5:-$KOSMOS_LATE_PAST_BOUND}"
  local id stamp off now

  # ⚠️ REFUSE A VERSION THAT IS NOT THE SHAPE WE BUILD THE ID FROM.
  # 📌 CORRECTED: an earlier version of this comment said the hazard was `$id`
  # being read as a PATTERN. It is not -- the presence check is `grep -qF` and
  # the reader uses awk `index()`, both literal. The real hazard is `awk -v
  # id=...`, which processes BACKSLASH ESCAPES in the assigned value, so a
  # version carrying a backslash would change what awk searches for. The guard
  # was right and its stated reason was wrong, which matters in a file this
  # comment-led: a wrong rationale is what gets copied forward.
  case "$v" in
    ''|*[!0-9.]*) echo "   refusing to check a version that is not digits and dots: '$v'"; return 1 ;;
  esac

  # ⚠️ AN UNREADABLE FILE IS NOT AN ABSENT ENTRY, and saying so matters: "write
  # the entry in versions.html" reads as "edit that file" for a file that is not
  # there. The old inline grep had no 2>/dev/null, so the operator at least saw
  # "No such file or directory" beside the refusal; silencing the diagnostic
  # without replacing it would have been a regression in what they can act on.
  if [ ! -r "$file" ]; then
    echo "   cannot read $file."
    echo "   That is the site checkout's versions page. Check the path, not the copy. $cost"
    return 1
  fi

  id="$(kosmos_versions_entry_id "$v")"
  # grep -F: the id is a fixed string, never a pattern.
  if ! grep -qF "id=\"$id\"" "$file"; then
    echo "   $v has no entry in $file."
    echo "   Write it (ruled copy, real timestamp) and re-run. $cost"
    return 1
  fi
  echo "   $v is on the page"

  stamp="$(kosmos_versions_entry_stamp "$v" "$file")"
  off="$(kosmos_versions_entry_stamp_off "$stamp")"
  now="$(date '+%B %-d, %Y, %-I:%M %p %Z')"

  # 🛑 ANYTHING THAT IS NOT AN INTEGER IS UNPARSEABLE, AND THIS TEST MUST COME
  # BEFORE THE COMPARISONS. `[ NaN -gt 5 ]` does not evaluate false, it ERRORS
  # (status 2), so the `if` reads false, the next `if` errors too, and control
  # falls through to "its timestamp agrees with the clock" and returns 0.
  # ⚠️ THAT IS A FAIL-**OPEN**, AND IT IS A DIRECTION CHANGE I INTRODUCED: the
  # code this replaced tested `[ "$STAMP_OK" != "ok" ]`, which is TRUE for ""
  # and for "NaN", so it failed CLOSED. Measured: an entry stamped
  # `August 28, 999999, 1:00 AM CDT` passed the gate, against a control of a
  # genuinely stale entry that correctly refused at 1090 minutes. An absent or
  # broken `node` produces empty output and lands here too.
  # `?*-*` catches an interior dash (`1-5`), which matched none of the other
  # patterns and was then treated as a number: `[ "1-5" -gt 5 ]` exits 2, the
  # same fall-through as NaN. Unreachable from today's node snippet, which emits
  # only `unparseable` or a rounded finite number -- kept because the whole point
  # of this block is that the caller cannot be trusted to have produced an int.
  case "$off" in
    ''|*[!0-9-]*|-|*-*-*|?*-*) off=unparseable ;;
    # 📌 UNREACHABLE, DELIBERATELY KEPT AND LABELLED. Anything with a character
    # outside [0-9-], a bare `-`, two dashes, or a dash after position 0 is
    # already caught above, so every value arriving here is a leading dash and
    # digits. Confirmed by construction and over 14 candidate strings. Kept
    # because this file argues that the caller cannot be trusted to have
    # produced an int, and a future edit to the pattern above could open it --
    # but labelled, because elsewhere this file calls an unreached branch dead
    # code, and an unlabelled one here would contradict that.
    -*) case "${off#-}" in *[!0-9]*) off=unparseable ;; esac ;;
  esac

  # EVERY bound this gate will compare against, validated before any comparison
  # runs. Both are env-overridable, so both can carry whatever a human typed.
  kosmos_versions_entry_int_or_die "the past-side bound" "$past_bound" || return 1
  kosmos_versions_entry_int_or_die "the future-side bound" "$KOSMOS_FUTURE_BOUND" || return 1
  if [ "$off" = "unparseable" ]; then
    echo "   the entry for $v is stamped: $stamp"
    echo "   that is not a date this gate can read. It wants the shape: $now"
    echo "   $stamp_fix $cost"
    return 1
  fi
  if [ "$off" -gt "$past_bound" ]; then
    echo "   the entry for $v is stamped: $stamp"
    echo "   the clock says:              $now"
    echo "   that is $off minutes in the past, and this gate allows $past_bound."
    echo "   $stamp_fix $cost"
    return 1
  fi
  if [ "$off" -lt "-$KOSMOS_FUTURE_BOUND" ]; then
    echo "   the entry for $v is stamped: $stamp"
    echo "   the clock says:              $now"
    echo "   that is ${off#-} minutes in the FUTURE, which no cut can reach. A stamp"
    echo "   this far ahead is a guess, and a guess is what this gate exists to refuse."
    echo "   $stamp_fix $cost"
    return 1
  fi
  echo "   its timestamp agrees with the clock"
  return 0
}
