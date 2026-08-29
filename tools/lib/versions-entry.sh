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
# and REJECTED: this guard exists because the four newest entries of
# 2026-08-21 "claimed release times that had not happened yet", so forward stamps
# are precisely what the guard catches, and a wider future window would make a
# guess satisfiable again.
#
# 🛑 THE PAST SIDE IS **NOT** THE SAME AT BOTH, AND AN EARLIER VERSION OF THIS
# HEADER SAID IT WAS. Step 1 accepts 4 minutes, step 7 accepts 20. The reasoning
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
# $3 is the cost sentence, so a bad-bound refusal says what is and is not spent
# like every other refusal in this file. It was the only one that did not.
kosmos_versions_entry_norm_or_die() {
  # 🛑 IT RETURNS THE CANONICAL VALUE. THAT IS THE POINT, NOT A CONVENIENCE.
  # This is the SIXTH instance of one class, and my FIFTH FIX CAUSED IT. The
  # shape is identical every time: the value is VALIDATED in one form and USED
  # in another.
  #   1-3  the offset, the past bound, the future bound: each guarded in turn,
  #        none of the others
  #   4    the validator tested the CHARACTER SET; the comparison used the VALUE
  #        (`99999999999999999999` looks like a number and is not usable as one)
  #   5    the bound was validated; the comparison used `"-$bound"`
  #   6    the bound was validated in BASE 10 by `test`, and used in `$(( ))`,
  #        which is base EIGHT for a leading zero
  #
  # ⚠️ INSTANCE 6 IS THE WORST OF THE SIX, MEASURED: `$((08))` does not evaluate
  # to something wrong, it RAISES "value too great for base", which ABORTS THE
  # ENCLOSING COMMAND LIST. So `kosmos_versions_entry_gate ... || exit 1` never
  # reaches its `|| exit 1`, the gate returns 0, and a NINETY-MINUTE-STALE ENTRY
  # PASSES on one line of stderr. `020` is quieter and still wrong: it silently
  # means 16, enforcing a window nobody chose. Both are reachable by a documented
  # action, because docs/releasing.md tells the operator all three bounds are
  # overridable and names them.
  #
  # ✅ SO VALIDATION AND CONVERSION ARE ONE OPERATION NOW. This echoes the value
  # the caller must use, in base 10 explicitly, and the caller uses THAT instead
  # of re-deriving it. There is no second form for the two to disagree about,
  # which is the only fix that closes the class rather than adding a seventh
  # check to it.
  #
  # ⚠️ Whitespace and a leading `+` are stripped rather than refused: both are
  # legitimate spellings an operator may type, and the previous probe accepted
  # them, so refusing them here would be a silent behaviour change on top of a
  # bug fix.
  local raw="$2" v
  v="${raw#"${raw%%[![:space:]]*}"}"
  v="${v%"${v##*[![:space:]]}"}"
  v="${v#+}"
  case "$v" in
    ''|*[!0-9]*)
      # 🛑 STDERR, AND NOT stdout, AND THIS IS NOT AN INCONSISTENCY.
      # THIS FUNCTION'S STDOUT IS ITS RETURN CHANNEL: the caller does
      # `past_bound="$(kosmos_versions_entry_norm_or_die ...)"`. A refusal
      # printed to stdout is CAPTURED AS THE VALUE. Measured, after a reviewer
      # reasonably suggested making it consistent with the gate's other
      # refusals and I tried it: the caller came back with
      # `captured=[   refusing: b is not a usable...]` and the shell suite went
      # red. The other refusals print to stdout because they are only messages;
      # this one returns something.
      echo "   refusing: $1 is not a usable whole number of minutes: '$raw'" >&2
      echo "   ${3:-}" >&2
      return 1 ;;
  esac

  # 🛑 AND A MAGNITUDE BOUND, BECAUSE FIXING INSTANCE 6 RE-CREATED INSTANCE 4.
  # The probe I replaced (`[ "$2" -ge 0 ]`) refused `99999999999999999999`; a
  # digits-only check accepts it, and `$((10#99999999999999999999))` does NOT
  # error -- it WRAPS, silently, to 7766279631452241919, which `test` is
  # perfectly happy to compare against. The gate would then allow a window of
  # 7.7 quintillion minutes, which is every stale entry that will ever exist.
  # Measured: the 20-digit bound reached the next step with rc=0 on a
  # ninety-minute-stale entry, in the same probe run that confirmed 08 fixed.
  #
  # ⚠️ So the FIX FOR ONE INSTANCE OF THIS CLASS RE-OPENED AN EARLIER ONE, in the
  # same edit, and only a probe that still carried the old cases caught it. Keep
  # every old case in the probe when you change how a value is validated.
  #
  # A window is minutes. Nine digits is nearly two thousand years; anything
  # longer is not a window, it is a typo or an overflow.
  local bare="${v#"${v%%[!0]*}"}"; bare="${bare:-0}"
  if [ "${#bare}" -gt 9 ]; then
    echo "   refusing: $1 is not a plausible number of minutes: '$raw'" >&2
    echo "   ${3:-}" >&2
    return 1
  fi
  # `10#` is exactly what defeats the octal reading: $((08)) errors, $((10#08))
  # is 8, and $((10#020)) is 20 rather than 16.
  printf '%s\n' "$((10#$v))"
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
  # 📌 `2>/dev/null` makes "this article has no rel-d" and "awk itself failed"
  # produce the same empty result. It fails CLOSED -- empty becomes unparseable
  # becomes a refusal -- so the direction is safe, but an operator with a broken
  # awk is told "that is not a date this gate can read". Same objection this file
  # raises about silencing the diagnostic on an unreadable file, and kept only
  # because the alternative is noise on every article that legitimately has no
  # stamp yet. Named so it is a known trade rather than an oversight.
}

# Prints `unparseable`, or the SIGNED minute offset (positive = the entry is in
# the past). It deliberately applies NO window: the two call sites need different
# past-side bounds, and a function that pre-judged would force a second copy of
# the comparison. One offset, one comparison, in the gate below.
#
# 🛑 #1464: the stamp is written in America/Chicago (see insert-release-entry.js),
# so this reader INTERPRETS IT IN America/Chicago too, via TZ on the node call
# below, regardless of the machine's own timezone. Before this it parsed in the
# MACHINE's local timezone: on a non-Central release box a freshly written entry
# read ~300 minutes (CDT) or ~360 (CST) in the PAST, and step 1 refused every cut,
# for everybody. TZ=America/Chicago is DST-aware, so it reads a summer stamp as CDT
# and a winter stamp as CST -- and it deliberately IGNORES the page's trailing
# token, because that token is a literal CDT the writer hard-codes even in winter,
# so the wall-clock time is the trustworthy part and the label is not. The label
# itself is corrected in insert-release-entry.js for the human reading the page.
kosmos_versions_entry_stamp_off() {
  TZ=America/Chicago V_ENTRY="$1" node -e "
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
# attempt, P must be 4 or less.
#
# 📌 IT WAS 5, "rounded in the operator's favour", AND THAT ROUNDING BROKE THE
# GUARANTEE THE PARAGRAPH ABOVE MAKES. At exactly P=5 with D=15.8 the entry
# passes step 1 and then reads 20.8 at step 7 and dies -- the precise failure
# this asymmetry exists to prevent, surviving in a one-minute band. "Step 1 can
# see that it is doomed" is only true at 4. Rounding in the operator's favour is
# the wrong direction for a bound whose whole job is to refuse early.
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
# explain why. BEFORE THE FIX: KOSMOS_LATE_PAST_BOUND=99 sourced as 20. Today it
# is 99, asserted in the shell suite. (Written in the present tense at first,
# directly above the line that fixed it, which reads as the current behaviour.)
KOSMOS_STEP1_PAST_BOUND="${KOSMOS_STEP1_PAST_BOUND:-4}"
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
  past_bound="$(kosmos_versions_entry_norm_or_die "the past-side bound" "$past_bound" "$cost")" || return 1
  local future_bound
  future_bound="$(kosmos_versions_entry_norm_or_die "the future-side bound" "$KOSMOS_FUTURE_BOUND" "$cost")" || return 1

  # 🛑 NORMALISE, THEN NEVER BUILD A NUMBER OUT OF STRING PIECES AGAIN. This is
  # the FIFTH instance of the same fail-open, and the first four were all fixed
  # by validating an INPUT while the code went on comparing a DERIVED value.
  # `" 20"` and `"+20"` are usable numbers and pass the validator correctly; the
  # thing that broke was `"-$KOSMOS_FUTURE_BOUND"`, giving `"- 20"` and `"-+20"`,
  # which are not. Measured: a stamp 60 minutes in the future PASSED under both,
  # printing "its timestamp agrees with the clock", with 40 shell arms and 21
  # node arms green.
  #
  # ⚠️ AND MY OWN SUITE FED `" 20"` TO THE PAST BOUND AS A DELIBERATE "usable
  # bound" CONTROL. The accepting shape was exercised on the axis where it is
  # harmless and never on the axis where it is fatal. A control can be correct,
  # deliberate, and aimed one argument away from the defect.
  #
  # ✅ `$(( ))` AFTER the validator, never before: `$(( abc ))` is 0 in bash, so
  # normalising first would turn a refusal into a zero bound and invent a sixth
  # instance. Then compare arithmetically -- `off < -future` is `off + future < 0`
  # -- so there is no negative to spell and nothing derived to leave unchecked.
  # 🛑 AND `off` GOES THROUGH THE SAME NORMALISER, BECAUSE IT IS THE SEVENTH
  # INSTANCE OTHERWISE. Both bounds are routed through it precisely so validation
  # and use cannot disagree; `off` was the one derived value still validated as a
  # CHARACTER SET and then used in `$(( ))` below. With node stubbed to print
  # `08`, bash raises "value too great for base", which aborts the enclosing
  # command list, `|| exit 1` never runs, and the cut proceeds. Identical
  # mechanism to instance 6, one value over.
  # ⚠️ Not reachable from today's node snippet, which emits String(Math.round()).
  # Guarded anyway, for the reason this file already gives about the unreachable
  # `-*)` arm: the whole point of the block is not trusting the caller.
  if [ "$off" != "unparseable" ]; then
    local _sign="" _mag="$off"
    case "$off" in -*) _sign="-"; _mag="${off#-}" ;; esac
    _mag="$(kosmos_versions_entry_norm_or_die "the offset" "$_mag" "$cost")" || return 1
    off="${_sign}${_mag}"
  fi

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
  if [ $((off + future_bound)) -lt 0 ]; then
    echo "   the entry for $v is stamped: $stamp"
    echo "   the clock says:              $now"
    echo "   that is ${off#-} minutes in the FUTURE, and this gate allows $future_bound."
    echo "   No cut can reach it. A stamp"
    echo "   this far ahead is a guess, and a guess is what this gate exists to refuse."
    echo "   $stamp_fix $cost"
    return 1
  fi
  echo "   its timestamp agrees with the clock"
  return 0
}
