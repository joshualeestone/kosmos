#!/usr/bin/env bash
# No shared shell lib may declare or assign a zsh-tied name (#1621, #1620).
#
# 🛑 WHAT THE DEFECT IS. zsh TIES four variables to their array forms: `path`,
# `cdpath`, `fpath`, `manpath`. A scalar `local path` DESTROYS PATH for that
# function's dynamic scope, so every command it calls dies with "command not
# found". THE DECLARATION ALONE IS ENOUGH; no assignment is required, which is
# why the observed failure landed on line 2 of `_site_left_behind` rather than
# at its `path=` twenty lines later.
#
# ⚠️ IT ONLY BITES WHEN A LIB IS SOURCED, NOT EXECUTED. Under bash these files
# are correct, and they are normally executed. It bites the agent who reaches
# for `source` to reuse one helper, which is a reasonable thing to want, and
# the symptom reads as a broken machine rather than a broken script.
#
# 🛑 THE SWEEP IS UNANCHORED ON PURPOSE, AND THAT IS THE HALF THAT WAS MISSED
# TWICE. Both real sites are mid-line:
#     local site="${1:?}" out="${2:?}" line path kind ...   <- a BARE name
#     kind="${line:0:2}"; path="${line:3}"                  <- after a semicolon
# `grep -c '^path='` returns 0 on a file that plainly contains both. Two people
# searched independently and the anchored search came back clean for both.
#
#   bash tools/test-zsh-tied-names.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }

TIED='path cdpath fpath manpath'

# Every shell file in the tree, NUL-delimited so a glob that matches nothing
# cannot abort the sweep and report a clean zero.
#
# 🛑 THIS FILE EXCLUDES ITSELF, AND THAT IS NOT TIDINESS. A detector has to spell
# what it detects: the four names appear here in grep patterns and in the planted
# fixture below. Run against itself it reports five offenders in its own prose and
# code and goes red on a clean tree, which is a false alarm that trains people to
# ignore it. Measured on the first run of this file.
# ⚠️ THE COST, STATED: a real offender written INTO this file would not be caught.
# Accepted because this file is a test, never sourced into a shell, and the planted
# fixture below proves the patterns still work on a file that is scanned.
find "$ROOT" -type f -name '*.sh' -not -path '*/node_modules/*' \
     ! -name 'test-zsh-tied-names.sh' -print0 > "$T/files.z"
FILE_COUNT=$(tr -dc '\0' < "$T/files.z" | wc -c | tr -d ' ')

# 🛑 A POPULATION FLOOR, BEFORE ANY ASSERTION. Every check below is an ABSENCE
# claim, and an absence claim over an empty file list is true for the wrong
# reason and reads exactly like a pass.
if [ "$FILE_COUNT" -ge 30 ]; then
  pass "the sweep found $FILE_COUNT shell files to look at"
else
  fail "the sweep found only $FILE_COUNT shell files, so every absence claim below is vacuous"
fi

# Two patterns, because one cannot see the other's shape: an assignment
# (`path=`, anywhere on the line) and a BARE name in a declaration list.
#
# 🛑 FULL-LINE COMMENTS ARE STRIPPED BEFORE MATCHING. Several libs DOCUMENT this
# hazard in prose, and a sweep that reads its own warning as an offence reports
# the files that are most careful about it. The strip is `^[[:space:]]*#` only:
# a trailing comment after real code is left in, because code on that line is
# still code and dropping the whole line would hide it.
# 📌 Line numbers are preserved by substituting rather than deleting, so a real
# hit still names the line you have to open.
scan() {
  local pat="$1" f
  while IFS= read -r -d '' f; do
    # 🛑 QUOTED TEXT IS BLANKED TOO, NOT JUST COMMENTS, and this is the OTHER
    # failure direction rather than a refinement. Measured on the real tree:
    #   local bin="${1:?connector_provenance needs the connector path}" cfile ...
    # The word `path` is inside an ERROR MESSAGE. Without this the guard reports
    # that file as writing a tied name, which is a guard firing on a MENTION
    # instead of a USE - and a guard that cries wolf is ignored, after which it
    # guards nothing.
    # 📌 A real write survives the blanking, because the NAME sits outside the
    # quotes in every form that matters: `path="..."`, `local path`,
    # `for path in "$@"`, `read path`. Only the quoted CONTENT is removed.
    sed -e 's|^[[:space:]]*#.*$||' -e 's|"[^"]*"||g' -e "s|'[^']*'||g" "$f" \
      | grep -nE "$pat" | sed "s|^|${f}:|"
  done < "$T/files.z"
}
#
# 🛑 ENUMERATE THE SYNTACTIC POSITIONS THAT WRITE A VARIABLE, NOT THE ONE YOU
# HAPPEN TO PICTURE. The first version of this file checked assignment and
# declaration only, and shipped BLIND to the very form the bulletin is named
# after:
#
#     for path in a b c    <- NO EQUALS SIGN ANYWHERE. Measured: PATH DESTROYED.
#     read path            <- likewise. Measured: PATH DESTROYED.
#     control: for zzz in  <- survives, so the measurement means something
#
# ⇒ I was searching the syntax of ASSIGNMENT while the hazard lives in
# ITERATION. The blind spot is always whichever form your mental model of
# "using a variable" defaults to, which is why this is a LIST rather than a
# cleverer single pattern: a list can be reviewed for what is missing.
#
# ⚠️ WRITES ONLY, AND THAT BOUNDARY IS DELIBERATE. Expansion (`$path`,
# `${path}`) READS the variable and cannot destroy PATH, and including it would
# fire on every legitimate `$PATH` in the tree, which is the other failure
# direction: a guard that cries wolf gets ignored and then it guards nothing.
#
# 📌 KNOWN UNCOVERED WRITE POSITIONS, named rather than left to be discovered:
# `getopts OPTSTRING path`, `printf -v path`, `mapfile -t path`, and an indirect
# write through `eval` or a nameref. None appears in this tree today. They are a
# smaller class than the four below and each would need its own pattern.
scan_assign()  { scan "(^|[^a-zA-Z_])$1="; }
# 🛑 NOT ANCHORED TO LINE START. `f() { local a b path c; }` is a real shape and an
# anchored pattern scores it 0 while zsh scores it PATH-DESTROYED (both measured).
# This is the SAME anchoring trap the cards warned about, one layer in: I fixed it
# for the assignment pattern and left it in the declaration pattern, and my own
# per-position control is what caught it.
scan_declare() { scan "(^|[[:space:]]|;|\{)[[:space:]]*(local|declare|typeset)[[:space:]].*(^|[[:space:]])$1([[:space:]]|=|;|\}|\$)"; }
scan_for()     { scan "(^|[[:space:]]|;)(for|select)[[:space:]]+$1([[:space:]]|\$)"; }
scan_read()    { scan "(^|[[:space:]]|;|\|)read([[:space:]]+-[^[:space:]]+)*[[:space:]]+([^[:space:]]+[[:space:]]+)*$1([[:space:]]|\$)"; }

for v in $TIED; do
  a="$(scan_assign "$v" || true)"
  d="$(scan_declare "$v" || true)"
  f="$(scan_for "$v" || true)"
  r="$(scan_read "$v" || true)"
  if [ -z "$a" ] && [ -z "$d" ] && [ -z "$f" ] && [ -z "$r" ]; then
    pass "no shell file writes \`$v\` (assignment, declaration, for/select, read)"
  else
    fail "a shell file writes the zsh-tied name \`$v\`, which destroys PATH when sourced into zsh:"
    printf '%s\n%s\n%s\n%s\n' "$a" "$d" "$f" "$r" | grep -v '^$' | sed 's|^|        |'
  fi
done

# 🛑 THE POSITIVE CONTROL. Both patterns must FIND a planted offender, or the
# four passes above are equally consistent with a sweep that matches nothing.
# One file, both shapes, so each pattern is proven separately.
mkdir -p "$T/plant"
# 🛑 ONE PLANT PER SYNTACTIC POSITION. A single fixture would let three blind
# patterns hide behind one that works: the file would go red, somebody would call
# the controls good, and the missing positions would stay missing. That is exactly
# how the `for` hole shipped in the first version of this file.
{
  echo '#!/usr/bin/env bash'
  echo 'f() { local a b path c; }'
  echo 'g() { x=1; cdpath="/tmp"; }'
  echo 'h() { for fpath in a b c; do :; done; }'
  echo 'i() { read -r manpath < /dev/null; }'
} > "$T/plant/offender.sh"
printf '%s\0' "$T/plant/offender.sh" > "$T/plantfiles.z"
plant() { xargs -0 grep -nE "$1" < "$T/plantfiles.z" 2>/dev/null || true; }
pa="$(plant '(^|[^a-zA-Z_])cdpath=')"
pd="$(plant '(^|[[:space:]]|;|\{)[[:space:]]*(local|declare|typeset)[[:space:]].*(^|[[:space:]])path([[:space:]]|=|;|\}|$)')"
pf="$(plant '(^|[[:space:]]|;)(for|select)[[:space:]]+fpath([[:space:]]|$)')"
pr="$(plant '(^|[[:space:]]|;|\|)read([[:space:]]+-[^[:space:]]+)*[[:space:]]+([^[:space:]]+[[:space:]]+)*manpath([[:space:]]|$)')"
if [ -n "$pa" ]; then pass "control: the ASSIGNMENT pattern finds a planted \`cdpath=\`"; else fail "control: the assignment pattern is blind, so its passes above mean nothing"; fi
if [ -n "$pd" ]; then pass "control: the DECLARATION pattern finds a planted bare \`path\`"; else fail "control: the declaration pattern is blind, so its passes above mean nothing"; fi
if [ -n "$pf" ]; then pass "control: the FOR pattern finds a planted \`for fpath in\`"; else fail "control: the for pattern is blind, which is the hole this change exists to close"; fi
if [ -n "$pr" ]; then pass "control: the READ pattern finds a planted \`read -r manpath\`"; else fail "control: the read pattern is blind, so its passes above mean nothing"; fi

# 🛑 AND THE NEGATIVE CONTROL FOR THE ANCHORED FORM, which is the trap this card
# was written around. It must FAIL to find the planted offender, proving the
# unanchored form above is not merely equivalent.
anchored="$(xargs -0 grep -nE '^path=' < "$T/plantfiles.z" 2>/dev/null || true)"
if [ -z "$anchored" ]; then
  pass "control: the ANCHORED pattern misses the planted offender, which is why this sweep is unanchored"
else
  fail "control: the anchored pattern found it, so this file's premise about the grep trap is wrong"
fi

# --- the behaviour itself, in a real zsh, if one is here -------------------
# 🛑 EVERY ARM BELOW RUNS AN EXTERNAL BINARY (`ls`) RATHER THAN ASKING
# `command -v`. A lookup is a PROXY for the harm; executing something is the harm
# itself. The shell's own words are `f: command not found: ls`, which is exactly
# what an agent sees when this bites, and it is why the failure reads as a broken
# machine rather than a broken script.
# 📌 `ls` and not `mktemp`: both are external, and `ls` is the command somebody
# reaches for first when they think the box is broken.
if command -v zsh >/dev/null 2>&1; then
  # The fixed lib: sourcing it into zsh and calling the function must leave the
  # shell able to run commands.
  out="$(zsh -f -c '
    . '"$ROOT"'/tools/lib/disk-guard.sh
    kosmos_require_free_mb 1 / "the zsh check" >/dev/null 2>&1
    ls /dev/null >/dev/null 2>&1 && echo SURVIVED || echo PATH-DESTROYED
  ' 2>&1 | tail -1)"
  case "$out" in
    *SURVIVED*)
      pass "sourcing disk-guard.sh into zsh and calling it leaves PATH intact" ;;
    *) fail "sourcing disk-guard.sh into zsh destroyed PATH (got: $out)" ;;
  esac

  # 🛑 THE TWO FORMS THAT SHIPPED UNGUARDED, SHOWN DESTROYING PATH IN A REAL zsh.
  # These are the reason this file grew a `for` and a `read` pattern: the hazard is
  # not "an assignment to path", it is "a WRITE to path", and iteration is a write.
  out="$(zsh -f -c 'f() { for path in a b c; do :; done; ls /dev/null >/dev/null 2>&1 && echo STILL-FOUND || echo PATH-DESTROYED; }; f' 2>&1 | tail -1)"
  case "$out" in
    *PATH-DESTROYED*) pass "control: \`for path in\` destroys PATH in this zsh, with no equals sign anywhere" ;;
    *) fail "control: \`for path in\` did NOT destroy PATH here (got: $out), so the for-pattern guards nothing" ;;
  esac
  out="$(zsh -f -c 'g() { read path <<< "x"; ls /dev/null >/dev/null 2>&1 && echo STILL-FOUND || echo PATH-DESTROYED; }; g' 2>&1 | tail -1)"
  case "$out" in
    *PATH-DESTROYED*) pass "control: \`read path\` destroys PATH in this zsh" ;;
    *) fail "control: \`read path\` did NOT destroy PATH here (got: $out), so the read-pattern guards nothing" ;;
  esac
  # 🛑 `select` TOO, AND THE FIRST TWO ATTEMPTS AT THIS ARM WERE BOTH WRONG IN THE
  # SAME WAY - mine and a reviewer's, independently. `select ... done < /dev/null`
  # reads EOF, makes no selection, and therefore NEVER BINDS THE VARIABLE, so it
  # reports STILL-FOUND and looks like proof that select is harmless. Feed it a real
  # choice and it destroys PATH like the others.
  # ⇒ A behavioural arm has to make the code actually REACH the write it is testing.
  out="$(zsh -f -c 'f() { select path in a b; do break; done <<< "1"; ls /dev/null >/dev/null 2>&1 && echo STILL-FOUND || echo PATH-DESTROYED; }; f' 2>&1 | tail -1)"
  case "$out" in
    *PATH-DESTROYED*) pass "control: \`select path in\` destroys PATH once a choice is actually made" ;;
    *) fail "control: \`select path in\` did NOT destroy PATH here (got: $out), so the select half of the for-pattern guards nothing" ;;
  esac

  # 🛑 AND THE NEGATIVE ARM, so the two above are not simply "any loop breaks zsh".
  out="$(zsh -f -c 'h() { for zzz in a b; do :; done; select qqq in a b; do break; done <<< "1"; ls /dev/null >/dev/null 2>&1 && echo STILL-FOUND || echo PATH-DESTROYED; }; h' 2>&1 | tail -1)"
  # `case`, not `=`: zsh's `select` prints its own `?#` prompt, which lands in the
  # captured line. A bare equality comparison fails on a correct result.
  case "$out" in
    *STILL-FOUND*) pass "control: UNtied loop and select variables are harmless, so it is the NAME that matters" ;;
    *) fail "control: an untied loop variable also broke PATH (got: $out), so these arms are measuring something else" ;;
  esac

  # 🛑 THE CONTROL THAT MAKES THAT MEAN SOMETHING: the OLD shape must still break,
  # in the same zsh, in the same invocation style. Without this, SURVIVED is
  # equally consistent with the check never exercising the hazard at all.
  out="$(zsh -f -c '
    broken() { local a b path c; ls /dev/null >/dev/null 2>&1 && echo STILL-FOUND || echo PATH-DESTROYED; }
    broken
  ' 2>&1 | tail -1)"
  case "$out" in
    *PATH-DESTROYED*) pass "control: the old shape (a bare \`local path\`) still destroys PATH in this zsh" ;;
    *) fail "control: a bare \`local path\` did NOT destroy PATH here (got: $out), so the check above proves nothing" ;;
  esac
else
  echo "SKIP  zsh is not on this machine, so the behavioural arms did not run"
fi

echo "zsh-tied names: $fails failures"; [ "$fails" -eq 0 ]
