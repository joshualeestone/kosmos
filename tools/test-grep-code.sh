#!/bin/bash
# grep-code.sh, arm by arm. The tool exists because our deleted-copy comment
# convention makes raw searches report deleted copy as present; these arms are
# the cases that actually fooled people on 2026-08-27, plus the ways the strip
# itself could go wrong.
set -u
cd "$(dirname "$0")/.." || exit 1
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

cat > "$T/a.html" <<'EOF'
<p id="live">This sentence is live.</p>
<!-- "Deleted sentence." removed 2026-08-26, item 4. -->
<p id="other">Another live line.</p>
EOF

# 🛑 THE ARM THE TOOL EXISTS FOR.
out="$(bash tools/grep-code.sh "Deleted sentence." "$T/a.html")"; rc=$?
[ "$rc" -eq 1 ] && ok "copy quoted only in a comment is ABSENT (the case that fooled two people)" \
                || bad "a comment-quoted deletion still reads as present (rc=$rc, out=$out)"

# ⚠️ THE NEGATIVE CONTROL. Without this the arm above passes on a tool that
# can never find anything at all.
out="$(bash tools/grep-code.sh "This sentence is live." "$T/a.html")"; rc=$?
[ "$rc" -eq 0 ] && ok "CONTROL: live copy is still FOUND, so absence means something" \
                || bad "the tool cannot find live copy either (rc=$rc)"

# Line numbers must point at the REAL file, not at a renumbered strip.
case "$out" in
  *":1:"*) ok "the reported line number is the real one (1), not a post-strip offset" ;;
  *) bad "line number wrong or missing: $out" ;;
esac

# A URL must not truncate the line: a naive //.*$ would eat live code after
# https:// and hide a real occurrence.
printf '%s\n' '<a href="https://example.com/x">Findable after a URL.</a>' > "$T/b.html"
bash tools/grep-code.sh "Findable after a URL." "$T/b.html" >/dev/null 2>&1
[ $? -eq 0 ] && ok "a line containing https:// is not truncated by the strip" \
             || bad "the strip ate live code after a URL, which HIDES real occurrences"

# A whole-line // comment is stripped.
printf '%s\n' '// Deleted line note.' > "$T/c.js"
bash tools/grep-code.sh "Deleted line note." "$T/c.js" >/dev/null 2>&1
[ $? -eq 1 ] && ok "a whole-line // comment is stripped" || bad "a // comment still matched"

# 🔑 THREE STATES. An unreadable file is not "not found".
bash tools/grep-code.sh "anything" "$T/does-not-exist" >/dev/null 2>&1
[ $? -eq 2 ] && ok "an unreadable file exits 2, never 1 -- could-not-look is not absence" \
             || bad "a missing file reported as 'not found', collapsing three states into two"

bash tools/grep-code.sh "onlypattern" >/dev/null 2>&1
[ $? -eq 2 ] && ok "no file argument exits 2" || bad "missing file argument did not exit 2"

echo "grep-code: $FAILS failures"
exit $([ "$FAILS" -eq 0 ] && echo 0 || echo 1)
