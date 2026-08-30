#!/usr/bin/env bash
# #1548: release_site_restore must restore the UNVERSIONED pointer on abort, not
# leave the abandoned build for the next deploy. The pre-cut backup lives under
# bak_root (BUILD_ROOT in prod), NOT in the site checkout, so it can never be
# staged into a deploy by a stray git add -A. Each arm is checked against a
# control that can return the dangerous answer, per the perturb-every-arm discipline.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib/release-freeze.sh"

pass=0; fail=0
ok(){ if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "  ok   $1"; else fail=$((fail+1)); echo " FAIL  $1: got [$2] want [$3]"; fi; }

newsite(){ # a fake site git repo with a served, tracked latest.json + an untracked pointer pair
  local d; d="$(mktemp -d)"; mkdir -p "$d/dist"
  git -C "$d" init -q; git -C "$d" config user.email t@t; git -C "$d" config user.name t
  echo '{"version":"0.6.05"}' > "$d/dist/latest.json"
  echo "SERVED-BYTES" > "$d/dist/kosmos-arm64.tar.gz"; echo "SERVED-SHA" > "$d/dist/kosmos-arm64.tar.gz.sha256"
  git -C "$d" add dist/latest.json; git -C "$d" commit -qm init   # only latest.json is tracked; the tarball pair stays untracked, as in prod
  printf '%s' "$d"
}

# ARM 1: pointer pre-existed, cut backed it up under bak_root, overwrote it, then aborted -> RESTORE the served pair.
# ARM1 is itself the control that can return the dangerous answer: if the restore arm
# were broken it would leave the "NEW-ABORTED-*" bytes and these assertions go red.
S="$(newsite)"; B="$(mktemp -d)"; mkdir -p "$B/precut"
cp -p "$S/dist/kosmos-arm64.tar.gz"        "$B/precut/kosmos-arm64.tar.gz"          # the backup release.sh takes under BUILD_ROOT
cp -p "$S/dist/kosmos-arm64.tar.gz.sha256" "$B/precut/kosmos-arm64.tar.gz.sha256"
echo "NEW-ABORTED-BYTES" > "$S/dist/kosmos-arm64.tar.gz"                             # the overwrite
echo "NEW-ABORTED-SHA"   > "$S/dist/kosmos-arm64.tar.gz.sha256"
echo '{"version":"0.6.06"}' > "$S/dist/latest.json"                                 # the cut claimed 0.6.06
release_site_restore "$S" 0.6.06 0 1 "$B" >/dev/null
ok "ARM1 pointer restored to served bytes"        "$(cat "$S/dist/kosmos-arm64.tar.gz")" "SERVED-BYTES"
ok "ARM1 .sha256 restored to served bytes"        "$(cat "$S/dist/kosmos-arm64.tar.gz.sha256")" "SERVED-SHA"
ok "ARM1 backup consumed from bak_root"           "$([ -e "$B/precut/kosmos-arm64.tar.gz" ] && echo present || echo gone)" "gone"
ok "ARM1 control: latest.json restored to served" "$(cat "$S/dist/latest.json")" '{"version":"0.6.05"}'
rm -rf "$S" "$B"

# ARM 2: fresh clone (had_ptr=0), cut CREATED the pointer pair, nothing backed up, aborted -> REMOVE both.
S="$(newsite)"; B="$(mktemp -d)"; rm -f "$S/dist/kosmos-arm64.tar.gz" "$S/dist/kosmos-arm64.tar.gz.sha256"   # no pre-existing pointer
echo "FRESH-ABORTED-BYTES" > "$S/dist/kosmos-arm64.tar.gz"                           # this cut created it, no backup exists
echo "FRESH-ABORTED-SHA"   > "$S/dist/kosmos-arm64.tar.gz.sha256"
release_site_restore "$S" 0.6.06 0 0 "$B" >/dev/null                                 # bak_root has no precut/ -> remove arm
ok "ARM2 fresh pointer removed"  "$([ -e "$S/dist/kosmos-arm64.tar.gz" ] && echo present || echo gone)" "gone"
ok "ARM2 fresh .sha256 removed"  "$([ -e "$S/dist/kosmos-arm64.tar.gz.sha256" ] && echo present || echo gone)" "gone"
rm -rf "$S" "$B"

# ARM 3: pointer pre-existed, aborted BEFORE the overwrite (nothing backed up, had_ptr=1) -> LEAVE the served pair.
S="$(newsite)"; B="$(mktemp -d)"
release_site_restore "$S" 0.6.06 0 1 "$B" >/dev/null
ok "ARM3 served pointer left intact (no false remove)"  "$(cat "$S/dist/kosmos-arm64.tar.gz")" "SERVED-BYTES"
ok "ARM3 served .sha256 left intact"                    "$(cat "$S/dist/kosmos-arm64.tar.gz.sha256")" "SERVED-SHA"
rm -rf "$S" "$B"

echo "---"; echo "pass=$pass fail=$fail"; [ "$fail" = 0 ]
