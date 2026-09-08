#!/bin/sh
# test-release-bump-body-615.sh -- kosmos#615. The lib is unit-tested separately; this
# tests the RELEASE.SH WIRING by extracting the shipped #615 sub-block from release.sh
# (the technique test-update-abort-2055.sh / test-pause-foreign-board-964.sh use) and
# driving it against a synthetic repo, so a change to those exact bytes is caught here.
# The full cut is not runnable in a bot session; this proves the composition: a bump
# commit carries a file/area-level body that surfaces an uncarded drive-by fix.
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE="$HERE/tools/release.sh"
[ -f "$RELEASE" ] || { echo "FAIL: cannot find $RELEASE" >&2; exit 1; }

# Extract the #615 sub-block: from `_RDS_BODY=""` up to (not including) the
# `echo "   committed the bump` line that follows the if/else commit.
BLOCK="$(awk '
  /_RDS_BODY=""/ { f=1 }
  f && /echo "   committed the bump/ { exit }
  f { print }
' "$RELEASE")"
case "$BLOCK" in
  *"kosmos_release_diff_summary"*) : ;;
  *) echo "FAIL: could not extract the #615 bump-body sub-block (anchor drift?)" >&2; exit 1 ;;
esac
case "$BLOCK" in
  *'v${V//./} -- version'*) : ;;
  *) echo "FAIL: extracted block is missing the bump commit (truncated?)" >&2; exit 1 ;;
esac

PASS=0; FAIL=0
chk() { desc="$1"; shift; if "$@"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "FAIL: $desc" >&2; fi; }
has() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }
hasnt() { case "$1" in *"$2"*) return 1 ;; *) return 0 ;; esac; }

R="$(mktemp -d "${TMPDIR:-/tmp}/relbody.XXXXXX")"
trap 'rm -rf "$R"' EXIT
mkdir -p "$R/tools/lib"
cp "$HERE/tools/lib/release-diff-summary.sh" "$R/tools/lib/release-diff-summary.sh"
git -C "$R" init -q; git -C "$R" config user.email t@t; git -C "$R" config user.name t

# prior release bump (v0605), then an uncarded drive-by change, then the pending bump.
mkdir -p "$R/web"
printf '{"version":"0.6.05"}\n' > "$R/package.json"
printf 'old\n' > "$R/web/index.html"
git -C "$R" add -A; git -C "$R" commit -q -m "v0605 -- version"
# the release's real, uncarded change (secret content in it), no subject mention:
printf 'old\nDRIVEBY_SECRET_abc\n' > "$R/web/index.html"
git -C "$R" add -A; git -C "$R" commit -q -m "page gate goes green"
# now the pending version bump, staged, exactly as release.sh reaches the block:
printf '{"version":"0.6.06"}\n' > "$R/package.json"
git -C "$R" add package.json

# Drive the extracted block with the release.sh variables it reads.
bash -c 'set -euo pipefail; REPO="$1"; V="0.6.06"; _prev="0.6.05"; eval "$2"' _ "$R" "$BLOCK" || { echo "FAIL: the extracted block errored under set -euo pipefail" >&2; FAIL=$((FAIL+1)); }

BODY="$(git -C "$R" log -1 --format='%B')"
SUBJECT="$(git -C "$R" log -1 --format='%s')"
chk "the bump commit subject is unchanged (v0606 -- version)" test "$SUBJECT" = "v0606 -- version"
chk "the bump commit BODY surfaces the uncarded drive-by fix's file (web/index.html)" has "$BODY" "web/index.html"
chk "the body names the prior version it diffed from" has "$BODY" "0.6.05"
# 🛑 the body is file/area-level: the secret CONTENT of the change must NOT be in it.
chk "GUARD: the changed CONTENT (secret line) never leaks into the commit body" hasnt "$BODY" "DRIVEBY_SECRET"
# git log --grep on the file path now FINDS the release (the instrument #615 found blind):
GREP_HIT="$(git -C "$R" log --grep='web/index.html' --format='%s' 2>/dev/null)"
chk "git log --grep '<path>' now finds the bump commit (the #615 blind instrument, repaired)" has "$GREP_HIT" "v0606 -- version"

# CONTROL: with the lib ABSENT, the block still commits the bump (plain subject, no body) -
# proving the #615 addition is best-effort and never blocks the cut.
R2="$(mktemp -d "${TMPDIR:-/tmp}/relbody2.XXXXXX")"
git -C "$R2" init -q; git -C "$R2" config user.email t@t; git -C "$R2" config user.name t
printf '{"version":"0.6.05"}\n' > "$R2/package.json"; git -C "$R2" add -A; git -C "$R2" commit -q -m "v0605 -- version"
printf '{"version":"0.6.06"}\n' > "$R2/package.json"; git -C "$R2" add package.json
bash -c 'set -euo pipefail; REPO="$1"; V="0.6.06"; _prev="0.6.05"; eval "$2"' _ "$R2" "$BLOCK" || { echo "FAIL: block errored with the lib absent" >&2; FAIL=$((FAIL+1)); }
chk "with the lib absent, the bump still commits (best-effort, never blocks the cut)" test "$(git -C "$R2" log -1 --format='%s')" = "v0606 -- version"
chk "with the lib absent, the tree is CLEAN after the bump (no -DIRTY-guard trip)" test -z "$(git -C "$R2" status --porcelain)"
rm -rf "$R2"
# and the primary repo's tree is clean too (the whole point: no new file, no dirty tree):
chk "the primary bump left a CLEAN tree (no #615 file dirtied it)" test -z "$(git -C "$R" status --porcelain)"

echo "test-release-bump-body-615: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
