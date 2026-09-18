#!/bin/bash
# test-postinstall-inline-quoting.sh
#
# GUARD for the 0.6.77 installer P0: an empty-string pattern written as '' INSIDE
# an inline `/bin/sh -c '...'` block is read by the OUTER shell as
# close-quote + open-quote and VANISHES from the string the inner sh receives,
# turning `case "$x" in ''|*)` into `case "$x" in |*)` = "syntax error near |",
# which aborts the install. `sh -n` on the postinstall FILE does NOT catch it (it
# sees '' as balanced literals) - the bug only exists in the string the shell
# BUILDS for `-c` at runtime. This test reconstructs each inline `-c` block the way
# the shell does (the single-quote characters are delimiters, so the inner string
# is the block with its single-quotes removed) and runs `/bin/sh -n` THROUGH that -
# exactly the gate the file-level check missed (kosmos "a guard from the same
# mental model certifies the blind spot").
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
PI="$REPO/install/pkg-scripts/postinstall"
fails=0
[ -f "$PI" ] || { echo "FAIL  postinstall not found at $PI"; exit 1; }

# Independent oracle for the anti-vacuity guard: how many inline `/bin/sh -c`
# invocations OPEN in the file. An invocation opens when a line ends in either
# `/bin/sh -c \` (backslash line-continuation, arg opens on the next line) or
# `/bin/sh -c '` (the opening single-quote is the last char, body starts next
# line). This is EOL-anchored, so a prose mention like `... `/bin/sh -c '...'` ...`
# does NOT count (it continues past `-c '`). The extractor below must emit exactly
# this many blocks; `n -eq expected` catches a block whose trigger fired but whose
# close logic never emitted it (the old `n -ge 1` was blind to that).
opens=$(/usr/bin/grep -cE '/bin/sh -c[[:space:]]+('\''|\\)[[:space:]]*$' "$PI")

# Extract each inline `/bin/sh -c '...'` block. Two open forms exist and BOTH are
# handled: the backslash line-continuation (`/bin/sh -c \`, body on the next line
# beginning with the opening `'`) and the same-line open (`/bin/sh -c '` at EOL,
# body on the next line with no leading quote). Capture runs through the line that
# closes the arg with `' <args>`. An earlier version triggered only on the
# backslash form, so the same-line block silently went unchecked while the
# docstring claimed to cover "each inline block".
# AWK emits one block per record, blocks separated by a NUL-ish marker.
blocks="$(/usr/bin/awk '
  # a line ending in `/bin/sh -c \` (backslash) or `/bin/sh -c '\''` (same-line
  # open quote) begins a -c arg whose body is on the following line(s).
  /\/bin\/sh -c[[:space:]]+('\''|\\)[[:space:]]*$/ { grab=1; buf=""; first=1; next }
  grab {
    line=$0
    if (first) { sub(/^[[:space:]]*'\''/, "", line); first=0 }   # strip leading  '\''
    # closing: a line that has  '\'' followed by whitespace + an arg ("$...)
    if (line ~ /'\''[[:space:]]+"\$/) {
      # cut at the closing quote that precedes the args
      idx=index(line, "'\'' ")
      if (idx>0) line=substr(line,1,idx-1)
      buf=buf line "\n"
      printf "%s\036", buf   # RS marker between blocks
      grab=0; next
    }
    buf=buf line "\n"
  }
' "$PI")"

n=0
# split on the 0x1e record separator. `set -f` disables pathname expansion for the
# unquoted `$blocks` word-split: block bodies contain glob metacharacters (e.g.
# `*[!0-9]*`), and without it an unlucky cwd or a `failglob`/`nullglob` shell option
# could expand or drop them. IFS-splitting on \036 is all we want here.
set -f
IFS=$'\036'
for blk in $blocks; do
  [ -n "$blk" ] || continue
  n=$((n+1))
  # the inner string the shell passes to `sh -c` = the block with single-quote
  # delimiters removed (there are no escaped single quotes inside a single-quoted
  # word, so every '\'' is a delimiter).
  inner="$(printf '%s' "$blk" | /usr/bin/tr -d "'")"
  if printf '%s\n' "$inner" | /bin/sh -n 2>/tmp/pi-inner-err.$$; then
    echo "PASS  inline -c block $n parses through the shell (sh -n on the reconstructed inner)"
  else
    echo "FAIL  inline -c block $n has a syntax error in the string the shell BUILDS for -c:"
    sed 's/^/        /' /tmp/pi-inner-err.$$ >&2
    fails=$((fails+1))
  fi
  rm -f /tmp/pi-inner-err.$$
done
unset IFS
set +f

[ "$opens" -ge 1 ] || { echo "FAIL  no inline /bin/sh -c invocations found in $PI - the oracle is broken (a false pass)"; exit 1; }
[ "$n" -eq "$opens" ] || { echo "FAIL  extracted $n inline -c block(s) but $opens invocation(s) open in the file - the extractor dropped a block (a false pass)"; exit 1; }

if [ "$fails" -ne 0 ]; then echo "$fails inline-block(s) failed"; exit 1; fi
echo "all $n inline -c block(s) parse through the shell"
