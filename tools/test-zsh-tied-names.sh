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
    sed 's|^[[:space:]]*#.*$||' "$f" | grep -nE "$pat" | sed "s|^|${f}:|"
  done < "$T/files.z"
}
scan_assign()  { scan "(^|[^a-zA-Z_])$1="; }
scan_declare() { scan "^[[:space:]]*(local|declare|typeset)[[:space:]].*(^|[[:space:]])$1([[:space:]]|=|\$)"; }

for v in $TIED; do
  a="$(scan_assign "$v" || true)"
  d="$(scan_declare "$v" || true)"
  if [ -z "$a" ] && [ -z "$d" ]; then
    pass "no shell file assigns or declares \`$v\`"
  else
    fail "a shell file uses the zsh-tied name \`$v\`, which destroys PATH when sourced into zsh:"
    printf '%s\n%s\n' "$a" "$d" | grep -v '^$' | sed 's|^|        |'
  fi
done

# 🛑 THE POSITIVE CONTROL. Both patterns must FIND a planted offender, or the
# four passes above are equally consistent with a sweep that matches nothing.
# One file, both shapes, so each pattern is proven separately.
mkdir -p "$T/plant"
printf '#!/usr/bin/env bash\nf() {\n  local a b path c\n}\ng() {\n  x=1; cdpath="/tmp"\n}\n' > "$T/plant/offender.sh"
printf '%s\0' "$T/plant/offender.sh" > "$T/plantfiles.z"
pa="$(xargs -0 grep -nE '(^|[^a-zA-Z_])cdpath=' < "$T/plantfiles.z" 2>/dev/null || true)"
pd="$(xargs -0 grep -nE '^[[:space:]]*(local|declare|typeset)[[:space:]].*(^|[[:space:]])path([[:space:]]|=|$)' < "$T/plantfiles.z" 2>/dev/null || true)"
if [ -n "$pa" ]; then pass "control: the assignment pattern finds a planted \`cdpath=\`"; else fail "control: the assignment pattern is blind, so its four passes above mean nothing"; fi
if [ -n "$pd" ]; then pass "control: the declaration pattern finds a planted bare \`path\`"; else fail "control: the declaration pattern is blind, so its four passes above mean nothing"; fi

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
if command -v zsh >/dev/null 2>&1; then
  # The fixed lib: sourcing it into zsh and calling the function must leave the
  # shell able to run commands.
  out="$(zsh -f -c '
    . '"$ROOT"'/tools/lib/disk-guard.sh
    kosmos_require_free_mb 1 / "the zsh check" >/dev/null 2>&1
    command -v mktemp >/dev/null 2>&1 && echo SURVIVED || echo PATH-DESTROYED
  ' 2>&1 | tail -1)"
  if [ "$out" = "SURVIVED" ]; then
    pass "sourcing disk-guard.sh into zsh and calling it leaves PATH intact"
  else
    fail "sourcing disk-guard.sh into zsh destroyed PATH (got: $out)"
  fi

  # 🛑 THE CONTROL THAT MAKES THAT MEAN SOMETHING: the OLD shape must still break,
  # in the same zsh, in the same invocation style. Without this, SURVIVED is
  # equally consistent with the check never exercising the hazard at all.
  out="$(zsh -f -c '
    broken() { local a b path c; command -v mktemp >/dev/null 2>&1 && echo STILL-FOUND || echo PATH-DESTROYED; }
    broken
  ' 2>&1 | tail -1)"
  if [ "$out" = "PATH-DESTROYED" ]; then
    pass "control: the old shape (a bare \`local path\`) still destroys PATH in this zsh"
  else
    fail "control: a bare \`local path\` did NOT destroy PATH here (got: $out), so the check above proves nothing"
  fi
else
  echo "SKIP  zsh is not on this machine, so the behavioural arms did not run"
fi

echo "zsh-tied names: $fails failures"; [ "$fails" -eq 0 ]
