#!/usr/bin/env bash
# refresh-local-cli.sh goes red on purpose, and green, before anyone trusts it
# (#1758). The point of the card is that a check which has only ever seen a good
# state has not been tested, so this stales an installed CLI deliberately and
# asserts BOTH that a run refreshes it AND that a run which CANNOT refresh refuses
# (exit 1) instead of skipping. Each outcome is captured into variables first and
# judged with case/if, so no status is read through a pipe (#632).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/refresh-local-cli.sh"
# 🛑 HERMETIC: scrub PATH to system dirs only, so `command -v kosmos` inside the
# script under test resolves to NOTHING during this test. The first draft's
# no-install arm passed REFRESH_CLI_TARGET="" and a `:-` default in the script
# fell through to the real machine's kosmos and clobbered it. The script's
# ${VAR+set} handling now closes that hole; this makes a regression of it
# unreachable too. A test must not be able to touch the real machine even when
# the code it tests is wrong.
export PATH=/usr/bin:/bin
T="$(mktemp -d)"; trap 'chmod -R u+rwx "$T" 2>/dev/null; rm -rf "$T"' EXIT
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

# A distinctive fresh CLI and a distinctive stale one. The markers are unique so a
# byte compare's verdict can only be explained by which file's bytes are present.
FRESH="$T/fresh-kosmos"
printf '#!/bin/bash\n# FRESH-CLI-MARKER-1758 with --help handling\necho fresh\n' > "$FRESH"
chmod +x "$FRESH"
make_stale() { printf '#!/bin/bash\n# STALE-CLI-MARKER old and short\necho stale\n' > "$1"; chmod +x "$1"; }

# Negative control: the stale and fresh bytes genuinely differ, so a later
# "target now equals fresh" actually proves movement rather than a no-op.
STALE0="$T/stale0"; make_stale "$STALE0"
if cmp -s "$FRESH" "$STALE0"; then fail "control: stale and fresh must differ"; else pass "control: stale and fresh differ before any refresh"; fi

# 1. The refresh arm: a stale install is brought to the fresh bytes, exit 0.
tgt="$T/install/bin/kosmos"; mkdir -p "$(dirname "$tgt")"; make_stale "$tgt"
out="$(REFRESH_CLI_TARGET="$tgt" REFRESH_CLI_SOURCE="$FRESH" REFRESH_CLI_REPO="$T/norepo" bash "$SCRIPT" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ]; then pass "refresh arm exits 0"; else fail "refresh arm exits 0 (rc=$rc, out=$out)"; fi
if cmp -s "$FRESH" "$tgt"; then pass "refresh arm made the installed CLI byte-identical to the tree"; else fail "refresh arm did not land the fresh bytes"; fi
if [ -x "$tgt" ]; then pass "refresh arm left the installed CLI executable"; else fail "refresh arm left it non-executable"; fi
if has "$out" "refreshed the installed CLI"; then pass "refresh arm says what it did"; else fail "refresh arm message: $out"; fi

# 2. The refusal arm (the perturbation that must go red): the install dir is not
#    writable, so the copy cannot land. It must exit 1 and leave the stale bytes,
#    NOT skip quietly -- a silent skip here is the defect the card closes.
#    Skipped under root, which bypasses directory permissions: the missing-source
#    and symlink-cycle arms below prove the refusal path UID-independently, so this
#    arm's UID-dependence costs no coverage.
if [ "$(id -u)" -ne 0 ]; then
  rodir="$T/ro"; mkdir -p "$rodir"; rotgt="$rodir/kosmos"; make_stale "$rotgt"
  chmod 555 "$rodir"
  out="$(REFRESH_CLI_TARGET="$rotgt" REFRESH_CLI_SOURCE="$FRESH" REFRESH_CLI_REPO="$T/norepo" bash "$SCRIPT" 2>&1)"; rc=$?
  chmod 755 "$rodir"
  if [ "$rc" -eq 1 ]; then pass "refusal arm: an unwritable install dir is a refusal (exit 1), not a skip"; else fail "refusal arm exit 1 (rc=$rc, out=$out)"; fi
  if has "$out" "COULD NOT REFRESH"; then pass "refusal arm names the failure"; else fail "refusal arm message: $out"; fi
  if cmp -s "$STALE0" "$rotgt"; then pass "refusal arm left the stale CLI untouched"; else fail "refusal arm altered the target it could not verify"; fi
else
  echo "SKIP  unwritable-dir refusal arm (running as root bypasses dir perms; missing-source + cycle arms cover refusal)"
fi

# 3. Missing source is a refusal too: the release cannot claim fresh from nothing.
tgt3="$T/miss/kosmos"; mkdir -p "$(dirname "$tgt3")"; make_stale "$tgt3"
out="$(REFRESH_CLI_TARGET="$tgt3" REFRESH_CLI_SOURCE="$T/does-not-exist" REFRESH_CLI_REPO="$T/norepo" bash "$SCRIPT" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "source is missing"; then pass "a missing source is a refusal, not a pass"; else fail "missing-source refusal (rc=$rc, out=$out)"; fi

# 4. Already-fresh: nothing to do, exit 0, unchanged.
tgt4="$T/ok/kosmos"; mkdir -p "$(dirname "$tgt4")"; cp "$FRESH" "$tgt4"; chmod +x "$tgt4"
out="$(REFRESH_CLI_TARGET="$tgt4" REFRESH_CLI_SOURCE="$FRESH" REFRESH_CLI_REPO="$T/norepo" bash "$SCRIPT" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && has "$out" "already matches"; then pass "an already-fresh CLI is left alone, exit 0"; else fail "already-fresh arm (rc=$rc, out=$out)"; fi

# 5. No installed CLI on PATH: nothing to refresh, exit 0 (a fresh install carries it).
out="$(REFRESH_CLI_TARGET="" REFRESH_CLI_SOURCE="$FRESH" REFRESH_CLI_REPO="$T/norepo" bash "$SCRIPT" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && has "$out" "no installed kosmos CLI"; then pass "no install is left alone, exit 0"; else fail "no-install arm (rc=$rc, out=$out)"; fi

# 6. The repo's own copy is never stale and is left alone (mirror of step 10's board gate).
repo="$T/repo"; mkdir -p "$repo/install"; make_stale "$repo/install/kosmos"
out="$(REFRESH_CLI_TARGET="$repo/install/kosmos" REFRESH_CLI_SOURCE="$FRESH" REFRESH_CLI_REPO="$repo" bash "$SCRIPT" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && has "$out" "leaving it alone"; then pass "the repo's own install/kosmos is left alone, exit 0"; else fail "repo-copy arm (rc=$rc, out=$out)"; fi
if ! cmp -s "$FRESH" "$repo/install/kosmos"; then pass "the repo copy was not overwritten"; else fail "the repo copy was overwritten"; fi

# 6b. A repo's TRACKED install/kosmos (a source copy in the main checkout or any of
#     this box's 100+ worktrees) is left alone; refreshing it would dirty a tracked
#     file. REFRESH_CLI_REPO points elsewhere ($T/norepo) so ONLY the git-tracked net
#     can catch this. Arm 1 (a non-repo dir that DOES get refreshed) is its control.
gitrepo="$T/gitrepo"; mkdir -p "$gitrepo/install"
( cd "$gitrepo" && git init -q && git config user.email t@t.test && git config user.name t && : > install/kosmos && git add install/kosmos && git commit -qm x ) >/dev/null 2>&1
make_stale "$gitrepo/install/kosmos"
out="$(REFRESH_CLI_TARGET="$gitrepo/install/kosmos" REFRESH_CLI_SOURCE="$FRESH" REFRESH_CLI_REPO="$T/norepo" bash "$SCRIPT" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && has "$out" "tracked install/kosmos"; then pass "a repo's tracked install/kosmos source is left alone"; else fail "tracked-source gate arm (rc=$rc, out=$out)"; fi
if ! cmp -s "$FRESH" "$gitrepo/install/kosmos"; then pass "the tracked source copy was not overwritten"; else fail "the tracked source copy was overwritten"; fi

# 6c. A genuine INSTALL that merely lives inside a git repo (a dev whose $HOME is a
#     dotfiles repo, kosmos at ~/.local/bin/kosmos) must STILL be refreshed -- silently
#     skipping it is the exact pre-#1758 defect. Its relpath is NOT install/kosmos, so
#     the precise gate does not catch it. This is the arm that proves the gate is
#     precise rather than "inside any repo".
gitrepo2="$T/gitrepo2"; mkdir -p "$gitrepo2/.local/bin"
( cd "$gitrepo2" && git init -q && git config user.email t@t.test && git config user.name t ) >/dev/null 2>&1
make_stale "$gitrepo2/.local/bin/kosmos"
out="$(REFRESH_CLI_TARGET="$gitrepo2/.local/bin/kosmos" REFRESH_CLI_SOURCE="$FRESH" REFRESH_CLI_REPO="$T/norepo" bash "$SCRIPT" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && has "$out" "refreshed the installed CLI"; then pass "a real install inside a git repo is still refreshed, not silently skipped"; else fail "install-under-repo arm (rc=$rc, out=$out)"; fi
if cmp -s "$FRESH" "$gitrepo2/.local/bin/kosmos"; then pass "the install under a git repo got the fresh bytes"; else fail "the install under a git repo was skipped"; fi

# 7. --check reports but never writes.
tgt7="$T/chk/kosmos"; mkdir -p "$(dirname "$tgt7")"; make_stale "$tgt7"
out="$(REFRESH_CLI_TARGET="$tgt7" REFRESH_CLI_SOURCE="$FRESH" REFRESH_CLI_REPO="$T/norepo" bash "$SCRIPT" --check 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && has "$out" "STALE"; then pass "--check reports a stale CLI, exit 0"; else fail "--check arm (rc=$rc, out=$out)"; fi
if cmp -s "$STALE0" "$tgt7"; then pass "--check did not modify the CLI"; else fail "--check modified the CLI"; fi

# 8. A symlinked command: the real file is refreshed, the link stays a link.
mkdir -p "$T/store/bin" "$T/linkdir"; make_stale "$T/store/bin/kosmos"
ln -s "$T/store/bin/kosmos" "$T/linkdir/kosmos"
out="$(REFRESH_CLI_TARGET="$T/linkdir/kosmos" REFRESH_CLI_SOURCE="$FRESH" REFRESH_CLI_REPO="$T/norepo" bash "$SCRIPT" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && cmp -s "$FRESH" "$T/store/bin/kosmos"; then pass "a symlinked command refreshes the real file it points at"; else fail "symlink arm (rc=$rc, out=$out)"; fi
if [ -L "$T/linkdir/kosmos" ]; then pass "the symlink stayed a symlink (the file was replaced, not the link)"; else fail "the symlink was clobbered into a file"; fi

# 9. A symlink CYCLE is a refusal, not an infinite loop that hangs the cut.
mkdir -p "$T/cyc"; ln -s "$T/cyc/y" "$T/cyc/x"; ln -s "$T/cyc/x" "$T/cyc/y"
out="$(REFRESH_CLI_TARGET="$T/cyc/x" REFRESH_CLI_SOURCE="$FRESH" REFRESH_CLI_REPO="$T/norepo" bash "$SCRIPT" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "symlink cycle"; then pass "a symlink cycle is a refusal, not an infinite loop"; else fail "symlink-cycle arm (rc=$rc, out=$out)"; fi

echo "refresh-local-cli: $fails failures"; [ "$fails" -eq 0 ]
