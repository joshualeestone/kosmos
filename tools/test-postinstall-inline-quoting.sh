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

# Extract each inline `/bin/sh -c '...'` block: from the first line whose content
# begins the single-quoted argument (the line after `/bin/sh -c \`, or the same
# line's trailing quote), through the line that closes it with `' <args>`.
# AWK emits one block per record, blocks separated by a NUL-ish marker.
blocks="$(/usr/bin/awk '
  # a line ending in `/bin/sh -c \` opens a continued -c arg on the NEXT line
  /\/bin\/sh -c \\[[:space:]]*$/ { grab=1; buf=""; first=1; next }
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
# split on the 0x1e record separator
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

[ "$n" -ge 1 ] || { echo "FAIL  no inline /bin/sh -c blocks were extracted - the extractor is broken (a false pass)"; exit 1; }

if [ "$fails" -ne 0 ]; then echo "$fails inline-block(s) failed"; exit 1; fi
echo "all $n inline -c block(s) parse through the shell"
