#!/bin/bash
# The board-plist heredoc in setup.sh is UNQUOTED (it needs $(_xmlq ...) to
# XML-escape the baked paths), so ANY backtick pair or bare $word in its body
# command-substitutes / expands WHILE THE PLIST IS WRITTEN. A backtick in a
# comment there ran `kosmos start` on every update, mid-swap, and spliced its
# output into the plist (#666); on a fresh Mac it printed "command not found"
# (#667). This guards the whole class: the heredoc body may contain ONLY the
# intended $(_xmlq ...) expansions and $_board_label, never a backtick.
set -u
cd "$(dirname "$0")/.." || exit 1
f=install/setup.sh
# Extract the plist heredoc body: from the `cat > ... <<PLIST` line to the lone PLIST terminator.
body="$(awk '/cat > "\$_board_plist.new" <<PLIST/{f=1;next} f&&/^PLIST$/{exit} f' "$f")"
[ -n "$body" ] || { echo "FAIL  could not find the plist heredoc in $f"; exit 1; }
fails=0
if printf '%s' "$body" | grep -q '`'; then
  echo "FAIL  the plist heredoc body contains a backtick -- it will command-substitute while writing the plist (#666/#667)"
  printf '%s\n' "$body" | grep -n '`' | sed 's/^/      /'
  fails=1
else
  echo "PASS  the plist heredoc body has no backticks"
fi
# A backtick is the confirmed, executing bug; that is the hard guard above.
# Bare $word in a COMMENT would also expand (an XML comment carrying "$HOME"),
# so flag a $ inside an <!-- --> comment line specifically -- the intended
# expansions all live in <string>$(_xmlq ...)</string>, never in comments.
if printf '%s' "$body" | grep -E '^[[:space:]]*(<!--|[^<]*-->|[[:space:]])' | grep -E '<!--|-->|^[[:space:]]+[^<]' | grep -q '\$'; then
  # narrow to comment lines that carry a $ (best-effort; the backtick guard is the load-bearing one)
  _c="$(printf '%s' "$body" | awk '/<!--/{c=1} c{print} /-->/{c=0}' | grep '\$' || true)"
  if [ -n "$_c" ]; then echo "FAIL  a plist heredoc COMMENT carries a \$ that will expand:"; printf '%s\n' "$_c" | sed 's/^/      /'; fails=1
  else echo "PASS  no \$ in a plist heredoc comment"; fi
else
  echo "PASS  no \$ in a plist heredoc comment"
fi
echo "plist-heredoc-clean: $fails failures"; [ "$fails" -eq 0 ]
