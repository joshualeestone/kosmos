#!/bin/bash
# The head-match guard, arm by arm, with a stubbed `gh` so nothing touches the
# network or a real PR.
#
# 🛑 THE ARM THAT MATTERS IS THE REFUSAL. This guard exists because a version of
# it that only PRINTED was already being run on 2026-08-28: it said MISMATCH and
# the merge happened in the same command. So "does it exit non-zero" is the
# whole point, and "does it print the right words" is not.
set -u
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }

TOOL="$(cd "$(dirname "$0")/.." && pwd)/tools/pr-head-match.sh"
[ -r "$TOOL" ] || { echo "FAIL  $TOOL not found"; exit 1; }

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/repo"

# A git repo with one known sha, so the local side is deterministic.
git -C "$T/repo" init -q
git -C "$T/repo" -c user.email=t@t -c user.name=t commit -q --allow-empty -m one
SHA="$(git -C "$T/repo" rev-parse HEAD)"

stub_gh() { # $1 = the sha the fake PR reports
  cat > "$T/bin/gh" <<GH
#!/bin/bash
echo "$1"
GH
  chmod +x "$T/bin/gh"
}

run() { (cd "$T/repo" && PATH="$T/bin:$PATH" bash "$TOOL" 42 HEAD >/dev/null 2>&1; echo $?); }

# ---- arm 1: heads agree -> 0 ------------------------------------------------
stub_gh "$SHA"
[ "$(run)" = "0" ] && ok "matching heads exit 0" || bad "matching heads did not exit 0"

# ---- arm 2: THE REFUSAL, heads differ -> non-zero ---------------------------
stub_gh "0000000000000000000000000000000000000000"
rc="$(run)"
if [ "$rc" = "1" ]; then ok "mismatched heads REFUSE (exit 1)"
else bad "mismatched heads exited $rc -- a merge chained with && would have run"; fi

# ---- arm 3: it must FAIL CLOSED when it cannot tell -------------------------
# A gh that answers nothing is not evidence of safety.
cat > "$T/bin/gh" <<'GH'
#!/bin/bash
exit 1
GH
chmod +x "$T/bin/gh"
rc="$(run)"
if [ "$rc" != "0" ]; then ok "unreadable PR fails CLOSED (exit $rc)"
else bad "unreadable PR exited 0 -- a broken checker read as permission to merge"; fi

# ---- arm 4: bad usage is distinguishable from a mismatch --------------------
stub_gh "$SHA"
rc=$( (cd "$T/repo" && PATH="$T/bin:$PATH" bash "$TOOL" >/dev/null 2>&1; echo $?) )
[ "$rc" = "2" ] && ok "no arguments exits 2, not 1" || bad "no arguments exited $rc, want 2"

# ---- arm 5: an unresolvable local ref must not read as a match --------------
stub_gh "$SHA"
rc=$( (cd "$T/repo" && PATH="$T/bin:$PATH" bash "$TOOL" 42 no-such-ref >/dev/null 2>&1; echo $?) )
[ "$rc" != "0" ] && ok "unresolvable local ref does not exit 0 (exit $rc)" || bad "unresolvable local ref exited 0"

echo
if [ "$FAILS" -eq 0 ]; then echo "ALL PASS (5 arms)"; else echo "$FAILS FAILED"; fi
exit "$FAILS"
