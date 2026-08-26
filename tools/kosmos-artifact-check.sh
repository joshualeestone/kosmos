#!/bin/bash
# Vendored from ~/.claude/bin/kosmos-artifact-check.sh (Splinter, 2026-08-25 23:40; ownership Baron, 2026-08-26 09:06)
# so the cut runs it from the repo as step 9e and it survives whoever is on shift.
# Keep byte-for-byte with the fleet copy below this header; edit here first, then copy back.
# kosmos-artifact-check.sh — audit the bytes a stranger actually downloads.
#
# WHY THIS EXISTS, in one sentence: every check that currently guards a Kosmos
# release runs INSIDE the build, on the build machine, and #927 is what that
# blind spot costs — app/bin/kosmos-app shipped at minos 26.0 against a 13.5
# floor for 18 releases because the build's own selftest ran on a macOS 26 host
# and could not detect a macOS 26 floor by construction.
#
# So this runs from OUTSIDE: it fetches the served pointer, the served tarball
# and the served installer, and asks questions of the bytes rather than of the
# tree they came from.
#
# TWO DESIGN RULES, both learned the expensive way this week:
#
#  1. DISCOVER, NEVER ENUMERATE. The floor gate in-tree had the right logic and
#     the wrong argument list — one filename, hardcoded. A list of binaries is a
#     claim about the ship list that nothing rechecks, so the next binary someone
#     adds is uncovered by default. Every Mach-O check here walks the unpacked
#     tree and gates what it FINDS.
#
#  2. NO NEGATIVE WITHOUT A CONTROL. A check that has never been seen to fail is
#     not evidence of health. Every assertion class here is control-tested against
#     a deliberately-bad input before its verdict on the real artifact is trusted;
#     if a control does not fire, this script reports UNPROVEN rather than PASS.
#
# Usage: kosmos-artifact-check.sh [--repo <path-to-agent-workforce>] [--version X.Y.Z]
# Exit:  0 all pass · 1 a failure · 2 could not run (which is NOT a pass)

set -u

BASE="${KOSMOS_RELEASE_BASE:-https://installkosmos.com/dist}"
SITE="${KOSMOS_SITE_BASE:-https://installkosmos.com}"
REPO="$HOME/work/agent-workforce"
WANT_VER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --version) WANT_VER="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

WORK="$(mktemp -d)" || { echo "could not make a work dir"; exit 2; }
trap 'rm -rf "$WORK"' EXIT

pass=0; fail=0; unproven=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
unp()  { printf '  \033[33mUNPROVEN\033[0m  %s\n' "$1"; unproven=$((unproven+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ── the floor, read from the repo rather than remembered ─────────────────────
if [ ! -f "$REPO/tools/macos-floor" ]; then
  echo "cannot read $REPO/tools/macos-floor — pass --repo. Refusing to certify a floor I cannot read." >&2
  exit 2
fi
FLOOR="$(cat "$REPO/tools/macos-floor")"
FLOOR_MAJOR="${FLOOR%%.*}"; FLOOR_MINOR="${FLOOR#*.}"
case "$FLOOR_MAJOR$FLOOR_MINOR" in *[!0-9]*|'') echo "tools/macos-floor is not MAJOR.MINOR (got '$FLOOR')" >&2; exit 2 ;; esac

# ── is a URL really serving what it claims? ───────────────────────────────────
# ⚠️ A STATUS CODE IS NOT AN EXISTENCE CHECK ON THIS HOST. Measured 2026-08-25:
# a range request against a missing tarball returned 206, and a plain GET
# returned a 404 HTML page — so both "exit 0" and "got bytes" are false greens.
# The content-type is the discriminator.
serves_gzip() {
  curl -fsSL -o /dev/null -D "$WORK/h" "$1" 2>/dev/null
  grep -iq '^content-type:.*gzip' "$WORK/h" 2>/dev/null
}

# ⚠️ EVERY SLICE, BOTH SPELLINGS. Two traps, both measured on app/bin/kosmos-tunnel:
#  - it is a UNIVERSAL binary, and `otool -l` on a fat file prints one set of load
#    commands per slice. Taking the first match reads ONE architecture and calls it
#    "the" floor. Today that is harmless by luck of ordering; a universal binary whose
#    over-floor slice came second would sail through.
#  - its arm64 slice carries LC_BUILD_VERSION (minos 11.0) while its x86_64 slice
#    carries the older LC_VERSION_MIN_MACOSX (version 10.12). Reading one spelling
#    finds one slice. This is exactly why Splinter measured 10.12 and I measured 11.0
#    off the same file: two right answers to a question that has more than one.
# Prints one version per slice, newline separated.
minos_all() {
  otool -l "$1" 2>/dev/null | awk '
    /LC_BUILD_VERSION|LC_VERSION_MIN_MACOSX/ { want=1; next }
    want && /(minos|version) / { print $2; want=0 }
  '
}

head_ "Release pointer"
PTR="$(curl -fsSL -m 20 "$BASE/latest.json?nocache=$$" 2>/dev/null)"
VER="$(printf '%s' "$PTR" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
[ -n "$WANT_VER" ] && VER="$WANT_VER"
if [ -z "$VER" ]; then bad "the pointer names no version (got: ${PTR:-<nothing>})"; echo; echo "cannot continue without a version"; exit 1; fi
ok "pointer names $VER"

head_ "The tarball is really served (not a soft 404)"
TGZ_URL="$BASE/kosmos-$VER-arm64.tar.gz"
# control first: a version that cannot exist must NOT look served.
if serves_gzip "$BASE/kosmos-0.0.0-arm64.tar.gz"; then
  unp "control failed: a nonexistent version looks served, so this check cannot discriminate"
elif serves_gzip "$TGZ_URL"; then
  ok "control fired (a bogus version is correctly not-served); $VER is served as gzip"
else
  bad "$VER is NOT served as gzip at $TGZ_URL (pointer promises a build that is not there)"
  echo; exit 1
fi

head_ "Published checksum matches the served bytes"
curl -fsSL -o "$WORK/k.tgz" "$TGZ_URL" 2>/dev/null || { bad "download failed"; exit 1; }
PUB="$(curl -fsSL "$TGZ_URL.sha256" 2>/dev/null | awk '{print $1}')"
GOT="$(shasum -a 256 "$WORK/k.tgz" | awk '{print $1}')"
if [ -z "$PUB" ]; then bad "no published .sha256 alongside the tarball"
elif [ "$PUB" = "$GOT" ]; then ok "sha256 matches ($GOT)"
else bad "sha256 MISMATCH: published $PUB, served bytes $GOT"; fi

# ⚠️ The published .sha256 names an UNVERSIONED file (kosmos-arm64.tar.gz) while
# the served file is versioned, so `shasum -c` on it fails with "No such file".
# A tester following good practice hits a broken verification step.
PUBNAME="$(curl -fsSL "$TGZ_URL.sha256" 2>/dev/null | awk '{print $2}' | sed 's/^\*//')"
if [ -n "$PUBNAME" ] && [ "$PUBNAME" != "kosmos-$VER-arm64.tar.gz" ]; then
  bad "the .sha256 names '$PUBNAME' but the served file is 'kosmos-$VER-arm64.tar.gz' — 'shasum -c' fails for anyone verifying by hand"
else
  ok "the .sha256 names the file it describes"
fi

head_ "Deployment floor: EVERY Mach-O that lands on a user's Mac (floor $FLOOR)"
mkdir -p "$WORK/u" && tar xzf "$WORK/k.tgz" -C "$WORK/u"
# the tmux bundle ships separately but lands on the same Mac, so it is in scope
if curl -fsSL -o "$WORK/tmux.tgz" "$BASE/tmux-arm64.tar.gz" 2>/dev/null; then
  mkdir -p "$WORK/u/_tmux" && tar xzf "$WORK/tmux.tgz" -C "$WORK/u/_tmux"
fi
# control: a binary from this host is at or above the host OS, which on a
# current build Mac is ABOVE the floor. If that does not trip, the check is blind.
printf 'int main(void){return 0;}\n' > "$WORK/ctl.c"
CTL_FIRED=no
if cc -o "$WORK/ctl" "$WORK/ctl.c" 2>/dev/null; then
  cm="$(minos_all "$WORK/ctl" | head -1)"; cmaj="${cm%%.*}"
  case "$cmaj" in ''|*[!0-9]*) : ;; *) [ "$cmaj" -gt "$FLOOR_MAJOR" ] && CTL_FIRED=yes ;; esac
fi
[ "$CTL_FIRED" = yes ] && ok "control fired: a binary built on this host ($cm) is correctly seen as above the floor" \
                       || unp "control did not fire — cannot prove this check can detect an over-floor binary"
FOUND=0; OVER=0
while IFS= read -r f; do
  file "$f" 2>/dev/null | grep -q Mach-O || continue
  FOUND=$((FOUND+1))
  rel="${f#$WORK/u/}"
  slices="$(minos_all "$f")"
  if [ -z "$slices" ]; then bad "$rel — no readable deployment target in any slice; refusing to certify (green-on-blind)"; OVER=$((OVER+1)); continue; fi
  for m in $slices; do
    maj="${m%%.*}"; min="${m#*.}"; min="${min%%.*}"
    case "$maj$min" in *[!0-9]*|'') bad "$rel — unparseable deployment target '$m'"; OVER=$((OVER+1)); continue ;; esac
    if [ "$maj" -gt "$FLOOR_MAJOR" ] || { [ "$maj" -eq "$FLOOR_MAJOR" ] && [ "$min" -gt "$FLOOR_MINOR" ]; }; then
      bad "$rel requires macOS $m — ABOVE the installer's $FLOOR floor (this is #927's shape)"
      OVER=$((OVER+1))
    fi
  done
done <<EOFIND
$( { find "$WORK/u" -type f -perm +111 2>/dev/null; find "$WORK/u" -type f -name '*.dylib' 2>/dev/null; } | sort -u )
EOFIND
[ "$FOUND" -eq 0 ] && unp "found no Mach-O binaries at all — the walk is probably broken, not the bundle clean"
[ "$FOUND" -gt 0 ] && [ "$OVER" -eq 0 ] && ok "all $FOUND shipped Mach-O binaries are at or below $FLOOR"

head_ "Code signing"
# ⚠️ THREE STATES, NOT TWO, and only one of them is a failure. The first version of
# this check asked "is there an Authority line?" and reported four reds against the
# bundled tmux and its dylibs. They are AD-HOC SIGNED, which is correct for them:
#  - unsigned     -> will not execute on Apple silicon at all. A real failure.
#  - ad-hoc       -> executes fine. Only a problem NESTED INSIDE a signed .app bundle,
#                    where it makes the whole bundle's notarisation Invalid. tmux lands
#                    at $KOSMOS_HOME/tmux/bin/tmux, BESIDE the app, so it is fine.
#  - Developer ID -> required for anything inside Kosmos.app.
# Flattening ad-hoc into "unsigned" sends someone hunting a non-problem — the same
# false-redirect that cost a fleet hour on #850. Say which state it is.
while IFS= read -r f; do
  file "$f" 2>/dev/null | grep -q Mach-O || continue
  rel="${f#$WORK/u/}"
  cs="$(codesign -dvvv "$f" 2>&1)"
  auth="$(printf '%s' "$cs" | sed -n 's/^Authority=//p' | head -1)"
  case "$rel" in *.app/*) nested=yes ;; *) nested=no ;; esac
  if [ -n "$auth" ]; then
    ok "$rel — $auth"
  elif printf '%s' "$cs" | grep -q 'adhoc'; then
    if [ "$nested" = yes ]; then
      bad "$rel is ad-hoc signed INSIDE an .app bundle — this invalidates the bundle's notarisation"
    else
      ok "$rel — ad-hoc (executes; lands beside the app, not inside it, so notarisation is unaffected)"
    fi
  else
    bad "$rel is UNSIGNED — an unsigned Mach-O does not execute on Apple silicon at all"
  fi
done <<EOFSIG
$( { find "$WORK/u" -type f -perm +111 2>/dev/null; find "$WORK/u" -type f -name '*.dylib' 2>/dev/null; } | sort -u )
EOFSIG

head_ "The served installer matches the repo"
curl -fsSL -o "$WORK/setup" "$SITE/setup" 2>/dev/null
LIVE_SHA="$(shasum -a 256 "$WORK/setup" | awk '{print $1}')"
if [ -f "$REPO/../chaoskosmos-site/setup" ]; then
  REPO_SHA="$(shasum -a 256 "$REPO/../chaoskosmos-site/setup" | awk '{print $1}')"
  [ "$LIVE_SHA" = "$REPO_SHA" ] && ok "served /setup is byte-identical to chaoskosmos-site/setup" \
                                || bad "served /setup DIFFERS from chaoskosmos-site/setup (live $LIVE_SHA)"
else
  unp "no local chaoskosmos-site checkout to compare against (live $LIVE_SHA)"
fi

head_ "The installer's floor and the artifact's floor agree"
SETUP_FLOOR_MAJ="$(sed -n 's/^MACOS_FLOOR_MAJOR=\([0-9]*\).*/\1/p' "$WORK/setup" | head -1)"
SETUP_FLOOR_MIN="$(sed -n 's/^MACOS_FLOOR_MINOR=\([0-9]*\).*/\1/p' "$WORK/setup" | head -1)"
if [ -z "$SETUP_FLOOR_MAJ" ]; then unp "could not read the floor out of the served installer"
elif [ "$SETUP_FLOOR_MAJ.$SETUP_FLOOR_MIN" = "$FLOOR" ]; then ok "installer refuses below $SETUP_FLOOR_MAJ.$SETUP_FLOOR_MIN, matching tools/macos-floor"
else bad "installer floor is $SETUP_FLOOR_MAJ.$SETUP_FLOOR_MIN but tools/macos-floor says $FLOOR"; fi

head_ "No credential-shaped strings in the shipped tree"
PAT='sk-ant-[A-Za-z0-9_-]{8}|github_pat_[A-Za-z0-9_]{8}|ghp_[A-Za-z0-9]{20}|AKIA[0-9A-Z]{12}|-----BEGIN [A-Z ]*PRIVATE KEY|xoxb-[0-9]{8}'
printf 'const k="sk-ant-api03-CONTROLONLY";\n' > "$WORK/ctl.js"
if grep -qIE "$PAT" "$WORK/ctl.js"; then
  if grep -rIqE "$PAT" "$WORK/u" 2>/dev/null; then
    bad "credential-shaped strings found:"; grep -rIlE "$PAT" "$WORK/u" 2>/dev/null | sed "s|$WORK/u/|      |"
  else
    ok "control fired; no known-prefix credentials in the bundle"
    printf '        (bounded: this detects KNOWN PREFIXES only — a bare secret with no\n'
    printf '         recognisable shape is invisible to it. Absence here is not proof.)\n'
  fi
else
  unp "control did not fire — the credential patterns are broken, so a clean result means nothing"
fi

head_ "Verdict"
printf '  %d passed · %d failed · %d unproven\n' "$pass" "$fail" "$unproven"
if [ "$unproven" -gt 0 ]; then
  printf '  \033[33mUNPROVEN is not a pass.\033[0m A check whose control did not fire cannot report health.\n'
fi
[ "$fail" -gt 0 ] && exit 1
[ "$unproven" -gt 0 ] && exit 1
exit 0
