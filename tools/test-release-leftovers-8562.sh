#!/bin/bash
# kosmos#8562: an aborted cut's never-served versioned files are moved aside before the next cut of that version builds,
# and anything served, recorded as served, or unknown is refused. Covers release_leftovers_clear and
# release_leftovers_mark_served (tools/lib/release-leftovers.sh) with `curl` stubbed, and their wiring in release.sh.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tools/lib/release-leftovers.sh
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/release-leftovers-8562.XXXXXX")"; trap 'rm -rf "$T"' EXIT
SUM=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

# The served host, as installkosmos.com answers (measured 11-15): $T/served/<path> is a 200 with that body; any other
# name is a 404 with an HTML page. $T/code/<path> overrides one path's status (a 503, say). $T/down: every request
# fails (curl exit 7). With -w the status follows the body on its own line, as curl prints it.
curl() {
  local a url w="" f=""; for a in "$@"; do case "$a" in -w) w=1 ;; -f|-fsSL) f=1 ;; esac; url="$a"; done
  url="${url%%\?*}"; printf '%s\n' "$url" >> "$T/urls"
  [ -e "$T/down" ] && { [ -n "$w" ] && printf '000'; return 7; }
  local p="${url#https://h/}" code body
  if [ -f "$T/code/$p" ]; then code="$(cat "$T/code/$p")"; body='<!doctype html>'; [ -f "$T/code/$p.once" ] && rm -f "$T/code/$p" "$T/code/$p.once"
  elif [ -f "$T/served/$p" ]; then code=200; body="$(cat "$T/served/$p")"
  else code=404; body='<!doctype html>'; fi
  [ -n "$f" ] && [ "$code" != 200 ] && return 22
  printf '%s' "$body"; [ -n "$w" ] && printf '\n%s' "$code"
  return 0
}
serve() { mkdir -p "$(dirname "$T/served/$1")"; printf '%s\n' "$2" > "$T/served/$1"; }
status() { mkdir -p "$(dirname "$T/code/$1")"; printf '%s' "$2" > "$T/code/$1"; }

site() {   # a fresh site checkout with one committed file and the given untracked leftovers
  rm -rf "$T/site" "$T"/site.aborted-* "$T/served" "$T/code" "$T/down" "$T/urls"; mkdir -p "$T/site/dist"
  git -C "$T/site" init -q && git -C "$T/site" config user.email t@t && git -C "$T/site" config user.name t
  printf 'x\n' > "$T/site/dist/kosmos-0.8.05-arm64.manifest.json"
  git -C "$T/site" add -A && git -C "$T/site" commit -qm init
  local f; for f in "$@"; do printf 'old bytes\n' > "$T/site/dist/$f"; touch -t 202611130000 "$T/site/dist/$f"; done   # an earlier day's cut
  serve dist/latest.json '{"version":"0.8.02"}'; serve dist/latest-linux.json '{"version":"0.8.02"}'
  serve dist/kosmos-0.8.02-arm64.tar.gz.sha256 "$SUM  kosmos-0.8.02-arm64.tar.gz"
  serve dist/kosmos-0.8.02-linux-x64.tar.gz.sha256 "$SUM  kosmos-0.8.02-linux-x64.tar.gz"
}
left() { ls "$T/site/dist" | grep -c '^kosmos-0\.8\.05-' ; }
aside() { local d; for d in "$T"/site.aborted-0.8.05-*; do [ -d "$d" ] && { printf '%s\n' "$d"; return 0; }; done; return 0; }
BOTH="arm64 linux-x64"
has() { case "$1" in *"$2"*) return 0 ;; esac; return 1; }   # kosmos#8195: a substring test with no pipe (grep -q can stop early under pipefail)
nov() {   # kosmos#8563: no cut of 0.8.05 has committed its Mac manifest here (a first cut of that version)
  git -C "$T/site" rm -q dist/kosmos-0.8.05-arm64.manifest.json && git -C "$T/site" commit -qm 'no 0.8.05 yet'
  mkdir -p "$T/site/dist"   # git removes a folder it emptied; a real site checkout always has dist/
}

# 1. Nothing left: nothing asked, nothing said, nothing moved (a cut start does not depend on the host).
site
nov
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h $BOTH)"; rc=$?
[ "$rc" = 0 ] && [ -z "$out" ] && [ ! -e "$T/urls" ] && ok "no leftovers: returns 0, says nothing, asks the host nothing" || bad "none: rc=$rc out=$out"

# 2. The 11-13 case: never served (both families), moved aside together, nothing deleted, the committed file untouched.
site kosmos-0.8.05-arm64.tar.gz kosmos-0.8.05-arm64.tar.gz.sha256 kosmos-0.8.05-linux-x64.tar.gz kosmos-0.8.05-linux-x64.tar.gz.sha256
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h $BOTH)"; rc=$?
d="$(aside)"
[ "$rc" = 0 ] && [ "$(ls -d "$T"/site.aborted-0.8.05-* | wc -l | tr -d ' ')" = 1 ] && [ "$(ls "$d" | wc -l | tr -d ' ')" = 4 ] && ok "never served: all four leftovers moved into one dated folder beside the site" || bad "never served: rc=$rc out=$out"
[ "$(left)" = 1 ] && [ -f "$T/site/dist/kosmos-0.8.05-arm64.manifest.json" ] && ok "the committed file of that version is left where it is" || bad "committed file moved: $(ls "$T/site/dist")"
[ "$(cat "$d/kosmos-0.8.05-arm64.tar.gz")" = "old bytes" ] && ok "moved, not deleted: the bytes are in the folder" || bad "bytes lost"
[ -z "$(git -C "$T/site" status --porcelain)" ] && ok "the site checkout is clean afterwards (the folder is outside it)" || bad "site dirty: $(git -C "$T/site" status --porcelain)"
grep -qx "https://h/dist/kosmos-0.8.05-arm64.tar.gz.sha256" "$T/urls" && grep -qx "https://h/dist/kosmos-0.8.02-linux-x64.tar.gz.sha256" "$T/urls" \
  && grep -q "leftover-control-arm64" "$T/urls" && ok "it read the version's own sidecar, the served version's, and a made-up one" || bad "urls: $(sort -u "$T/urls" | tr '\n' ' ')"

# 3. Served: refused, nothing moved.
site kosmos-0.8.05-arm64.tar.gz
serve dist/kosmos-0.8.05-arm64.tar.gz.sha256 "$SUM  kosmos-0.8.05-arm64.tar.gz"
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h $BOTH)"; rc=$?
[ "$rc" = 1 ] && [ "$(left)" = 2 ] && [ -z "$(aside)" ] && [[ "$out" == *"Bump the version"* ]] && ok "served: refused with 'bump the version', nothing moved" || bad "served: rc=$rc left=$(left) out=$out"

# 4. Recorded as served (a cut of 0.8.05 finished step 8 here earlier), though the host now answers 404: refused.
site kosmos-0.8.05-arm64.tar.gz
release_leftovers_mark_served "$T/site" 0.8.05
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h $BOTH)"; rc=$?
[ "$rc" = 1 ] && [ "$(left)" = 2 ] && [[ "$out" == *"step 8 recorded it"* ]] && [ ! -e "$T/urls" ] && ok "recorded served: refused without asking the host, nothing moved" || bad "marker: rc=$rc out=$out"
[ -f "$T/site/.git/kosmos-cut-served-0.8.05" ] && ! { st="$(git -C "$T/site" status --porcelain --ignored)"; [[ "$st" == *kosmos-cut-served* ]]; } && ok "the marker lives in .git, where no git status sees it" || bad "marker: $(ls "$T/site/.git" | grep served) / $(git -C "$T/site" status --porcelain --ignored)"

# 5. The version's own read fails (a 503) while both controls hold: unknown, never "never served".
site kosmos-0.8.05-arm64.tar.gz; status dist/kosmos-0.8.05-arm64.tar.gz.sha256 503
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h $BOTH)"; rc=$?
[ "$rc" = 1 ] && [ "$(left)" = 2 ] && [ -z "$(aside)" ] && [[ "$out" == *"answered 503"* ]] && ok "a 503 on the version's own read: refused as unknown, nothing moved" || bad "503: rc=$rc out=$out"

# 6. Host down: unknown, refused, the way on said.
site kosmos-0.8.05-arm64.tar.gz; : > "$T/down"
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h $BOTH)"; rc=$?
[ "$rc" = 1 ] && [ "$(left)" = 2 ] && [ -z "$(aside)" ] && [[ "$out" == *"cannot tell"* ]] && [[ "$out" == *"out of $T/site/dist"* ]] && ok "host down: refused as unknown, nothing moved, the way on said" || bad "down: rc=$rc out=$out"

# 7. Positive control fails (the served version's own sidecar is not there).
site kosmos-0.8.05-arm64.tar.gz; rm -f "$T/served/dist/kosmos-0.8.02-arm64.tar.gz.sha256"
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h $BOTH)"; rc=$?
[ "$rc" = 1 ] && [ -z "$(aside)" ] && ok "positive control fails: refused, nothing moved" || bad "pos ctl: rc=$rc out=$out"

# 8. Negative control fails (a made-up version is not a 404).
site kosmos-0.8.05-arm64.tar.gz; status dist/kosmos-0.0.0-leftover-control-arm64.tar.gz.sha256 200
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h $BOTH)"; rc=$?
[ "$rc" = 1 ] && [ -z "$(aside)" ] && ok "negative control fails (a made-up version is not a 404): refused, nothing moved" || bad "neg ctl: rc=$rc out=$out"

# 9. One family served, the other not: refused, and NOTHING moved (every family is decided before any file moves).
site kosmos-0.8.05-arm64.tar.gz kosmos-0.8.05-linux-x64.tar.gz
serve dist/kosmos-0.8.05-linux-x64.tar.gz.sha256 "$SUM  kosmos-0.8.05-linux-x64.tar.gz"
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h $BOTH)"; rc=$?
[ "$rc" = 1 ] && [ "$(left)" = 3 ] && [ -z "$(aside)" ] && ok "Linux served, Mac not: refused, and the Mac files stay too" || bad "per family: rc=$rc left=$(left) out=$out"

# 10. A committed Linux manifest for a never-served version (an aborted cut's 7b commit): refused here, naming the commit.
site kosmos-0.8.05-linux-x64.tar.gz
printf 'm\n' > "$T/site/dist/kosmos-0.8.05-linux-x64.manifest.json"
git -C "$T/site" add dist/kosmos-0.8.05-linux-x64.manifest.json && git -C "$T/site" commit -qm "release 0.8.05 linux"
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h $BOTH)"; rc=$?
[ "$rc" = 1 ] && [ -z "$(aside)" ] && [[ "$out" == *"COMMITTED dist/kosmos-0.8.05-linux-x64.manifest.json"* ]] && [[ "$out" == *"release 0.8.05 linux"* ]] && ok "a committed Linux manifest of a never-served version: refused up front, naming the commit" || bad "manifest: rc=$rc out=$out"

# 11. A Mac-only cut does not look at Linux leftovers.
site kosmos-0.8.05-linux-x64.tar.gz; status dist/kosmos-0.8.05-linux-x64.tar.gz.sha256 503; nov
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h arm64)"; rc=$?
[ "$rc" = 0 ] && [ -z "$out" ] && [ "$(left)" = 1 ] && ok "a Mac-only cut ignores Linux leftovers" || bad "mac only: rc=$rc out=$out"

# 12. A leftover whose name has a space moves whole.
site "kosmos-0.8.05-arm64.tar.gz copy"
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h arm64)"; rc=$?
[ "$rc" = 0 ] && [ -f "$(aside)/kosmos-0.8.05-arm64.tar.gz copy" ] && ok "a name with a space moves whole" || bad "space: rc=$rc out=$out"

# 13. A git error (the site is not a repository: ls-files exits 128) is a refusal, never "untracked".
site kosmos-0.8.05-arm64.tar.gz; mv "$T/site/.git" "$T/site.gitdir"
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h arm64)"; rc=$?
mv "$T/site.gitdir" "$T/site/.git"
[ "$rc" = 1 ] && [ -z "$(aside)" ] && [[ "$out" == *"git could not say whether"* ]] && ok "a git error refuses; nothing moved" || bad "git error: rc=$rc out=$out"
# 13b. A move that fails stops, and says where what did move went.
site kosmos-0.8.05-arm64.tar.gz; chmod a-w "$T/site/dist"
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h arm64 2>&1)"; rc=$?
chmod u+w "$T/site/dist"
[ "$rc" = 1 ] && [[ "$out" == *"could not move dist/kosmos-0.8.05-arm64.tar.gz"* ]] && ok "a failed move stops the cut and says so" || bad "mv fail: rc=$rc out=$out"

# 14. A 200 that is not a checksum (an HTML page) on the version's own read: unknown, refused.
site kosmos-0.8.05-arm64.tar.gz; status dist/kosmos-0.8.05-arm64.tar.gz.sha256 200
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h arm64)"; rc=$?
[ "$rc" = 1 ] && [ -z "$(aside)" ] && [[ "$out" == *"answered 200"* ]] && ok "a 200 page that is not a checksum: refused as unknown" || bad "html 200: rc=$rc out=$out"

# 15. A committed Linux manifest and NO leftover files: still refused up front.
site
printf 'm\n' > "$T/site/dist/kosmos-0.8.05-linux-x64.manifest.json"
git -C "$T/site" add dist/kosmos-0.8.05-linux-x64.manifest.json && git -C "$T/site" commit -qm "release 0.8.05 linux"
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h $BOTH)"; rc=$?
[ "$rc" = 1 ] && [[ "$out" == *"COMMITTED dist/kosmos-0.8.05-linux-x64.manifest.json"* ]] && ok "a committed Linux manifest with no leftover files: refused up front" || bad "manifest only: rc=$rc out=$out"

# 16. A host given with a trailing slash reads the same URLs.
site kosmos-0.8.05-arm64.tar.gz
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h/ arm64)"; rc=$?
[ "$rc" = 0 ] && grep -qx "https://h/dist/kosmos-0.8.05-arm64.tar.gz.sha256" "$T/urls" && ok "a trailing slash on the host changes nothing" || bad "slash: rc=$rc urls=$(sort -u "$T/urls" | tr '\n' ' ')"

# 17. The marker is written in the clone's COMMON git dir: marked from a linked worktree (its .git is a file), a cut
# from the main checkout of the same clone refuses too.
site kosmos-0.8.05-arm64.tar.gz
git -C "$T/site" worktree add -q "$T/wt" -b wt 2>/dev/null
[ -f "$T/wt/.git" ] && release_leftovers_mark_served "$T/wt" 0.8.05 2>/dev/null
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h arm64)"; rc=$?
[ -f "$T/wt/.git" ] && [ "$rc" = 1 ] && [[ "$out" == *"step 8 recorded it"* ]] && [ -f "$T/site/.git/kosmos-cut-served-0.8.05" ] && ok "marked from a worktree, refused from the main checkout (one marker per clone)" || bad "worktree: rc=$rc out=$out"
git -C "$T/site" worktree remove --force "$T/wt" 2>/dev/null

# 18. Marking a site that is not a git checkout says so, and does not fail the cut.
mkdir -p "$T/nogit"; out="$(release_leftovers_mark_served "$T/nogit" 0.8.05 2>&1)"; rc=$?
[ "$rc" = 0 ] && [[ "$out" == *"could not record"* ]] && ok "no git checkout: the marker is not written, says so, returns 0" || bad "nogit: rc=$rc out=$out"

# 18b. A channel's first Linux cut (no Linux pointer served yet): the Mac family's served version is the positive control.
site kosmos-0.8.05-linux-x64.tar.gz; rm -f "$T/served/dist/latest-linux.json" "$T/served/dist/kosmos-0.8.02-linux-x64.tar.gz.sha256"
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h linux-x64)"; rc=$?
[ "$rc" = 0 ] && [ -f "$(aside)/kosmos-0.8.05-linux-x64.tar.gz" ] && grep -qx "https://h/dist/kosmos-0.8.02-arm64.tar.gz.sha256" "$T/urls" && ok "first Linux cut: the Mac family's served version is the positive control, and the leftover moves" || bad "first linux: rc=$rc out=$out"
# 18c. The "cannot tell" line names what each read answered, with no stray version string.
site kosmos-0.8.05-arm64.tar.gz; status dist/kosmos-0.8.05-arm64.tar.gz.sha256 503
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h arm64)"
[[ "$out" == *"(its .sha256 answered 503; a version that cannot exist answered 404; the served 0.8.02 answered 200), so nothing was moved."* ]] && ok "the unknown line reads cleanly" || bad "message: $out"

# 19. The positive control answers 200 but with a page, not a checksum: refused.
site kosmos-0.8.05-arm64.tar.gz; status dist/kosmos-0.8.02-arm64.tar.gz.sha256 200
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h arm64)"; rc=$?
[ "$rc" = 1 ] && [ -z "$(aside)" ] && ok "positive control is a 200 page, not a checksum: refused" || bad "pos ctl body: rc=$rc out=$out"

# 20. Just before the deploy (step 8): another build of the version served now refuses; nothing, or this cut's own, goes.
export KOSMOS_LEFTOVERS_RETRY_S=0 KOSMOS_LEFTOVERS_TRIES=3
site
release_leftovers_guard_deploy https://h 0.8.05 arm64 bbbb >/dev/null; rc=$?
[ "$rc" = 0 ] && ok "deploy guard: nothing served (404): go on" || bad "guard 404: rc=$rc"
serve dist/kosmos-0.8.05-arm64.tar.gz.sha256 "$SUM  kosmos-0.8.05-arm64.tar.gz"
release_leftovers_guard_deploy https://h 0.8.05 arm64 "$SUM" >/dev/null; rc=$?
[ "$rc" = 0 ] && ok "deploy guard: this cut's own build served (a retry): go on" || bad "guard own: rc=$rc"
out="$(release_leftovers_guard_deploy https://h 0.8.05 arm64 bbbb)"; rc=$?
[ "$rc" = 1 ] && [[ "$out" == *"another build of 0.8.05 is served"* ]] && ok "deploy guard: ANOTHER build served now: refused, nothing deployed" || bad "guard other: rc=$rc out=$out"
site; status dist/kosmos-0.8.05-arm64.tar.gz.sha256 503
out="$(release_leftovers_guard_deploy https://h 0.8.05 arm64 bbbb)"; rc=$?
[ "$rc" = 1 ] && [ "$(grep -c 'kosmos-0.8.05-arm64.tar.gz.sha256' "$T/urls")" = 3 ] && [[ "$out" == *"unknown"* ]] && ok "deploy guard: three 503s: refused as unknown after 3 reads" || bad "guard 503: rc=$rc reads=$(grep -c 0.8.05 "$T/urls") out=$out"
site; status dist/kosmos-0.8.05-arm64.tar.gz.sha256 503
( unset KOSMOS_LEFTOVERS_TRIES; release_leftovers_guard_deploy https://h 0.8.05 arm64 bbbb >/dev/null ); rc=$?
[ "$rc" = 1 ] && [ "$(grep -c 'kosmos-0.8.05-arm64.tar.gz.sha256' "$T/urls")" = 12 ] && ok "deploy guard: by default it reads 12 times before calling a blip unknown" || bad "default tries: rc=$rc reads=$(grep -c 0.8.05 "$T/urls")"
site; status dist/kosmos-0.8.05-arm64.tar.gz.sha256 200
out="$(release_leftovers_guard_deploy https://h 0.8.05 arm64 bbbb)"; rc=$?
[ "$rc" = 1 ] && [[ "$out" == *"unknown"* ]] && ok "deploy guard: a 200 page that is not a checksum: refused as unknown" || bad "guard html: rc=$rc out=$out"
site; status dist/kosmos-0.8.05-arm64.tar.gz.sha256 503; : > "$T/code/dist/kosmos-0.8.05-arm64.tar.gz.sha256.once"
release_leftovers_guard_deploy https://h 0.8.05 arm64 bbbb >/dev/null; rc=$?
[ "$rc" = 0 ] && ok "deploy guard: a 503 then a 404: retried and went on" || bad "guard retry: rc=$rc"

# 20b. Called bare under set -e (as a caller without `||` would): the expected exit 1 from git ls-files for an
# untracked leftover must not end the caller; the files still move.
site kosmos-0.8.05-arm64.tar.gz
out="$(bash -c 'set -euo pipefail; . tools/lib/release-leftovers.sh; '"$(declare -f curl serve status)"'; T='"'$T'"'; release_leftovers_clear "$T/site" 0.8.05 https://h arm64; echo "REACHED rc=$?"' 2>&1)"
[[ "$out" == *"REACHED rc=0"* ]] && [ -n "$(aside)" ] && ok "under set -e, an untracked leftover does not end the caller, and it moves" || bad "set -e: $out"

# 21. release.sh: step 1g runs it with this cut's families before step 2 and _pair_had; step 8 records served before DEPLOYED=1.
R="tools/release.sh"
g=$(grep -n -m1 'release_leftovers_clear "\$SITE" "\$V"' "$R" | cut -d: -f1)
s2=$(grep -n 'step "== 2\. the version, in one place ==' "$R" | cut -d: -f1)
ph=$(grep -n '^_pair_had=0' "$R" | cut -d: -f1)
[ -n "$g" ] && [ -n "$s2" ] && [ -n "$ph" ] && [ "$g" -lt "$s2" ] && [ "$g" -lt "$ph" ] && ok "release.sh calls it at step 1g, before step 2 and before _pair_had is read" || bad "order: call=$g step2=$s2 pair_had=$ph"
grep -q 'release_leftovers_clear "\$SITE" "\$V" .*\$_lo_fams || { echo "nothing was built"; exit 1; }' "$R" && grep -q '_lo_fams="arm64 linux-x64"' "$R" && ok "it passes this cut's families, and a refusal stops the cut" || bad "call shape"
m=$(grep -n 'release_leftovers_mark_served "\$SITE" "\$V"' "$R" | cut -d: -f1); dep=$(grep -n '^DEPLOYED=1' "$R" | cut -d: -f1)
[ -n "$m" ] && [ -n "$dep" ] && [ "$m" -lt "$dep" ] && [ "$((dep - m))" -le 2 ] && ok "step 8 records served just before DEPLOYED=1" || bad "mark: $m dep: $dep"
sc=$(grep -n '^SITE_SHA="\$(site_commit_on_fresh_main' "$R" | cut -d: -f1)
# kosmos#8563: each call names its stage, so a refusal at 7b does not claim a site commit was pushed.
c1=$(grep -n '^_vdep_served_check 7b$' "$R" | cut -d: -f1); c2=$(grep -n '^_vdep_served_check 8$' "$R" | cut -d: -f1); calls="$c1 $c2"
fz=$(grep -n '^_vdep_freeze_check$' "$R" | cut -d: -f1); vd=$(grep -n '^_vdep_rc=0' "$R" | cut -d: -f1)
[ -n "$sc" ] && [ -n "$c1" ] && [ -n "$c2" ] && [ "$c1" -lt "$sc" ] && [ "$fz" -lt "$c2" ] && [ "$c2" -lt "$vd" ] \
  && grep -q 'release_leftovers_guard_deploy "\${HOST:-https://installkosmos.com}" "\$V" arm64' "$R" \
  && grep -q 'release_leftovers_guard_deploy "\${HOST:-https://installkosmos.com}" "\$V" linux-x64' "$R" && ok "the served check runs before 7b's site commit and again just before vercel (both families)" || bad "guard wiring: 7b-commit=$sc calls=$calls freeze=$fz vdep=$vd"
grep -q '^_vdep_before_retry() { _vdep_freeze_check; _vdep_served_check 8; }$' "$R" && grep -q 'KOSMOS_VERCEL_BEFORE_RETRY=_vdep_before_retry ' "$R" && ok "and again before each vercel retry, beside the freeze check" || bad "retry hook"

# 22. kosmos#8563: a COMMITTED Mac manifest of the version (a cut reached 7b here) makes step 1g read the host even with
# no leftover file. Served: refused now, not at 7b two hours in. Never served: goes on, says so, moves nothing.
site; serve dist/kosmos-0.8.05-arm64.tar.gz.sha256 "$SUM  kosmos-0.8.05-arm64.tar.gz"
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h arm64)"; rc=$?
[ "$rc" = 1 ] && has "$out" 'Bump the version' && [ -f "$T/site/dist/kosmos-0.8.05-arm64.manifest.json" ] && [ -z "$(aside)" ] \
  && ok "a committed Mac manifest of a SERVED version refuses at 1g, before any build" || bad "mac manifest served: rc=$rc out=$out"
site
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h arm64)"; rc=$?
[ "$rc" = 0 ] && has "$out" 'never served' && grep -qx "https://h/dist/kosmos-0.8.05-arm64.tar.gz.sha256" "$T/urls" \
  && [ -f "$T/site/dist/kosmos-0.8.05-arm64.manifest.json" ] && [ -z "$(aside)" ] && [ -z "$(git -C "$T/site" status --porcelain)" ] \
  && ok "a committed Mac manifest of a never-served version: the host is read, the cut goes on, nothing moves" || bad "mac manifest unserved: rc=$rc out=$out"
site; touch "$T/down"
out="$(release_leftovers_clear "$T/site" 0.8.05 https://h arm64)"; rc=$?
[ "$rc" = 1 ] && has "$out" 'cannot tell' && has "$out" 'cut again once the host answers' && ! has "$out" 'files listed above' \
  && ok "a committed Mac manifest with the host down: refused, and the way on names no files (there are none)" || bad "mac manifest down: rc=$rc out=$out"

# 23. kosmos#8563: the guard's refusal says a site commit stays pushed only at step 8; at 7b nothing is pushed yet.
site; serve dist/kosmos-0.8.05-arm64.tar.gz.sha256 "$SUM  kosmos-0.8.05-arm64.tar.gz"
o7="$(release_leftovers_guard_deploy https://h 0.8.05 arm64 bbbb 7b)"; r7=$?
o8="$(release_leftovers_guard_deploy https://h 0.8.05 arm64 bbbb 8)"; r8=$?
od="$(release_leftovers_guard_deploy https://h 0.8.05 arm64 bbbb)"; rd=$?
[ "$r7" = 1 ] && has "$o7" 'nothing was pushed' && ! has "$o7" 'stays pushed' \
  && ok "at 7b the refusal says nothing was pushed" || bad "7b wording: rc=$r7 out=$o7"
[ "$r8" = 1 ] && [ "$rd" = 1 ] && has "$o8" 'stays pushed' && has "$od" 'stays pushed' \
  && ok "at step 8 (and by default) it says the 7b site commit stays pushed" || bad "8 wording: rc=$r8/$rd out=$o8 / $od"

[ "$FAILS" = 0 ] && echo "release-leftovers-8562: all passed" || { echo "release-leftovers-8562: $FAILS FAILED"; exit 1; }
