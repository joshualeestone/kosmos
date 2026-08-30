#!/usr/bin/env bash
# #1548: release_site_restore must restore the UNVERSIONED pointer on abort, not
# leave the abandoned build for the next deploy. Each arm is checked against a
# control that can fail, per the perturb-every-arm discipline.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib/release-freeze.sh"

pass=0; fail=0
ok(){ if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "  ok   $1"; else fail=$((fail+1)); echo " FAIL  $1: got [$2] want [$3]"; fi; }

newsite(){ # a fake site git repo with a served, tracked latest.json + an untracked pointer
  local d; d="$(mktemp -d)"; mkdir -p "$d/dist"
  git -C "$d" init -q; git -C "$d" config user.email t@t; git -C "$d" config user.name t
  echo '{"version":"0.6.05"}' > "$d/dist/latest.json"; echo "SERVED-BYTES" > "$d/dist/kosmos-arm64.tar.gz"; echo "SERVED-SHA" > "$d/dist/kosmos-arm64.tar.gz.sha256"
  git -C "$d" add dist/latest.json; git -C "$d" commit -qm init   # only latest.json is tracked; the tarball stays untracked, as in prod
  printf '%s' "$d"
}

# ARM 1: pointer pre-existed, cut overwrote it, backed up as .precut, then aborted -> RESTORE the served copy
S="$(newsite)"
cp -p "$S/dist/kosmos-arm64.tar.gz" "$S/dist/kosmos-arm64.tar.gz.precut"          # the backup release.sh takes before overwrite
cp -p "$S/dist/kosmos-arm64.tar.gz.sha256" "$S/dist/kosmos-arm64.tar.gz.sha256.precut"
echo "NEW-ABORTED-BYTES" > "$S/dist/kosmos-arm64.tar.gz"                            # the overwrite
echo '{"version":"0.6.06"}' > "$S/dist/latest.json"                                # the cut claimed 0.6.06
release_site_restore "$S" 0.6.06 0 1 >/dev/null
ok "ARM1 pointer restored to served bytes"        "$(cat "$S/dist/kosmos-arm64.tar.gz")" "SERVED-BYTES"
ok "ARM1 .precut cleaned up"                        "$([ -e "$S/dist/kosmos-arm64.tar.gz.precut" ] && echo present || echo gone)" "gone"
ok "ARM1 control: latest.json restored to served"  "$(cat "$S/dist/latest.json")" '{"version":"0.6.05"}'
rm -rf "$S"

# ARM 2: fresh clone (had_ptr=0), cut CREATED the pointer, aborted -> REMOVE it
S="$(newsite)"; rm -f "$S/dist/kosmos-arm64.tar.gz" "$S/dist/kosmos-arm64.tar.gz.sha256"   # no pre-existing pointer
echo "FRESH-ABORTED-BYTES" > "$S/dist/kosmos-arm64.tar.gz"                          # this cut created it, no .precut
release_site_restore "$S" 0.6.06 0 0 >/dev/null
ok "ARM2 fresh pointer removed"  "$([ -e "$S/dist/kosmos-arm64.tar.gz" ] && echo present || echo gone)" "gone"
rm -rf "$S"

# ARM 3: pointer pre-existed, aborted BEFORE the overwrite (no .precut) -> LEAVE the served pointer
S="$(newsite)"
release_site_restore "$S" 0.6.06 0 1 >/dev/null
ok "ARM3 served pointer left intact (no false remove)"  "$(cat "$S/dist/kosmos-arm64.tar.gz")" "SERVED-BYTES"
rm -rf "$S"

# ARM 1 is itself the control that can return the dangerous answer: if the restore
# loop were broken (or absent) it would leave "NEW-ABORTED-BYTES" and ARM1 goes red.

echo "---"; echo "pass=$pass fail=$fail"; [ "$fail" = 0 ]
