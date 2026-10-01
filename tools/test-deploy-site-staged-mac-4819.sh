#!/usr/bin/env bash
# test-deploy-site-staged-mac-4819.sh - a site deploy carries the staged Mac build (#4819).
#
# On 2026-09-30 19:52 a `deploy-site.sh --publish` from a checkout without
# dist/kosmos-0.7.14-arm64.tar.gz dropped it from the site while latest-staging.json still named it,
# so every staging install and update failed. deploy-site.sh now carries that tarball and its
# .sha256: the local copy when it is the committed pointer's bytes, else the copy live serves,
# and it refuses, naming the tarball, when neither exists.
#
# This test EXTRACTS the "staged Mac carry" block from tools/deploy-site.sh (between its markers),
# plus the pointer parsers and _sha256_of it uses, and runs carry_staged_mac against a throwaway git
# repo as the site checkout. fetch_verified is a stub (its own behaviour is
# tools/test-deploy-site-fetch-4745.sh's subject): it serves from $LIVE_DIR or refuses like the
# real one. It never contacts a host and never touches a real site checkout.
#
# Arms:
#   a  no committed latest-staging.json             -> nothing staged, nothing fetched
#   b  staged build is the prod one ($ART)          -> nothing extra, nothing fetched
#   c  CONTROL local copy matches the pointer       -> carried from dist/, nothing fetched
#   d  THE INCIDENT: no local copy, live serves it  -> fetched, carried
#   e  no local copy, live does not serve it        -> refuses, naming the tarball
#   f  local copy has the WRONG bytes               -> not trusted, fetched from live
#   g  local copy right, its .sha256 missing        -> not trusted, fetched from live
#   h  live serves other bytes than the pointer     -> refuses before fetching
#   h2 local right without a .sha256, live wrong    -> refuses, local copy byte-identical
#   s1 superseded (not newer than prod), no copy    -> warns, carries nothing
#   s2 superseded, live serves it                   -> still carried
#   s3 9.9.10 over 9.9.9 (version, not string, order) -> not superseded, refuses
#   st1 live staging newer than the committed one   -> refuses (would roll staging back)
#   st1r KOSMOS_STAGING_ROLLBACK=<committed version> -> passes; another version -> still refuses
#   st2 CONTROL committed staging newer than live   -> proceeds
#   st3 live has a staging pointer, none committed  -> refuses (would unpublish it)
#   st4 live unreachable                            -> refuses "could not read", not "absent"
#   st6 live pointer names no parsable tarball     -> refuses (cannot tell which is newer)
#   st6r ...with KOSMOS_STAGING_ROLLBACK=<committed version> -> proceeds
#   st7 same version, different bytes             -> refuses; the opt-in deploys it
#   st8 malformed committed pointer, live differs  -> refuses with 'repair it'
#   st5 superseded, the sidecar read fails in transport -> refuses, does not take the skip
#   i  the pointer names a path, not a file         -> refuses before any fetch
#   j  the pointer has no sha                       -> refuses before any fetch
#   k  the wiring: deploy-site.sh calls the block, checks the export for the pair, and
#      served-verifies the pair after the deploy
#
#   bash tools/test-deploy-site-staged-mac-4819.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$HERE/deploy-site.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/deploy-staged-4819.XXXXXXXX")"
trap 'rm -rf "$T"' EXIT
fail=0; npass=0
pass() { printf 'PASS  %s\n' "$*"; npass=$((npass + 1)); }
bad()  { printf 'FAIL  %s\n' "$*"; fail=1; }
has()  { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }
sha_of() { shasum -a 256 "$1" | awk '{print $1}'; }

# ---- extract what the block needs; refuse loudly if any piece is missing (never a vacuous green) --
LIB="$T/lib.sh"
grep -E '^(ptr_artifact|ptr_sha)\(\)' "$DEPLOY" > "$LIB"
grep -E '^_sha256_of\(\)' "$DEPLOY" >> "$LIB"
sed -n '/^# >>> staged Mac carry (#4819)/,/^# <<< staged Mac carry (#4819)/p' "$DEPLOY" >> "$LIB"
if grep -q '^carry_staged_mac() {' "$LIB" && grep -q '^ptr_artifact()' "$LIB" && grep -q '^ptr_sha()' "$LIB" && grep -q '^_sha256_of()' "$LIB"; then
  pass "extracted the staged Mac carry block and its helpers from deploy-site.sh ($(wc -l < "$LIB" | tr -d ' ') lines)"
else
  bad "could not extract the staged Mac carry block or its helpers from $DEPLOY (markers or names moved?)"; exit 1
fi

# ---- fixtures ----------------------------------------------------------------------------------
STAGED=kosmos-9.9.02-arm64.tar.gz
PROD=kosmos-9.9.01-arm64.tar.gz
BYTES="$T/staged-bytes"; printf 'the staged build\n' > "$BYTES"
OTHER="$T/other-bytes";  printf 'some other build\n' > "$OTHER"
SHA=$(sha_of "$BYTES")

# A site checkout whose HEAD commits the given latest-staging.json (empty string: none committed).
mksite() {  # <dir> <pointer-json or "">
  mkdir -p "$1/dist"
  git -C "$1" init -q
  if [ -n "$2" ]; then printf '%s\n' "$2" > "$1/dist/latest-staging.json"; else printf 'x\n' > "$1/README"; fi
  git -C "$1" add -A && git -C "$1" -c user.name=t -c user.email=t@t commit -q -m site
}
ptr() { printf '{"version":"9.9.02","sha256":"%s","artifact":"%s","manifest":"x"}' "$1" "$2"; }

# Runs carry_staged_mac in a subshell (it exits on refusal). Prints its output, then
# "RC=<n> STAGED_ART=<v> FETCHED=<urls>".
run_carry() {  # <site> <live dir>
  (
    SITE="$1"; LIVE_DIR="$2"; HOST="https://site.invalid"; ART="$PROD"
    H=$(git -C "$SITE" rev-parse HEAD)
    FETCH_LOG="$T/fetch.log"; : > "$FETCH_LOG"
    # Stub: like the real one, it refuses (exit 1) when live does not serve the URL, else installs
    # the served artifact and its sidecar at <dest>.
    fetch_verified() {
      echo "$1" >> "$FETCH_LOG"
      src="$LIVE_DIR/${1##*/}"
      [ -f "$src" ] || { echo "deploy-site: could not fetch $1 -- refusing (stub)"; exit 1; }
      cp "$src" "$2"; printf '%s  %s\n' "$(sha_of "$src")" "${1##*/}" > "$2.sha256"
    }
    # Stub for the block's own reads (curl -o <file> -w '%{http_code}' <url>): serves
    # $LIVE_DIR/<name>, and a <tarball>.sha256 computed from $LIVE_DIR/<tarball>. 404 when absent.
    # $LIVE_DIR/.down makes every request a transport failure (exit 7, code 000), as curl does;
    # $LIVE_DIR/.down-sidecar does it for .sha256 requests only.
    curl() {
      _u=""; _o=""; _w=""
      while [ $# -gt 0 ]; do case "$1" in -o) _o="$2"; shift 2;; -w) _w="$2"; shift 2;; -H|--connect-timeout|--max-time) shift 2;; http*) _u="$1"; shift;; *) shift;; esac; done
      _f="${_u##*/}"; _body=""; _code=404
      [ ! -e "$LIVE_DIR/.down" ] || { [ -z "$_w" ] || printf '000'; return 7; }
      case "$_f" in *.sha256) [ ! -e "$LIVE_DIR/.down-sidecar" ] || { [ -z "$_w" ] || printf '000'; return 7; };; esac
      if [ -f "$LIVE_DIR/$_f" ]; then _body=$(cat "$LIVE_DIR/$_f"); _code=200
      else case "$_f" in *.sha256) [ ! -f "$LIVE_DIR/${_f%.sha256}" ] || { _body="$(sha_of "$LIVE_DIR/${_f%.sha256}")  ${_f%.sha256}"; _code=200; };; esac; fi
      [ -z "$_o" ] || printf '%s\n' "$_body" > "$_o"
      [ -z "$_w" ] || printf '%s' "$_code"
      return 0
    }
    . "$LIB"
    trap 'echo "RC=$? STAGED_ART=${STAGED_ART:-} FETCHED=[$(tr "\n" " " < "$FETCH_LOG")]"' EXIT
    check_staging_not_stale
    carry_staged_mac
  ) 2>&1
}

# ---- a: nothing committed ----------------------------------------------------------------------
S="$T/a"; mksite "$S" ""; mkdir -p "$T/live-a"
out=$(run_carry "$S" "$T/live-a")
if has "$out" "RC=0 STAGED_ART= FETCHED=[]" ; then pass "a: no committed staging pointer: nothing staged, nothing fetched"; else bad "a: $out"; fi

# ---- b: staged == prod ---------------------------------------------------------------------------
S="$T/b"; mksite "$S" "$(ptr "$SHA" "$PROD")"; mkdir -p "$T/live-b"
out=$(run_carry "$S" "$T/live-b")
if has "$out" "RC=0 STAGED_ART= FETCHED=[]" && has "$out" "is the prod one"; then pass "b: the staged build is the prod one: nothing extra carried or fetched"; else bad "b: $out"; fi

# ---- c: CONTROL, local copy right ----------------------------------------------------------------
S="$T/c"; mksite "$S" "$(ptr "$SHA" "$STAGED")"; mkdir -p "$T/live-c"
cp "$BYTES" "$S/dist/$STAGED"; printf '%s  %s\n' "$SHA" "$STAGED" > "$S/dist/$STAGED.sha256"
out=$(run_carry "$S" "$T/live-c")
if has "$out" "RC=0 STAGED_ART=$STAGED FETCHED=[]" && has "$out" "carrying the staged Mac build"; then pass "c: CONTROL: a local copy matching the pointer is carried, live not asked (the cut-box restore)"; else bad "c: $out"; fi

# ---- d: THE INCIDENT, no local copy, live serves it ------------------------------------------------
S="$T/d"; mksite "$S" "$(ptr "$SHA" "$STAGED")"; mkdir -p "$T/live-d"; cp "$BYTES" "$T/live-d/$STAGED"
out=$(run_carry "$S" "$T/live-d")
if has "$out" "RC=0 STAGED_ART=$STAGED FETCHED=[https://site.invalid/dist/$STAGED ]" && [ "$(sha_of "$S/dist/$STAGED")" = "$SHA" ] && [ -f "$S/dist/$STAGED.sha256" ]; then
  pass "d: the 2026-09-30 checkout (no local copy) fetches the served build and its .sha256 instead of dropping them"
else bad "d: $out"; fi

# ---- e: no local copy, not served ------------------------------------------------------------------
S="$T/e"; mksite "$S" "$(ptr "$SHA" "$STAGED")"; mkdir -p "$T/live-e"
out=$(run_carry "$S" "$T/live-e")
if has "$out" "RC=1 " && has "$out" "live does not serve $STAGED.sha256" && has "$out" "FETCHED=[]"; then pass "e: neither a local copy nor a served one: refuses, naming $STAGED"; else bad "e: $out"; fi

# ---- f: local bytes wrong ----------------------------------------------------------------------------
S="$T/f"; mksite "$S" "$(ptr "$SHA" "$STAGED")"; mkdir -p "$T/live-f"; cp "$BYTES" "$T/live-f/$STAGED"
cp "$OTHER" "$S/dist/$STAGED"; printf '%s  %s\n' "$SHA" "$STAGED" > "$S/dist/$STAGED.sha256"
out=$(run_carry "$S" "$T/live-f")
if has "$out" "RC=0 STAGED_ART=$STAGED FETCHED=[https://site.invalid/dist/$STAGED ]" && [ "$(sha_of "$S/dist/$STAGED")" = "$SHA" ]; then pass "f: a local copy with the wrong bytes is not trusted: the served build replaces it"; else bad "f: $out"; fi

# ---- g: local right, sidecar missing -----------------------------------------------------------------
S="$T/g"; mksite "$S" "$(ptr "$SHA" "$STAGED")"; mkdir -p "$T/live-g"; cp "$BYTES" "$T/live-g/$STAGED"
cp "$BYTES" "$S/dist/$STAGED"
out=$(run_carry "$S" "$T/live-g")
if has "$out" "RC=0 STAGED_ART=$STAGED FETCHED=[https://site.invalid/dist/$STAGED ]" && [ -f "$S/dist/$STAGED.sha256" ]; then pass "g: a local copy without its .sha256 is not carried as is: the served pair is fetched"; else bad "g: $out"; fi

# ---- h: live serves other bytes than the pointer -------------------------------------------------------
S="$T/h"; mksite "$S" "$(ptr "$SHA" "$STAGED")"; mkdir -p "$T/live-h"; cp "$OTHER" "$T/live-h/$STAGED"
out=$(run_carry "$S" "$T/live-h")
if has "$out" "RC=1 " && has "$out" "does not name the build the committed latest-staging.json names" && has "$out" "FETCHED=[]"; then pass "h: served bytes that are not the pointer's build: refuses before fetching"; else bad "h: $out"; fi

# ---- h2: the local copy is the pointer's build but has no .sha256, and live serves other bytes ---------
# The refusal must not replace the only correct copy with the served wrong one.
S="$T/h2"; mksite "$S" "$(ptr "$SHA" "$STAGED")"; mkdir -p "$T/live-h2"; cp "$OTHER" "$T/live-h2/$STAGED"
cp "$BYTES" "$S/dist/$STAGED"
out=$(run_carry "$S" "$T/live-h2")
if has "$out" "RC=1 " && has "$out" "FETCHED=[]" && [ "$(sha_of "$S/dist/$STAGED")" = "$SHA" ] && [ ! -e "$S/dist/$STAGED.sha256" ]; then pass "h2: a refusal leaves the local copy byte-identical (the right build is not overwritten by the served wrong one)"; else bad "h2: $out (local sha now $(sha_of "$S/dist/$STAGED"))"; fi

# ---- s: superseded (staged not newer than prod) -----------------------------------------------------
OLDSTG=kosmos-9.9.00-arm64.tar.gz
S="$T/s1"; mksite "$S" "$(ptr "$SHA" "$OLDSTG")"; mkdir -p "$T/live-s1"
out=$(run_carry "$S" "$T/live-s1")
if has "$out" "RC=0 STAGED_ART= FETCHED=[]" && has "$out" "WARNING (#4819)" && has "$out" "superseded"; then pass "s1: a superseded staged build that nobody has warns and carries nothing (no refusal, as #3600 for Windows)"; else bad "s1: $out"; fi
S="$T/s2"; mksite "$S" "$(ptr "$SHA" "$OLDSTG")"; mkdir -p "$T/live-s2"; cp "$BYTES" "$T/live-s2/$OLDSTG"
out=$(run_carry "$S" "$T/live-s2")
if has "$out" "RC=0 STAGED_ART=$OLDSTG FETCHED=[https://site.invalid/dist/$OLDSTG ]"; then pass "s2: a superseded staged build that live still serves is still carried"; else bad "s2: $out"; fi
# Version order, not string order: 9.9.10 is NEWER than 9.9.9, so it is not superseded and refuses (arm e's shape).
S="$T/s3"; mksite "$S" "$(ptr "$SHA" "kosmos-9.9.10-arm64.tar.gz")"; mkdir -p "$T/live-s3"
out=$( PROD=kosmos-9.9.9-arm64.tar.gz run_carry "$S" "$T/live-s3")
if has "$out" "RC=1 " && ! has "$out" "superseded"; then pass "s3: 9.9.10 staged over 9.9.9 prod is newer (sort -V), so a missing copy still refuses"; else bad "s3: $out"; fi

# ---- st: the checkout's staging pointer against the one live serves ----------------------------------
NEWER=kosmos-9.9.03-arm64.tar.gz
S="$T/st1"; mksite "$S" "$(ptr "$SHA" "$STAGED")"; mkdir -p "$T/live-st1"; ptr "$SHA" "$NEWER" > "$T/live-st1/latest-staging.json"
cp "$BYTES" "$S/dist/$STAGED"; printf '%s  %s\n' "$SHA" "$STAGED" > "$S/dist/$STAGED.sha256"
out=$(run_carry "$S" "$T/live-st1")
if has "$out" "RC=1 " && has "$out" "live staging is 9.9.03" && has "$out" "move staging back"; then pass "st1: live staging newer than the checkout's refuses (the deploy would roll staging back)"; else bad "st1: $out"; fi
# The rollback opt-in: the same checkout passes when it names the committed version, and only then.
out=$(KOSMOS_STAGING_ROLLBACK=9.9.02 run_carry "$S" "$T/live-st1")
out2=$(KOSMOS_STAGING_ROLLBACK=9.9.01 run_carry "$S" "$T/live-st1")
if has "$out" "RC=0 STAGED_ART=$STAGED" && has "$out" "rolling staging back from 9.9.03 to 9.9.02" && has "$out2" "RC=1 "; then pass "st1r: KOSMOS_STAGING_ROLLBACK naming the committed version lets a deliberate rollback through; naming another does not"; else bad "st1r: $out // $out2"; fi
S="$T/st2"; mksite "$S" "$(ptr "$SHA" "$STAGED")"; mkdir -p "$T/live-st2"; ptr "$SHA" "$OLDSTG" > "$T/live-st2/latest-staging.json"
cp "$BYTES" "$S/dist/$STAGED"; printf '%s  %s\n' "$SHA" "$STAGED" > "$S/dist/$STAGED.sha256"
out=$(run_carry "$S" "$T/live-st2")
if has "$out" "RC=0 STAGED_ART=$STAGED FETCHED=[]"; then pass "st2: CONTROL: a checkout committing a NEWER staging than live (a publish not yet deployed) proceeds"; else bad "st2: $out"; fi
S="$T/st3"; mksite "$S" ""; mkdir -p "$T/live-st3"; ptr "$SHA" "$STAGED" > "$T/live-st3/latest-staging.json"
out=$(run_carry "$S" "$T/live-st3")
if has "$out" "RC=1 " && has "$out" "commits none"; then pass "st3: live serves a staging pointer the checkout does not commit: refuses (it would unpublish staging)"; else bad "st3: $out"; fi
S="$T/st4"; mksite "$S" "$(ptr "$SHA" "$STAGED")"; mkdir -p "$T/live-st4"; : > "$T/live-st4/.down"
out=$(run_carry "$S" "$T/live-st4")
if has "$out" "RC=1 " && has "$out" "could not read the live latest-staging.json (HTTP 000)"; then pass "st4: live unreachable refuses as 'could not read', not as absent"; else bad "st4: $out"; fi
S="$T/st6"; mksite "$S" "$(ptr "$SHA" "$STAGED")"; mkdir -p "$T/live-st6"; ptr "$SHA" "something-else.zip" > "$T/live-st6/latest-staging.json"
out=$(run_carry "$S" "$T/live-st6")
if has "$out" "RC=1 " && has "$out" "which is newer cannot be told"; then pass "st6: a live staging pointer naming no kosmos-<version>-arm64.tar.gz refuses rather than skipping the stale check"; else bad "st6: $out"; fi
cp "$BYTES" "$S/dist/$STAGED"; printf '%s  %s\n' "$SHA" "$STAGED" > "$S/dist/$STAGED.sha256"
out=$(KOSMOS_STAGING_ROLLBACK=9.9.02 run_carry "$S" "$T/live-st6")
if has "$out" "RC=0 STAGED_ART=$STAGED" && has "$out" "replacing a live latest-staging.json"; then pass "st6r: KOSMOS_STAGING_ROLLBACK naming the committed version replaces an unparsable live pointer"; else bad "st6r: $out"; fi
# Same version, different bytes: refuse (cannot tell which build is newer); the opt-in deploys it.
OTHERSHA=$(sha_of "$OTHER")
S="$T/st7"; mksite "$S" "$(ptr "$SHA" "$STAGED")"; mkdir -p "$T/live-st7"; ptr "$OTHERSHA" "$STAGED" > "$T/live-st7/latest-staging.json"
cp "$BYTES" "$S/dist/$STAGED"; printf '%s  %s\n' "$SHA" "$STAGED" > "$S/dist/$STAGED.sha256"
out=$(run_carry "$S" "$T/live-st7")
out2=$(KOSMOS_STAGING_ROLLBACK=9.9.02 run_carry "$S" "$T/live-st7")
if has "$out" "RC=1 " && has "$out" "both name 9.9.02 but different bytes" && has "$out2" "RC=0 STAGED_ART=$STAGED"; then pass "st7: same version, different bytes refuses; KOSMOS_STAGING_ROLLBACK deploys the committed build"; else bad "st7: $out // $out2"; fi
# A committed pointer that names no build, live differing: the refusal says to repair it (no opt-in offered).
S="$T/st8"; mksite "$S" "$(ptr "$SHA" "not-a-build.zip")"; mkdir -p "$T/live-st8"; ptr "$SHA" "$STAGED" > "$T/live-st8/latest-staging.json"
out=$(run_carry "$S" "$T/live-st8")
if has "$out" "RC=1 " && has "$out" "repair the committed pointer" && ! has "$out" "KOSMOS_STAGING_ROLLBACK"; then pass "st8: a malformed committed pointer refuses with 'repair it', not an opt-in nothing could satisfy"; else bad "st8: $out"; fi
# A transport failure on the SIDECAR read of a superseded build must refuse, not take the skip.
S="$T/st5"; mksite "$S" "$(ptr "$SHA" "$OLDSTG")"; mkdir -p "$T/live-st5"; cp "$BYTES" "$T/live-st5/$OLDSTG"; : > "$T/live-st5/.down-sidecar"
out=$(run_carry "$S" "$T/live-st5")
if has "$out" "RC=1 " && has "$out" "could not read the live $OLDSTG.sha256 (HTTP 000)" && ! has "$out" "superseded"; then pass "st5: a superseded build whose sidecar read fails in transport refuses, it is not skipped"; else bad "st5: $out"; fi

# ---- i: a path, not a file --------------------------------------------------------------------------
S="$T/i"; mksite "$S" "$(ptr "$SHA" "kosmos-9/../../etc-arm64.tar.gz")"; mkdir -p "$T/live-i"
out=$(run_carry "$S" "$T/live-i")
if has "$out" "RC=1 " && has "$out" "not a bare file name" && has "$out" "FETCHED=[]"; then pass "i: a pointer naming a path refuses before any fetch"; else bad "i: $out"; fi

# ---- j: no sha --------------------------------------------------------------------------------------
S="$T/j"; mksite "$S" '{"version":"9.9.02","artifact":"kosmos-9.9.02-arm64.tar.gz"}'; mkdir -p "$T/live-j"
out=$(run_carry "$S" "$T/live-j")
if has "$out" "RC=1 " && has "$out" "without a lowercase hex sha256" && has "$out" "FETCHED=[]"; then pass "j: a pointer with no sha refuses before any fetch"; else bad "j: $out"; fi

# ---- k: the wiring in deploy-site.sh ------------------------------------------------------------------
# Each line must exist exactly once, OUTSIDE the extracted block (a call inside the block would be a
# recursion, not the wiring).
OUTSIDE=$(sed '/^# >>> staged Mac carry (#4819)/,/^# <<< staged Mac carry (#4819)/d' "$DEPLOY")
k_ok=1
for want in '^carry_staged_mac$' \
            '^check_staging_not_stale$' \
            '\[ "\$_csm_served_ptr" = "\$_csm_committed" \]' \
            '\[ -f "\$EXPORT/dist/\$STAGED_ART" \]' \
            '\[ -f "\$EXPORT/dist/\$STAGED_ART.sha256" \]' \
            'served_matches "\$STAGED_ART" ' \
            'served_matches "\$STAGED_ART.sha256" '; do
  n=$(printf '%s\n' "$OUTSIDE" | grep -cE "$want")
  [ "$n" = 1 ] || { bad "k: expected one line matching /$want/ in deploy-site.sh outside the block, found $n"; k_ok=0; }
done
# The stale check must come before the first prod fetch (nothing downloaded for a refused checkout).
chk=$(grep -n '^check_staging_not_stale$' "$DEPLOY" | cut -d: -f1); first_fetch=$(grep -n '^fetch_verified "\$HOST/dist/\$ART"' "$DEPLOY" | head -1 | cut -d: -f1)
if [ -n "$chk" ] && [ -n "$first_fetch" ] && [ "$chk" -lt "$first_fetch" ]; then :; else bad "k: check_staging_not_stale (line ${chk:-none}) must run before the first prod fetch (line ${first_fetch:-none})"; k_ok=0; fi
# The call must come before the export is built, or the carry is too late to be carried.
call=$(grep -n '^carry_staged_mac$' "$DEPLOY" | cut -d: -f1); export_at=$(grep -n '^site_deploy_export ' "$DEPLOY" | cut -d: -f1)
if [ -n "$call" ] && [ -n "$export_at" ] && [ "$call" -lt "$export_at" ]; then :; else bad "k: carry_staged_mac (line ${call:-none}) must run before site_deploy_export (line ${export_at:-none})"; k_ok=0; fi
[ "$k_ok" = 1 ] && pass "k: deploy-site.sh checks staging staleness before any fetch, runs the carry before the export, checks the export for the pair, and served-verifies the pair and the pointer"

echo
if [ "$fail" = 0 ] && [ "$npass" = 26 ]; then echo "all $npass staged-Mac-carry checks passed"; exit 0; fi
echo "FAILED ($npass passed, expected 26)"; exit 1
