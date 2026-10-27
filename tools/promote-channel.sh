#!/usr/bin/env bash
# promote-channel.sh - kosmos#2036, the staging->prod PROMOTE side.
#
# Promote the staging pointer to prod: point `dist/latest.json` at exactly the bytes
# `dist/latest-staging.json` already names, after verifying (a) those bytes are present
# and their served sha matches the pointer, and (b) the #2036/#2063 experience gate says a
# fresh session can USE the board on that build. It is a POINTER copy - it never rebuilds,
# so prod gets the exact artifact staging verified. That same-bytes property is the whole
# reason the channel lives in the pointer and not in the artifact (Kitty, 2026-09-03).
#
# #5032: when the staging pointer names its installer (setup_sha256) it also rewrites `setup` and `setup.sha256`
# (from setup-staging), which must be committed with `latest.json`.
# 🛑 IT DOES NOT DEPLOY. It rewrites `latest.json` in the SITE CHECKOUT's dist/; the next
# site deploy publishes it. Same boundary as publish-staging-pointer.sh / #2008.
#
# The experience gate (tools/staging-experience-check.sh, #2063) can only PASS where a
# fresh enforcing board exists. On the dev box it returns cannot-tell (2) by construction
# (the board runs from source and never enforces), so promote HOLDS there - correctly: you
# cannot promote from a machine that cannot test the update. Run this on/against the fresh
# staging machine, or use --force after a HAND verification (which never overrides a
# provably-broken board - exit 1 is always a refusal).
#
# ONE SNAPSHOT (both families). The staging pointer is copied ONCE, at the start, and every
# field, the gate, and the promoted copy come from that snapshot. A staging publish that lands
# while a gate runs therefore cannot put an unapproved, unverified pointer onto prod; if the
# staging pointer changed during the promote, the promote refuses with nothing written.
# (Not with --version, below: there the snapshot comes from a commit, which cannot change.)
#
# THE WINDOWS FAMILY (--family win). The same pointer copy for Windows:
# `dist/latest-win-staging.json` (written by publish-kosmos-windows.sh, whose default channel
# is staging) onto `dist/latest-win.json`, with the same bare-filename, sidecar-verify and
# same-sha checks on the pointer's `versioned` zip. It then refreshes the alias
# kosmos-win-<arch>.zip to those bytes. There is no manifest check (a Mac-only field), and the
# Mac board gates do not run. Instead, BOTH of these are required, and NEITHER can be forced
# (--force is refused for this family):
#   1. JOSH'S GO FOR THIS EXACT BUILD: --approved-version <V> --approved-sha <sha256>, which
#      must equal the staging pointer (his rule, 2026-09-12: everything goes to staging, and to
#      prod only after his approval), and --approval-ref <Slack message ts or permalink> naming
#      the message where he gave it. Anything missing or mismatched is a refusal before any
#      write. The approval is logged (the version, the sha, the reference, the verification
#      record's path and sha256, and a UTC time; never who typed it) to the approval log
#      (tools/lib/win-approval.sh). A log that cannot be written is a refusal too.
#      🛑 THIS RECORDS A HUMAN DECISION; IT IS NOT A CHECK. An agent must NEVER pass these flags
#      without Josh's recorded go for this exact sha (the message --approval-ref names). The
#      flags prove only that someone typed the sha; the rule is that Josh decided.
#   2. THE VERIFICATION RECORD: tools/win-staging-verified.sh (0 pass / 1 fail or ambiguous ->
#      refuse / 2 no record -> HOLD). Its header defines where the record lives and its shape.
#      The record names the same sha, so the approval, the record and the pointer all name one
#      build. It is written on the Windows box; when the promote runs elsewhere (the site
#      checkout is on the Mac), the record is copied there by hand, and the record sha256 in the
#      approval log is the link back to the file the Windows box wrote.
# The Mac promote has no approval flag today; this is Windows-only.
#
# A NAMED VERSION (--version <V>, Mac only, kosmos#7005). By default the build promoted is whatever
# latest-staging.json names NOW, so a pending prod GO froze staging: a staging cut would replace the
# approved build. With --version, the pointer and installer come from a site commit (on HEAD) whose
# latest-staging.json names V, so staging can move on. The commits naming V that --commit and --sha (when
# given) leave, and that are on origin/main (when the site has an origin), must name the same build;
# the one used is the newest whose committed setup-staging hashes to its pointer's setup_sha256 (the
# staging cut's own commit, which carries both), else the newest naming V (both among the commits --sha and
# --commit leave). If a later commit naming V has a pointer that differs in more than its installer, the
# promote refuses until --commit names which one is right. --sha <8+ characters of its
# sha256> names which build Josh approved: needed when V was cut more than once (a re-cut after an abort),
# and with --force, so a forced promote is tied to the approved bytes, not only to a version that could be
# mistyped. --commit <sha> picks the commit itself (it must still name V, and every check still applies to it). A V
# older than the build prod serves now is refused unless --allow-older is given (a rollback
# is a decision, not a typo). The checks below run on the pointer and installer that commit holds and on
# the files they name in the checkout's dist/ (the artifact and its sidecar, which are not in git, and the
# manifest and its signature): sha, signature, installer floor, and the gates (the experience gate expects
# V, so a board on a later staging build answers cannot-tell and the promote HOLDS). What
# differs: the installer pair is read from the commit (the working tree's setup-staging is not checked or
# used), the live staging pointer is not read, so the moved-during-the-gates check does not apply, and
# instead the artifact is re-verified right before the first write.
#
# Usage:
#   tools/promote-channel.sh <site-checkout> [port] [--force]
#     [port]  the port the experience gate should probe (the fresh staging board's port,
#             which is per-account and usually NOT 16180). Also settable via KOSMOS_PORT.
#             Give the port so a wrong-port HOLD does not push you toward --force, which
#             bypasses the gate entirely.
#   tools/promote-channel.sh <site-checkout> [port] --version <V> [--sha <sha256 prefix>] [--commit <site sha>]
#                            [--allow-older] [--force]
#             promote V from its own staging commit, whatever staging names now (see above)
#   tools/promote-channel.sh <site-checkout> --family win --approved-version <V> \
#       --approved-sha <sha256> --approval-ref <Slack message ts or permalink>
#             (only on Josh's go for that exact build; see above)
# Overrides (mainly for the test):
#   KOSMOS_PROMOTE_GATE_CMD   the experience gate to run (default: bash <repo>/tools/staging-experience-check.sh)
#   (the Windows gate has no command override: it is always tools/win-staging-verified.sh)
set -uo pipefail

SITE=""; FORCE=0; PORT=""; FAMILY="mac"; APPROVED_VERSION=""; APPROVED_SHA=""; APPROVAL_REF=""; NAMED_VERSION=""; NAMED_SHA=""; NAMED_PICK=""; ALLOW_OLDER=0
while [ $# -gt 0 ]; do
  a="$1"; shift
  case "$a" in
    --force) FORCE=1 ;;
    --allow-older) ALLOW_OLDER=1 ;;
    --family|--approved-version|--approved-sha|--approval-ref|--version|--sha|--commit)
      [ $# -gt 0 ] || { echo "promote-channel: $a needs a value" >&2; exit 1; }
      case "$a" in
        --family) FAMILY="$1" ;;
        --approved-version) APPROVED_VERSION="$1" ;;
        --approved-sha) APPROVED_SHA="$1" ;;
        --approval-ref) APPROVAL_REF="$1" ;;
        --version) NAMED_VERSION="$1" ;;
        --sha) NAMED_SHA="$1" ;;
        --commit) NAMED_PICK="$1" ;;
      esac
      shift ;;
    --family=*) FAMILY="${a#--family=}" ;;
    --approved-version=*) APPROVED_VERSION="${a#--approved-version=}" ;;
    --approved-sha=*) APPROVED_SHA="${a#--approved-sha=}" ;;
    --approval-ref=*) APPROVAL_REF="${a#--approval-ref=}" ;;
    --version=*) NAMED_VERSION="${a#--version=}" ;;
    --sha=*) NAMED_SHA="${a#--sha=}" ;;
    --commit=*) NAMED_PICK="${a#--commit=}" ;;
    -*) echo "promote-channel: unknown option $a" >&2; exit 1 ;;
    *)
      if [ -z "$SITE" ]; then SITE="$a"
      elif [ -z "$PORT" ]; then
        case "$a" in *[!0-9]*) echo "promote-channel: expected a numeric [port], got '$a'" >&2; exit 1 ;; esac
        PORT="$a"
      else echo "promote-channel: unexpected extra argument $a" >&2; exit 1
      fi ;;
  esac
done
case "$FAMILY" in
  mac)
    [ -z "$APPROVED_VERSION$APPROVED_SHA$APPROVAL_REF" ] || { echo "promote-channel: --approved-version/--approved-sha/--approval-ref are for --family win only (the Mac promote is gated by its experience and agent-spawn gates)" >&2; exit 1; } ;;
  win)
    echo "promote-channel: NOTE the served Windows files live in the R2 bucket kosmos-dist-win, which this script does not write; a Windows release from the Windows PC uses tools/windows/publish-r2.ps1 (tools/windows/RELEASING.md, #3725)." >&2
    [ -z "$NAMED_VERSION" ] || { echo "promote-channel: --version is for the Mac promote only; a Windows promote names its build with --approved-version/--approved-sha" >&2; exit 1; }
    [ "$FORCE" = 0 ] || { echo "promote-channel: --force is refused for --family win - neither Josh's go nor the Windows verification record can be forced." >&2; exit 1; }
    [ -z "$PORT" ] || { echo "promote-channel: --family win takes no [port] (its gate reads the verification record, not a board)" >&2; exit 1; } ;;
  linux) echo "promote-channel: the Linux family is not promoted on its own: a Mac promote moves latest-linux.json with latest.json, to the same version (kosmos#7281 lockstep). Run it without --family." >&2; exit 1 ;;
  *) echo "promote-channel: --family must be 'mac' or 'win' (got '$FAMILY')" >&2; exit 1 ;;
esac
# kosmos#7281 slice C2: the marker tools/lib/release-linux.sh reads (grep -x) to allow a PROD Linux cut. It says this
# script moves the Linux pointer with the Mac one (promote_linux_* below). Keep it exactly as written, on its own line.
PROMOTE_MOVES_LINUX=1
. "$(cd "$(dirname "$0")" && pwd)/lib/promote-linux.sh" || { echo "promote-channel: cannot load tools/lib/promote-linux.sh" >&2; exit 1; }
SITE="${SITE:-${KOSMOS_SITE:-$HOME/work/chaoskosmos-site}}"
[ -z "$NAMED_VERSION" ] || [[ "$NAMED_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "promote-channel: --version must be a version such as 0.7.64 (got '$NAMED_VERSION')" >&2; exit 1; }
[ "$ALLOW_OLDER" = 0 ] || [ -n "$NAMED_VERSION" ] || { echo "promote-channel: --allow-older goes with --version" >&2; exit 1; }
[ -z "$NAMED_SHA" ] || [ -n "$NAMED_VERSION" ] || { echo "promote-channel: --sha goes with --version" >&2; exit 1; }
# A named promote's gates usually hold (the cut box's board has moved past V), so --force is its common path: tie it
# to the approved build's bytes, not only to a version number.
[ -z "$NAMED_VERSION" ] || [ "$FORCE" = 0 ] || [ -n "$NAMED_SHA" ] || { echo "promote-channel: --version with --force needs --sha <8+ characters of the approved build's sha256>, so a forced promote names the bytes Josh approved, not only a version" >&2; exit 1; }
[ -z "$NAMED_PICK" ] || [ -n "$NAMED_VERSION" ] || { echo "promote-channel: --commit goes with --version" >&2; exit 1; }
[ -z "$NAMED_PICK" ] || [[ "$NAMED_PICK" =~ ^[0-9a-f]{7,40}$ ]] || { echo "promote-channel: --commit must be 7 to 40 lowercase hex characters of a site commit (got '$NAMED_PICK')" >&2; exit 1; }
[ -z "$NAMED_SHA" ] || [[ "$NAMED_SHA" =~ ^[0-9a-f]{8,64}$ ]] || { echo "promote-channel: --sha must be 8 to 64 lowercase hex characters of the build's sha256 (got '$NAMED_SHA')" >&2; exit 1; }
[ -d "$SITE/dist" ] || { echo "promote-channel: no $SITE/dist" >&2; exit 1; }
# kosmos#6620: no release pointer moves while the site is frozen (tools/pointer-freeze.sh, the incident pin).
. "$(cd "$(dirname "$0")" && pwd)/lib/pointer-freeze.sh" || { echo "promote-channel: cannot load tools/lib/pointer-freeze.sh" >&2; exit 1; }
pointer_freeze_refuse "$SITE" promote-channel.sh || exit 1
command -v node >/dev/null 2>&1 || { echo "promote-channel: node is required" >&2; exit 1; }

# The family decides which two pointers and which pointer field names the versioned artifact.
# Everything below reads these, so the same-bytes checks and the atomic copy are one code path.
if [ "$FAMILY" = win ]; then
  STAGING_NAME="latest-win-staging.json"; PROD_NAME="latest-win.json"; ARTIFACT_FIELD="versioned"
  STAGING_PUBLISHER="publish-kosmos-windows.sh, whose default channel is staging"
else
  STAGING_NAME="latest-staging.json"; PROD_NAME="latest.json"; ARTIFACT_FIELD="artifact"
  STAGING_PUBLISHER="publish-staging-pointer.sh"
fi
STAGING="$SITE/dist/$STAGING_NAME"
[ -n "$NAMED_VERSION" ] || [ -f "$STAGING" ] || { echo "promote-channel: no $STAGING - publish a staging pointer first ($STAGING_PUBLISHER)" >&2; exit 1; }

# THE SNAPSHOT (see the header): taken once; the live staging path is only compared against it
# again right before the write.
SNAP="$(mktemp "${TMPDIR:-/tmp}/promote-channel-staging.XXXXXX")" || { echo "promote-channel: could not make a temp file for the staging snapshot" >&2; exit 1; }
PTMP=""
STMP=""
_kl_dir=""   # #6609: the served release key list, read from the site's origin/main
_pc_qlog=""  # #6922: the agent-spawn gate's queue log; a promote killed while the gate waits in the queue must not leave it
NAMED_DIR="" # kosmos#7005: the named version's installer pair, read from its commit
trap 'promote_linux_cleanup; rm -f "$SNAP" ${PTMP:+"$PTMP"} ${STMP:+"$STMP"}; [ -z "$_kl_dir" ] || rm -rf "$_kl_dir"; [ -z "$_pc_qlog" ] || [ "$_pc_qlog" = /dev/null ] || rm -f "$_pc_qlog"; [ -z "$NAMED_DIR" ] || rm -rf "$NAMED_DIR"' EXIT   # a signal mid-promote must not leak a temp
[ -n "$NAMED_VERSION" ] || cp "$STAGING" "$SNAP" || { echo "promote-channel: could not snapshot $STAGING" >&2; exit 1; }

# Read a pointer's fields via node (exact JSON, never a sed heuristic). read_field reads the
# staging SNAPSHOT; read_pointer_field <file> <field> reads any.
read_pointer_field() { node -e 'try{process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]]||""))}catch{}' "$1" "$2" 2>/dev/null || true; }
read_field() { read_pointer_field "$SNAP" "$1"; }
# kosmos#7005: the installer the promote checks and copies; with --version, the pair from the named commit.
SETUP_SRC="$SITE/setup-staging"
SETUP_HAND="cp setup-staging setup && cp setup-staging.sha256 setup.sha256"
SNAP_LABEL="$STAGING"
PTR_WORDS="the staging pointer"; PTR_SUBJ="staging"; PTR_SHA_WORDS="staging pointer"   # named mode names its commit instead
FORCE_WORDS="--force"   # named mode needs --sha with it, and says so wherever it offers --force
SETUP_MISMATCH_HINT="(A later staging cut replaced it, or the checkout is stale.)"
SETUP_HAND_HINT="setup-staging, copy setup-staging (+ .sha256) onto setup (+ .sha256) by hand"
if [ -n "$NAMED_VERSION" ]; then
  NAMED_DIR="$(mktemp -d "${TMPDIR:-/tmp}/promote-channel-named.XXXXXX")" || { NAMED_DIR=""; echo "promote-channel: could not make a temp folder for the named installer" >&2; exit 1; }
  # Every commit on HEAD whose pointer names V. Usually one, the staging cut's (pointer and installer together); a
  # later hand republish of V is another, and it may name no installer, or sit beside a later cut's setup-staging.
  # -G narrows the walk to commits whose diff mentions V (it also finds the commit that replaced V, and its dots match
  # any character): every candidate is read and kept only if its pointer names V exactly. It finds every commit that
  # changed V's pointer because the pointer is ONE line (tools/lib/write-latest-pointer.js), so any change to it
  # removes and adds the line holding the version; a hand-edited multi-line pointer would break that.
  git -C "$SITE" rev-parse --verify -q HEAD >/dev/null || { echo "promote-channel: $SITE is not a git checkout with a HEAD, so --version cannot read the commit that published $NAMED_VERSION - refusing; nothing was written." >&2; exit 1; }
  # Only a commit the site has published was ever served to staging: with an origin, a commit that is not on
  # origin/main is not a candidate at all (so a local, never-pushed one cannot cause a disagreement). A site with no
  # origin (a local test site) cannot say, and the promote says so.
  _has_origin=""; _unpub=""
  if git -C "$SITE" remote get-url origin >/dev/null 2>&1; then
    _has_origin=1
    pointer_freeze_fetch "$SITE" || { echo "promote-channel: could not fetch the site to check which commits naming $NAMED_VERSION were published - refusing; nothing was written." >&2; exit 1; }
    # The walk below reads HEAD's history: a checkout behind origin would miss a later commit naming V (a re-cut), and
    # so never see that V names more than one build. It must hold all of origin/main.
    git -C "$SITE" merge-base --is-ancestor origin/main HEAD \
      || { echo "promote-channel: this checkout is behind the site's origin/main, so commits naming $NAMED_VERSION there would not be seen - refusing; nothing was written. Bring the site checkout to origin's main first." >&2; exit 1; }
  fi
  NAMED_COMMIT=""; _paired=""; _builds=""; _seen=""; _newest=""
  for _c in $(git -C "$SITE" log --format=%H -G "\"version\": *\"$NAMED_VERSION\"" HEAD -- "dist/$STAGING_NAME" 2>/dev/null); do
    git -C "$SITE" show "${_c}:dist/$STAGING_NAME" > "$NAMED_DIR/candidate.json" 2>/dev/null || continue
    [ "$(read_pointer_field "$NAMED_DIR/candidate.json" version)" = "$NAMED_VERSION" ] || continue
    case "$_c" in "$NAMED_PICK"*) ;; *) continue ;; esac   # --commit: only that commit (empty: every commit)
    _s="$(read_pointer_field "$NAMED_DIR/candidate.json" sha256)"
    [ -n "$_s" ] || continue   # no bytes named: not a usable pointer for V, so not a candidate
    case "$_s" in "$NAMED_SHA"*) ;; *) continue ;; esac   # --sha: only the build it names (empty: every build)
    # Last, so an unpublished commit is reported only when it is what --sha/--commit would otherwise have chosen.
    if [ -n "$_has_origin" ] && ! git -C "$SITE" merge-base --is-ancestor "$_c" origin/main 2>/dev/null; then
      _unpub="${_unpub:+$_unpub }${_c:0:10}"; continue
    fi
    _seen="${_seen:+$_seen; }sha256 ${_s:0:12} in ${_c:0:10} ($(git -C "$SITE" log -1 --date=short --format=%cd "$_c"))"
    # The build a commit names: its bytes, artifact and manifest. Every commit naming V must name the same one.
    _b="$_s|$(read_pointer_field "$NAMED_DIR/candidate.json" "$ARTIFACT_FIELD")|$(read_pointer_field "$NAMED_DIR/candidate.json" manifest)"
    # A space-separated list: pointer fields are bare filenames and hex, never with spaces (a space would read as a
    # disagreement, which refuses).
    case " $_builds " in *" $_b "*) ;; *) _builds="${_builds:+$_builds }$_b" ;; esac
    [ -n "$NAMED_COMMIT" ] || NAMED_COMMIT="$_c"   # the newest commit kept (all kept commits name one build, or it refuses below)
    _ps="$(read_pointer_field "$NAMED_DIR/candidate.json" setup_sha256)"
    if [ -z "$_paired" ] && [ -n "$_ps" ] \
       && [ "$(git -C "$SITE" show "${_c}:setup-staging" 2>/dev/null | shasum -a 256 | awk '{print $1}')" = "$_ps" ]; then _paired="$_c"; fi
  done
  if [ -z "$NAMED_COMMIT" ]; then
    _why="(Pull the site, or check the version.)"
    { [ -n "$NAMED_SHA" ] || [ -n "$NAMED_PICK" ]; } && _why="(Check the version, and the --sha or --commit given.)"
    [ -z "$_unpub" ] || _why="Commits naming it that are not on the site's origin/main, so staging never served them: $_unpub."
    _pub=""; [ -z "$_has_origin" ] || _pub="published "
    echo "promote-channel: no ${_pub}commit on $SITE's HEAD has a $STAGING_NAME naming $NAMED_VERSION${NAMED_SHA:+ with a sha256 starting $NAMED_SHA}${NAMED_PICK:+ in a commit starting $NAMED_PICK} - refusing; nothing was written. $_why" >&2; exit 1
  fi
  case "$_builds" in *" "*)
    # What the operator can do depends on how they disagree: on the bytes (--sha picks one, or more of it does), or
    # only on the artifact or manifest name (--sha cannot separate them; --commit names the one to use).
    _nshas="$(set -f; IFS=' '; printf '%s\n' $_builds | cut -d'|' -f1 | sort -u | wc -l | tr -d ' ')"
    if [ "$_nshas" = 1 ]; then _way="They name the same bytes but a different artifact or manifest, which --sha cannot separate: name the commit whose pointer is right with --commit <its sha>."
    elif [ -n "$NAMED_SHA" ]; then _way="More than one build's sha256 starts with $NAMED_SHA: give more of the approved build's sha256."
    else _way="$NAMED_VERSION was cut more than once: name the build that was approved with --sha <its sha256, 8 or more characters>."; fi
    echo "promote-channel: commits naming $NAMED_VERSION disagree on its build ($_seen) - refusing; nothing was written. $_way" >&2; exit 1 ;;
  esac
  _newest="$NAMED_COMMIT"
  [ -z "$_unpub" ] || echo "promote-channel: NOTE ignoring commits naming $NAMED_VERSION that are not on the site's origin/main (never served to staging): $_unpub" >&2
  [ -z "$_paired" ] || NAMED_COMMIT="$_paired"
  # The cut's own commit can win over a later commit naming the same build (--sha and --commit have already narrowed
  # the set). Say so when the two pointers match apart from the installer; refuse when they differ in more, since a
  # republish may carry a correction and which pointer is right is the operator's to name (--commit).
  if [ -n "$_newest" ] && [ "$_newest" != "$NAMED_COMMIT" ]; then
    git -C "$SITE" show "${_newest}:dist/$STAGING_NAME" > "$NAMED_DIR/newest.json" 2>/dev/null
    git -C "$SITE" show "${NAMED_COMMIT}:dist/$STAGING_NAME" > "$NAMED_DIR/chosen.json" 2>/dev/null
    if node -e 'const r=f=>{const p=JSON.parse(require("fs").readFileSync(f,"utf8"));delete p.setup_sha256;return p};process.exit(require("util").isDeepStrictEqual(r(process.argv[1]),r(process.argv[2]))?0:1)' "$NAMED_DIR/newest.json" "$NAMED_DIR/chosen.json" 2>/dev/null; then
      _ns="$(read_pointer_field "$NAMED_DIR/newest.json" setup_sha256)"; _cs="$(read_pointer_field "$NAMED_DIR/chosen.json" setup_sha256)"
      if [ "$_ns" = "$_cs" ] || [ -z "$_ns" ]; then
        echo "promote-channel: NOTE using ${NAMED_COMMIT:0:10} for $NAMED_VERSION; ${_newest:0:10}, a later commit naming it, points at the same build" >&2
      else
        echo "promote-channel: NOTE using ${NAMED_COMMIT:0:10} for $NAMED_VERSION; ${_newest:0:10}, a later commit naming it, points at the same build but names installer ${_ns:0:12}, not the ${_cs:0:12} this promote checks and copies to /setup (its setup-staging does not match it; --commit ${_newest:0:10} would refuse on that)" >&2
      fi
    else
      # Which of two different pointers for V is the right one is not this script's to guess: a later one may carry a
      # correction, the earlier one is the cut's own. The operator names it.
      echo "promote-channel: ${NAMED_COMMIT:0:10} ($NAMED_VERSION's cut) and ${_newest:0:10} (a later commit naming $NAMED_VERSION) have pointers that differ in more than the installer they name - refusing; nothing was written. Name the one to promote with --commit <its sha>." >&2
      exit 1
    fi
    rm -f "$NAMED_DIR/newest.json" "$NAMED_DIR/chosen.json"
  fi
  if [ -n "$_has_origin" ]; then
    # One baseline for "what prod serves": the rollback guard, the signature checks and the tunnel gate's control all
    # read prod's pointer, so the checkout's must be origin's (a checkout behind origin, or holding a promote that was
    # never deployed, would give each of them a wrong one).
    _orig_prod="$(git -C "$SITE" show "origin/main:dist/$PROD_NAME" 2>/dev/null)" || _orig_prod=""
    [ "$_orig_prod" = "$(cat "$SITE/dist/$PROD_NAME" 2>/dev/null)" ] \
      || { echo "promote-channel: this checkout's dist/$PROD_NAME is not origin's (behind it, or holding a promote that was never deployed) - refusing; nothing was written. Bring the site checkout to origin's main first." >&2; exit 1; }
  else
    echo "promote-channel: NOTE the site has no origin remote, so whether ${NAMED_COMMIT:0:10} was ever published cannot be checked" >&2
  fi
  git -C "$SITE" show "${NAMED_COMMIT}:dist/$STAGING_NAME" > "$SNAP" || { echo "promote-channel: could not read $STAGING_NAME from $NAMED_COMMIT - refusing; nothing was written." >&2; exit 1; }
  rm -f "$NAMED_DIR/candidate.json"
  SNAP_LABEL="the $STAGING_NAME committed in ${NAMED_COMMIT:0:10}"
  PTR_WORDS="the pointer committed in ${NAMED_COMMIT:0:10}"; PTR_SUBJ="$PTR_WORDS"; PTR_SHA_WORDS="$PTR_WORDS"
  FORCE_WORDS="--force with --sha <8+ characters of $NAMED_VERSION's sha256>"
  SETUP_MISMATCH_HINT="(The installer committed beside $SNAP_LABEL is not the one it names.)"
  SETUP_SRC="$NAMED_DIR/setup-staging"
  for _f in setup-staging setup-staging.sha256; do
    git -C "$SITE" cat-file -e "${NAMED_COMMIT}:$_f" 2>/dev/null || continue
    git -C "$SITE" show "${NAMED_COMMIT}:$_f" > "$NAMED_DIR/$_f" || { echo "promote-channel: could not read $_f from $NAMED_COMMIT - refusing; nothing was written." >&2; exit 1; }
  done
  SETUP_HAND="git show ${NAMED_COMMIT}:setup-staging > setup && git show ${NAMED_COMMIT}:setup-staging.sha256 > setup.sha256"
  # Only V's own cut commit changes setup-staging; beside any other commit naming V (a republish) setup-staging is
  # whatever an earlier commit left, maybe a LATER cut's, so it is not offered as V's installer.
  if git -C "$SITE" diff-tree --root --no-commit-id --name-only -r "$NAMED_COMMIT" -- setup-staging | grep -qx setup-staging; then
    SETUP_HAND_HINT="the installer committed beside $SNAP_LABEL, run $SETUP_HAND (in $SITE)"
  else
    SETUP_HAND_HINT="an installer, find it by hand: ${NAMED_COMMIT:0:10} did not commit one, so the setup-staging beside it may belong to another cut. Copy that cut's setup-staging (+ .sha256) onto setup (+ .sha256)"
  fi
  echo "promote-channel: --version $NAMED_VERSION: the staging pointer committed in $(git -C "$SITE" log -1 --format='%h (%s)' "$NAMED_COMMIT"), and the installer in that commit's tree, not what $STAGING_NAME names now"
fi
V="$(read_field version)"; SHA="$(read_field sha256)"; ARTIFACT="$(read_field "$ARTIFACT_FIELD")"

# Defense in depth on a prod path: artifact/manifest names come from the staging pointer and
# are used directly as filesystem paths below, so reject any value that is not a bare filename
# (a pointer should only ever name a file in dist/, never a path). Out of the accidental-
# corruption threat model -- anyone who can write the pointer can write latest.json -- but cheap.
reject_pathy() { case "$2" in *"/"*|*".."*) echo "promote-channel: $PTR_WORDS's $1 ('$2') is not a bare filename - refusing" >&2; exit 1 ;; esac; }
reject_pathy "$ARTIFACT_FIELD" "$ARTIFACT"
# kosmos#7281: the Linux family moves with the Mac pointer or the promote refuses, decided before any gate or write.
if [ "$FAMILY" = mac ]; then promote_linux_prepare "$SITE" "$V" "${NAMED_VERSION:+$NAMED_COMMIT}" || exit 1; fi
# kosmos#6149 point 1 (after the bare-filename check, before any write): prod must never be pointed at a Mac build older than the setup floor; the installer prod serves beside it is checked below.
if [ "$FAMILY" = mac ]; then
  . "$(dirname "$0")/lib/setup-floor.sh" || { echo "promote-channel: cannot load tools/lib/setup-floor.sh" >&2; exit 1; }
  # The snapshot's own bytes (what is copied to prod), so a doubled key is refused here too: readers of a doubled key
  # disagree about which build it names.
  kosmos_setup_floor_pointer_ok "$PTR_WORDS being promoted" "$(cat "$SNAP")" || exit 1
fi
[ -n "$V" ] && [ -n "$SHA" ] && [ -n "$ARTIFACT" ] || { echo "promote-channel: $SNAP_LABEL is missing version/sha256/$ARTIFACT_FIELD - not a usable pointer" >&2; exit 1; }
# kosmos#7005: a named V older than what prod serves is a rollback, and needs saying so (--allow-older): with the gates
# holding on a board that has moved on, --force is this mode's usual path, and a mistyped version must not ride it.
if [ -n "$NAMED_VERSION" ]; then
  # What prod serves is origin's latest.json (fetched above when the site has an origin); a checkout behind origin,
  # or holding a promote not yet deployed, would give a wrong baseline. Without an origin, the checkout's is all there is.
  if [ -n "$_has_origin" ] && git -C "$SITE" rev-parse -q --verify "origin/main:dist/$PROD_NAME" >/dev/null 2>&1; then
    git -C "$SITE" show "origin/main:dist/$PROD_NAME" > "$NAMED_DIR/prod.json" 2>/dev/null
    _prodv="$(read_pointer_field "$NAMED_DIR/prod.json" version)"; _prods="$(read_pointer_field "$NAMED_DIR/prod.json" sha256)"; _prodsrc="the site's origin/main"
  else
    _prodv="$(read_pointer_field "$SITE/dist/$PROD_NAME" version)"; _prods="$(read_pointer_field "$SITE/dist/$PROD_NAME" sha256)"
    if [ -n "$_has_origin" ]; then _prodsrc="this checkout (origin's main has none)"; else _prodsrc="this checkout (no origin to read)"; fi
  fi
  echo "promote-channel: --version $V; $PROD_NAME on $_prodsrc names ${_prodv:-nothing}"
  # 0 V is not older, 1 V is older, anything else (2: a version that is not numbers; node failing) cannot tell.
  _cmp=0
  # A prod pointer that is there but names no version cannot be compared: only no pointer at all is a first promote.
  if [ -z "$_prodv" ]; then
    if [ -f "$SITE/dist/$PROD_NAME" ] || { [ -n "$_has_origin" ] && git -C "$SITE" rev-parse -q --verify "origin/main:dist/$PROD_NAME" >/dev/null 2>&1; }; then _cmp=2; _prodv="(no version)"; fi
  else node -e 'const a=process.argv[1].split(".").map(Number),b=process.argv[2].split(".").map(Number);if(a.concat(b).some(Number.isNaN))process.exit(2);for(let i=0;i<Math.max(a.length,b.length);i++){const d=(a[i]||0)-(b[i]||0);if(d)process.exit(d>0?0:1)}process.exit(0)' "$V" "$_prodv" 2>/dev/null || _cmp=$?
  fi
  case "$_cmp" in
    0) # The same version with other bytes is a replacement, not a rollback: allowed, and said.
       [ "$_prodv" = "$V" ] && [ -n "$_prods" ] && [ "$_prods" != "$SHA" ] \
         && echo "promote-channel: NOTE prod already serves $V as other bytes (sha256 ${_prods:0:12}); this promote replaces them with ${SHA:0:12}" >&2 ;;
    1) [ "$ALLOW_OLDER" = 1 ] || { echo "promote-channel: $V is older than $_prodv ($PROD_NAME on $_prodsrc) - refusing; nothing was written. A rollback needs --allow-older as well." >&2; exit 1; }
       echo "promote-channel: --allow-older: rolling prod back from $_prodv to $V" >&2 ;;
    *) [ "$ALLOW_OLDER" = 1 ] || { echo "promote-channel: $V cannot be compared with '$_prodv' ($PROD_NAME on $_prodsrc), so it may be a rollback - refusing; nothing was written. Pass --allow-older to replace it anyway." >&2; exit 1; }
       echo "promote-channel: --allow-older: replacing '$_prodv' with $V without knowing which is newer" >&2 ;;
  esac
fi

# THE SAME-BYTES INVARIANT, checked before the gate and before any promote: the artifact
# the staging pointer names must EXIST and its served sha must verify in place AND equal the
# pointer's sha. This is the refusal that makes promote safe - it can only ever point prod at
# bytes that are present and match what staging advertised. Not overridable by --force.
[ -f "$SITE/dist/$ARTIFACT" ] || { echo "promote-channel: $PTR_SUBJ names $ARTIFACT, which is not in $SITE/dist - refusing to promote a missing artifact" >&2; exit 1; }
[ -f "$SITE/dist/$ARTIFACT.sha256" ] || { echo "promote-channel: $ARTIFACT.sha256 sidecar is missing - cannot verify the bytes" >&2; exit 1; }
( cd "$SITE/dist" && shasum -a 256 --status -c "$ARTIFACT.sha256" ) \
  || { echo "promote-channel: $ARTIFACT does not verify against its sidecar - refusing to promote unverified bytes" >&2; exit 1; }
DISK_SHA="$(awk '{print $1}' "$SITE/dist/$ARTIFACT.sha256")"
[ "$DISK_SHA" = "$SHA" ] || { echo "promote-channel: $PTR_SHA_WORDS sha ($SHA) != the served artifact sha ($DISK_SHA) - refusing (the pointer does not describe the bytes on disk)" >&2; exit 1; }

# #5032: the installer moves with the pointer. A staging cut publishes /setup-staging and leaves /setup
# (what prod installs and prod updates run) at the prior prod installer, and its pointer NAMES that
# installer (setup_sha256). The promote copies the pair onto /setup below. Checked HERE, before any
# write and BEFORE the board gates (they take minutes; this is the predictable refusal on a stale checkout), so a
# refusal leaves prod untouched and costs seconds:
#   - the staging pointer names no installer: a cut before #5032, or a pointer republished by hand
#     (publish-staging-pointer.sh cannot know which installer a build was cut with). /setup is left
#     as it is, and the promote says so.
#   - it names one: setup-staging must be COMMITTED and UNMODIFIED (a working-tree copy that was never
#     committed was never served), it must hash to the pointer's setup_sha256, and its sidecar must name
#     the same bytes. Anything else refuses: the promote would otherwise pair the build with an
#     installer it was not cut with.
SETUP_STAGING=""
PTR_SETUP="$(read_field setup_sha256)"
if [ "$FAMILY" = mac ] && [ -n "$PTR_SETUP" ]; then
  [ -z "$NAMED_VERSION" ] || { [ -f "$SETUP_SRC" ] && [ -f "$SETUP_SRC.sha256" ]; } \
    || { echo "promote-channel: the pointer for $NAMED_VERSION names installer $PTR_SETUP but its commit has no setup-staging pair - refusing; nothing was written." >&2; exit 1; }
  [ -n "$NAMED_VERSION" ] || for _f in setup-staging setup-staging.sha256; do
    git -C "$SITE" ls-files --error-unmatch "$_f" >/dev/null 2>&1 \
      || { echo "promote-channel: the staging pointer names installer $PTR_SETUP but $SITE/$_f is not committed - refusing; nothing was written. (Refresh the site checkout, or remove a leftover from an aborted cut.)" >&2; exit 1; }
    git -C "$SITE" diff --quiet HEAD -- "$_f" \
      || { echo "promote-channel: $SITE/$_f differs from its committed copy, so the working tree is not what staging served - refusing; nothing was written." >&2; exit 1; }
  done
  _sg="$(shasum -a 256 < "$SETUP_SRC" | awk '{print $1}')"
  _sw="$(awk 'NR==1{print $1}' "$SETUP_SRC.sha256")"
  [ "$_sg" = "$PTR_SETUP" ] \
    || { echo "promote-channel: setup-staging hashes to $_sg but $PTR_WORDS names installer $PTR_SETUP - refusing; nothing was written. $SETUP_MISMATCH_HINT" >&2; exit 1; }
  [ "$_sw" = "$_sg" ] \
    || { echo "promote-channel: setup-staging.sha256 names '${_sw:-nothing}', not the setup-staging bytes $_sg - refusing; nothing was written." >&2; exit 1; }
  SETUP_STAGING="$_sg"
  # kosmos#6149: setup-staging is about to become /setup: it must know the read-only app (before any write).
  kosmos_setup_floor_installer_ok "setup-staging (about to become /setup)" "$SETUP_SRC" || exit 1
# (No /setup in the site at all: nothing here to check; deploy-site's export check covers whatever is published.)
elif [ "$FAMILY" = mac ] && [ -f "$SITE/setup" ]; then
  # kosmos#6149: no installer named, so prod keeps its /setup beside the promoted pointer: the COMMITTED one (what a
  # deploy serves) must know the read-only app too. Checked before the gates (minutes), and nothing re-checks its bytes
  # before the write (setup-staging's are held by its sha re-check there); deploy-site's export check is the authority.
  git -C "$SITE" ls-files --error-unmatch setup >/dev/null 2>&1 && git -C "$SITE" diff --quiet HEAD -- setup \
    || { echo "promote-channel: $SITE/setup is not committed or differs from its committed copy, so it is not what prod serves - refusing; nothing was written." >&2; exit 1; }
  kosmos_setup_floor_installer_ok "the /setup prod keeps serving" "$SITE/setup" || exit 1
fi


if [ "$FAMILY" = mac ]; then
  # The pointer promote is about to copy to latest.json also advertises the manifest; do not
  # promote a prod pointer to a manifest that has gone missing since publish.
  MANIFEST="$(read_field manifest)"
  reject_pathy manifest "$MANIFEST"
  [ -n "$MANIFEST" ] && [ -f "$SITE/dist/$MANIFEST" ] || { echo "promote-channel: $PTR_WORDS advertises manifest '${MANIFEST:-<none>}', which is not in $SITE/dist - refusing to promote a pointer to a missing manifest" >&2; exit 1; }
  # kosmos#7005: the commit pins the artifact's sha, not the manifest's; a named promote runs long after the cut, so
  # it records which manifest bytes it checked.
  [ -z "$NAMED_VERSION" ] || echo "promote-channel: --version $V: manifest $MANIFEST from dist/ (sha256 $(shasum -a 256 < "$SITE/dist/$MANIFEST" | awk '{print $1}'))"
  # #6468 ask 2: a prod install running a release that ships engine/manifest-verify.js refuses any update whose
  # manifest is not signed by a pinned key, so promoting such a version past those installs would strand them.
  # A .sig that is there must verify; a missing one refuses once the release prod serves NOW checks signatures
  # (a version cut before signing can still be promoted over a prod that does not check them).
  _sign_js="$(cd "$(dirname "$0")" && pwd)/lib/manifest-sign.js"
  if [ -f "$SITE/dist/$MANIFEST.sig" ]; then
    node "$_sign_js" verify "$SITE/dist/$MANIFEST" "$SITE/dist/$MANIFEST.sig" >/dev/null \
      || { echo "promote-channel: $MANIFEST.sig does not verify under a pinned key - refusing; every checking install would refuse this update (#6468)" >&2; exit 1; }
    # Round 7: and under the keys prod's CURRENT release pins, which is what its installs check with.
    _cur="$(sed -n 's/.*"manifest"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SITE/dist/$PROD_NAME" 2>/dev/null | head -1)" || _cur=""
    if [ -n "$_cur" ]; then
      reject_pathy manifest "$_cur"
      _vu=0; [ -f "$SITE/dist/$_cur" ] && { node "$_sign_js" verify-under "$SITE/dist/$MANIFEST" "$SITE/dist/$MANIFEST.sig" "$SITE/dist/$_cur" >/dev/null || _vu=$?; } || _vu=2
      case "$_vu" in
        0) : ;;
        1) echo "promote-channel: $MANIFEST.sig is not signed by a key prod's current release ($_cur) accepts - refusing; its installs would refuse this update (#6468)" >&2; exit 1 ;;
        *) echo "promote-channel: prod's current manifest ($_cur) cannot be read to tell which keys its installs accept - refusing (#6468)" >&2; exit 1 ;;
      esac
    fi
  else
    _prod_manifest="$(sed -n 's/.*"manifest"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SITE/dist/$PROD_NAME" 2>/dev/null | head -1)" || _prod_manifest=""
    [ -z "$_prod_manifest" ] || reject_pathy manifest "$_prod_manifest"
    if [ -n "$_prod_manifest" ]; then
      # A prod pointer that names a manifest promote cannot read is "cannot tell", which refuses: reading it as "prod
      # does not check signatures" would strand every install that does.
      _ns=0; [ -f "$SITE/dist/$_prod_manifest" ] && { node "$_sign_js" needs-sig "$SITE/dist/$_prod_manifest" || _ns=$?; } || _ns=2
      case "$_ns" in
        1) : ;;
        0) echo "promote-channel: $MANIFEST has no .sig, and the release prod serves now ($_prod_manifest) checks signatures - refusing; its installs would refuse this update (#6468)" >&2; exit 1 ;;
        *) echo "promote-channel: $MANIFEST has no .sig, and prod's current manifest ($_prod_manifest) cannot be read to tell whether its installs check signatures - refusing (#6468)" >&2; exit 1 ;;
      esac
    fi
  fi
  # #6609 phase 2c: with a recovery key pinned, installs take the served release key list before they check an update, so
  # the build being promoted must be signed by a key that list names (a list published after the staging cut can drop
  # it), signed or not. Read from the site's origin/main after a fetch, as release.sh step 1c reads it: this checkout
  # may be behind what is served. Off (no recovery key): nothing is fetched or checked.
  # needs-list: 0 on, 3 off; anything else (the tool or its verifier failing to load) refuses rather than reading as off.
  _nl=0; node "$_sign_js" needs-list || _nl=$?
  case "$_nl" in 0|3) : ;; *) echo "promote-channel: could not tell whether this checkout checks the release key list (manifest-sign.js needs-list exited $_nl) - refusing (#6609)" >&2; exit 1 ;; esac
  if [ "$_nl" = 0 ]; then
    git -C "$SITE" fetch -q origin main 2>/dev/null || { echo "promote-channel: could not fetch the site to read the served release key list - refusing (#6609)" >&2; exit 1; }
    _kl_dir="$(mktemp -d)" || { _kl_dir=""; echo "promote-channel: could not make a temp folder for the release key list - refusing (#6609)" >&2; exit 1; }
    git -C "$SITE" show "origin/main:dist/release-keys.json" > "$_kl_dir/release-keys.json" 2>/dev/null || rm -f "$_kl_dir/release-keys.json"
    git -C "$SITE" show "origin/main:dist/release-keys.json.sig" > "$_kl_dir/release-keys.json.sig" 2>/dev/null || rm -f "$_kl_dir/release-keys.json.sig"
    _kl=0; node "$_sign_js" verify-under-list "$SITE/dist/$MANIFEST" "$SITE/dist/$MANIFEST.sig" "$_kl_dir/release-keys.json" "$_kl_dir/release-keys.json.sig" >/dev/null || _kl=$?
    rm -rf "$_kl_dir"; _kl_dir=""
    [ "$_kl" = 0 ] || { echo "promote-channel: $MANIFEST is not signed by a key the served release key list names - refusing; installs with the recovery key check on would refuse this update (#6609)" >&2; exit 1; }
  fi

  # THE EXPERIENCE GATE (#2063). 0 = a fresh session can use the board -> promote; 1 = the
  # board is provably broken for a fresh session (#2023) -> refuse, never forceable; 2 =
  # cannot-tell here (no enforcing fresh board) -> HOLD, forceable only after a HAND check.
  GATE_CMD="${KOSMOS_PROMOTE_GATE_CMD:-bash $(cd "$(dirname "$0")/.." && pwd)/tools/staging-experience-check.sh}"
  # Forward [port] to the gate as its arg1 (the gate reads arg1 -> KOSMOS_PORT -> 16180). Giving
  # the fresh staging board's real port here is what keeps a wrong-port HOLD from pushing an
  # operator toward --force. When no port is given the gate falls back to KOSMOS_PORT/16180.
  echo "promote-channel: running the experience gate: $GATE_CMD${PORT:+ (port $PORT)}"
  # #5084: the gate refuses to speak for $V from a board on another version (cannot-tell, exit 2).
  BOARD_OTHER=""
  if [ -n "$NAMED_VERSION" ]; then
    # kosmos#7005: keep what the gate said, to learn whether it READ the board on another version (its #5084 line
    # "the board on :<port> runs <W>, not <V>"), as against a version it could not read at all.
    KOSMOS_GATE_EXPECT_VERSION="$V" $GATE_CMD ${PORT:+"$PORT"} | tee "$NAMED_DIR/experience-gate.log"; GATE_RC=${PIPESTATUS[0]}   # stdout only: stderr stays where default mode leaves it
    BOARD_OTHER="$(sed -n 's/.*cannot-tell: the board on :[0-9]* runs \([^ ,]*\), not .*/\1/p' "$NAMED_DIR/experience-gate.log" | head -1)"
    [ "$BOARD_OTHER" != "$V" ] || BOARD_OTHER=""
  else
    KOSMOS_GATE_EXPECT_VERSION="$V" $GATE_CMD ${PORT:+"$PORT"}; GATE_RC=$?
  fi
  case "$GATE_RC" in
    0) echo "promote-channel: gate PASSED - a fresh session can use $V (the gate checked a board running $V)." ;;
    1) echo "promote-channel: gate FAILED (exit 1) - the board is broken for a fresh session (the #2023 class). REFUSING to promote; --force does not override a provably-broken board." >&2; exit 1 ;;
    2)
      if [ "$FORCE" = 1 ]; then
        echo "promote-channel: gate could not run here (exit 2, cannot-tell) and --force was given - promoting on the strength of a HAND verification. NOTE: the experience was NOT automatically verified." >&2
        # #5084 (Baron's review): on a fleet board the gate HOLDS for every promote, so the #2023 check runs only if
        # someone runs it after the deploy. Say exactly how.
        # (${X:+a}${X:-b} is not an if/else: with X set, :- adds X itself. The port words are chosen first.)
        _gate_board="(KOSMOS_PORT, else :16180)"; [ -z "$PORT" ] || _gate_board="(:$PORT)"
        if [ -n "$NAMED_VERSION" ]; then
          # kosmos#7005: the board here has moved on to a later staging build and will never report $V again.
          _gate_state="which could not be tied to $V"; [ -z "$BOARD_OTHER" ] || _gate_state="which runs $BOARD_OTHER"
          echo "promote-channel: AFTER the deploy, run the check it could not on a board that runs $V: not the board the gate checked $_gate_board, $_gate_state, but a Mac on the prod channel once it has updated to $V, or a fresh install from /setup. KOSMOS_GATE_EXPECT_VERSION=$V bash $(cd "$(dirname "$0")/.." && pwd)/tools/staging-experience-check.sh <that board's port>" >&2
        else
          echo "promote-channel: AFTER the deploy, once the board the gate checked $_gate_board reports $V, run the check it could not: KOSMOS_GATE_EXPECT_VERSION=$V bash $(cd "$(dirname "$0")/.." && pwd)/tools/staging-experience-check.sh${PORT:+ $PORT}" >&2
        fi
      else
        if [ -n "$NAMED_VERSION" ]; then
          echo "promote-channel: gate could not tell (exit 2) - its cannot-tell line above says why: no fresh enforcing board here, or a board that is not running $V (#5084; with --version, usually a board that has moved on to a later staging build). HOLDING. Run this against a board on $V, or verify $V by hand and pass --force with --sha <8+ characters of its sha256>." >&2
        else
          echo "promote-channel: gate could not tell (exit 2) - its cannot-tell line above says why: no fresh enforcing board here, or a board that is not running $V (#5084). HOLDING. Run this on/against a fresh staging board on $V, or pass --force after verifying $V by hand." >&2
        fi
        exit 2
      fi ;;
    *) echo "promote-channel: gate returned an unexpected code ($GATE_RC) - refusing to promote on an ambiguous result" >&2; exit 1 ;;
  esac

  # THE AGENT-SPAWN GATE (#2036/#2129). The experience gate above proves a fresh BROWSER can
  # reach the board (#2023); it does NOT exercise agent spawn. #2129 was exactly that gap -
  # spawned agents wedged at the Claude Code trust prompt while the board served fine, so the
  # experience gate alone would PASS a #2129 build. This second gate creates a Claude and an
  # OpenAI agent, confirms each comes ONLINE and answers a first message, and removes them (kosmos#6906: so it runs on
  # a populated board). Same exit contract: 0 online -> promote; 1 a
  # trust wedge / auth / never-online (#2129 class) -> refuse, never forceable (one exception, kosmos#7005: with
  # --version, on a board the experience gate READ as another version, it is cannot-tell, below); 2 cannot-tell
  # (no enforcing board, a provider not signed in, or no answer in time) -> HOLD, forceable
  # only after a HAND check. Override the command via KOSMOS_PROMOTE_AGENT_GATE_CMD.
  # kosmos#6906: the gate creates real agents, and a launchd job file made during someone's full validation reds that
  # run's #3011 guard (it did, 2026-10-22, on Mortals). So by default it takes a real turn in the machine's suite queue
  # (tools/queued-heavy.sh, or KOSMOS_PROMOTE_AGENT_QUEUE: waits for no suite to be running and holds the machine claim
  # while it runs). An explicit KOSMOS_PROMOTE_AGENT_GATE_CMD runs as given, with no queue.
  # 🛑 The queue's OWN exit codes overlap the gate's (it exits 2, 3, 4, 75 for its own reasons, before the gate runs), so
  # the verdict is the gate's only when the queue's "QUEUED-HEAVY ... END rc=<n>" line says the gate ran and what it
  # answered. No such line: the gate never got a turn, which is cannot-tell (2), never PARTIAL and never a refusal.
  _pc_repo="$(cd "$(dirname "$0")/.." && pwd)"
  if [ -n "${KOSMOS_PROMOTE_AGENT_GATE_CMD:-}" ]; then
    AGENT_GATE_CMD="$KOSMOS_PROMOTE_AGENT_GATE_CMD"
    echo "promote-channel: running the agent-spawn gate: $AGENT_GATE_CMD${PORT:+ (port $PORT)}"
    $AGENT_GATE_CMD ${PORT:+"$PORT"}; AGENT_RC=$?
  else
    _pc_queue="${KOSMOS_PROMOTE_AGENT_QUEUE:-$_pc_repo/tools/queued-heavy.sh}"
    AGENT_GATE_CMD="bash $_pc_repo/tools/staging-agent-online-check.sh"
    echo "promote-channel: running the agent-spawn gate in the machine's queue: $_pc_queue agent-spawn-gate $AGENT_GATE_CMD${PORT:+ (port $PORT)}"
    _pc_qlog="$(mktemp "${TMPDIR:-/tmp}/promote-agentgate.XXXXXX")" || _pc_qlog=/dev/null   # no log: no END line: cannot-tell
    bash "$_pc_queue" agent-spawn-gate $AGENT_GATE_CMD ${PORT:+"$PORT"} 2>&1 | tee "$_pc_qlog"; _pc_qrc=${PIPESTATUS[0]}
    AGENT_RC="$(sed -n 's/^QUEUED-HEAVY [0-9:]* END rc=\([0-9][0-9]*\):.*/\1/p' "$_pc_qlog" | tail -1)"
    _pc_inherited=""; grep -q "agent-spawn-gate runs now, inside the turn" "$_pc_qlog" 2>/dev/null && _pc_inherited=1
    [ "$_pc_qlog" = /dev/null ] || rm -f "$_pc_qlog"; _pc_qlog=""   # #6922: the EXIT trap must not remove a reused name
    if [ -z "$AGENT_RC" ] && [ -n "$_pc_inherited" ]; then
      # Started inside a turn that already holds the machine (an inherited claim): the queue exec'd the gate itself and
      # prints no END line, so its exit code IS the gate's.
      AGENT_RC="$_pc_qrc"
      case "$AGENT_RC" in 0|1|2|3) ;; *) echo "promote-channel: the agent-spawn gate did not finish with a verdict (rc=$AGENT_RC) - treating it as cannot-tell." >&2; AGENT_RC=2 ;; esac
    elif [ -z "$AGENT_RC" ]; then
      echo "promote-channel: the agent-spawn gate never got a turn in the machine's queue (the queue exited $_pc_qrc) - treating it as cannot-tell." >&2
      AGENT_RC=2
    else
      case "$AGENT_RC" in
        0|1|2|3) ;;
        *) # 75 (the queue stopped it), 126/127 (it could not start), 128+n (killed): not a verdict the gate gave
           echo "promote-channel: the agent-spawn gate did not finish with a verdict (END rc=$AGENT_RC) - treating it as cannot-tell." >&2
           AGENT_RC=2 ;;
      esac
    fi
  fi
  # kosmos#7005: in named mode the board is usually on a later staging build. Only when the experience gate READ the
  # board's version and it is another one is this gate's FAIL or PARTIAL a verdict about that other build, and so
  # cannot-tell for $V (a HOLD, which a hand check of $V can --force). A version it could not read (a dev box, a wrong
  # port) may be $V itself, so there, as in default mode, a FAIL still refuses.
  if [ -n "$BOARD_OTHER" ] && { [ "$AGENT_RC" = 1 ] || [ "$AGENT_RC" = 3 ]; }; then
    echo "promote-channel: the agent-spawn gate answered $AGENT_RC on a board running $BOARD_OTHER, not $V, so it says nothing about $V's build - treating it as cannot-tell, which the --force given passes on the strength of your hand check of agent spawn on $V. A cause on this machine rather than in the build (a sign-in, a trust prompt) would hit $V too." >&2
    AGENT_RC=2
  fi
  case "$AGENT_RC" in
    0) echo "promote-channel: agent-spawn gate PASSED - a fresh Claude and OpenAI agent came online and answered a first message (the #2129 class is not present)."
       # #5084: it ran on the same board. When the experience gate could not tie that board to $V (cannot-tell,
       # then --force), this pass is not a check of $V either; say so beside it rather than let it read as one.
       [ "$GATE_RC" = 2 ] && echo "promote-channel: NOTE: that board was not shown to run $V (the experience gate above could not tell), so this agent-spawn pass is not a check of $V." >&2
       ;;
    1) echo "promote-channel: agent-spawn gate FAILED (exit 1) - the CLAUDE agent did not come online (trust wedge/auth/timeout, the #2129 class). REFUSING to promote; --force does not override a provably-broken build." >&2; exit 1 ;;
    2)
      if [ "$FORCE" = 1 ]; then
        echo "promote-channel: agent-spawn gate could not run here (exit 2, cannot-tell) and --force was given - promoting on the strength of a HAND verification. NOTE: agent spawn was NOT automatically verified." >&2
      else
        echo "promote-channel: agent-spawn gate could not run here (exit 2, cannot-tell) - no enforcing board, a provider not signed in, or an agent that did not answer in time (the gate says which above). HOLDING. Fix what it names and run again, or pass $FORCE_WORDS after verifying by hand." >&2
        exit 2
      fi ;;
    3)
      # PARTIAL: the Claude arm is online (the #2129 fix works) but the OpenAI/Codex arm failed.
      # This may be a SEPARATE codex-spawn issue #2129 does not fix, so it must NOT auto-hold the
      # whole promote (Splinter, 2026-09-04). It is forceable: the operator routes the decision
      # (typically promote the Claude fix + OpenAI gating and chase the codex issue separately).
      if [ "$FORCE" = 1 ]; then
        [ "$GATE_RC" = 2 ] && echo "promote-channel: NOTE: that board was not shown to run $V (the experience gate above could not tell), so this agent-spawn result is not a check of $V." >&2
        echo "promote-channel: agent-spawn gate PARTIAL (exit 3, Claude online / OpenAI-Codex arm failed) and --force was given - promoting the Claude fix + OpenAI gating; the OpenAI/Codex spawn issue is a separate card. NOTE: the OpenAI arm was NOT verified online." >&2
      else
        echo "promote-channel: agent-spawn gate PARTIAL (exit 3) - the CLAUDE arm is ONLINE (the #2129 fix works) but the OpenAI/Codex arm did NOT come online. This may be a separate codex-spawn issue #2129 does not fix. NOT auto-holding: surface WHICH arm failed to the operator - the Claude fix + OpenAI gating are shippable. Re-run with $FORCE_WORDS to promote them now and chase the codex issue separately, or hold for an operator ruling." >&2
        exit 3
      fi ;;
    *) echo "promote-channel: agent-spawn gate returned an unexpected code ($AGENT_RC) - refusing to promote on an ambiguous result" >&2; exit 1 ;;
  esac

  # THE FIRST KOSMOS+ SIGN-IN GATE (#2036, after #3827). The two gates above never touch
  # Kosmos+, and #3827's parseSaid bug broke exactly the FIRST in-app Kosmos+ sign-in while every
  # check ran from a Mac already signed in. An agent takes the fresh staging board through a real
  # first sign-in (tools/plus-signin-fresh.js: the code from the seed inbox via the Gmail
  # connector, #1591) and leaves a record for this sha; this gate reads it from the SNAPSHOT.
  # 0 pass -> promote; 1 fail or ambiguous -> refuse, never forceable; 2 cannot tell -> WARN and
  # promote (#3940, Josh 2026-09-26 11:54 CDT: "I don't need to test that part on staging ... that
  # shouldn't hold us up from pushing this live"). Exit 2 covers no record, an attempt still in
  # flight (deliberately NOT waited for any more), and a gate that could not run; the gate's own
  # line says which, and it is what gets logged. Once the promote has actually happened (the moment
  # the prod pointer is renamed into place), one line goes to promote-plus-unverified.log in the record directory
  # OF THE MACHINE THAT RAN THE PROMOTE, so which prod builds went out without a first Kosmos+
  # sign-in check stays answerable. A record that says FAIL still refuses: a measured break, not a
  # missing check. (Josh's go for a Mac prod promote is a process rule; this script has no flag
  # for it, see the header.) Override via KOSMOS_PROMOTE_PLUS_GATE_CMD.
  PLUS_GATE_CMD="${KOSMOS_PROMOTE_PLUS_GATE_CMD:-bash $(cd "$(dirname "$0")" && pwd)/plus-signin-verified.sh}"
  echo "promote-channel: running the first Kosmos+ sign-in gate: $PLUS_GATE_CMD"
  # stdout only: the gate prints its verdict there, and the logged reason must be that line, never
  # a stray diagnostic from stderr (which still reaches the terminal, uncaptured).
  PLUS_OUT="$($PLUS_GATE_CMD "$SNAP")"; PLUS_RC=$?
  [ -n "$PLUS_OUT" ] && printf '%s\n' "$PLUS_OUT"
  PLUS_UNVERIFIED=0; PLUS_REASON=
  case "$PLUS_RC" in
    0) echo "promote-channel: first Kosmos+ sign-in gate PASSED for $V." ;;
    1) echo "promote-channel: first Kosmos+ sign-in gate FAILED (exit 1) - a fresh Kosmos+ sign-in does not work on $V (the #3827 class), or its record is ambiguous. REFUSING to promote; --force does not override it." >&2; exit 1 ;;
    2)
      echo "promote-channel: WARNING first Kosmos+ sign-in gate could not confirm $V (exit 2) - this does not hold the promote (#3940, Josh's ruling 2026-09-26); it goes ahead if the remaining checks pass. A first Kosmos+ sign-in was NOT verified on this build." >&2
      PLUS_UNVERIFIED=1
      # The gate's last line says WHY (no record, an attempt in flight, the gate could not run).
      PLUS_REASON="$(printf '%s\n' "$PLUS_OUT" | awk 'NF{l=$0} END{print l}' | tr '\t\r' '  ')"
      [ -n "$PLUS_REASON" ] || PLUS_REASON="(the gate printed nothing)" ;;
    *) echo "promote-channel: first Kosmos+ sign-in gate returned an unexpected code ($PLUS_RC) - refusing to promote on an ambiguous result" >&2; exit 1 ;;
  esac

  # THE TUNNEL HANDSHAKE GATE (#4270). None of the gates above touch remote access: a build whose
  # connector cannot fetch a ticket, authenticate at the relay or serve would pass them all and
  # reach every Kosmos+ Mac. This runs the connector FROM THE STAGED TARBALL (the exact bytes being
  # promoted) against the live relay with the reserved gate identity. Same contract: 0 promote;
  # 1 the build is broken -> refuse, never forceable; 2 cannot-tell -> HOLD, forceable only after
  # a HAND check. The CONTROL is the build prod serves now ($PROD_NAME's artifact): when the
  # candidate fails, the gate runs the control with the same identity, so an outage or a lapsed
  # identity (the control fails too) holds instead of blaming this build.
  # Override via KOSMOS_PROMOTE_TUNNEL_GATE_CMD (it receives --tarball <the staged artifact>, and
  # --control-tarball <the served one> when prod's artifact is on disk).
  TUNNEL_GATE_CMD="${KOSMOS_PROMOTE_TUNNEL_GATE_CMD:-bash $(cd "$(dirname "$0")" && pwd)/tunnel-handshake-gate.sh}"
  TUNNEL_CONTROL=()
  SERVED_ART="$(read_pointer_field "$SITE/dist/$PROD_NAME" "$ARTIFACT_FIELD")"
  # A bare filename only, as for every pointer field here. A path-like one does not refuse the
  # promote (it is the CONTROL, not the bytes being promoted); it only means no control.
  case "$SERVED_ART" in *"/"*|*".."*) echo "promote-channel: NOTE $PROD_NAME's $ARTIFACT_FIELD ('$SERVED_ART') is not a bare filename; not using it as the tunnel gate's control" >&2; SERVED_ART="" ;; esac
  if [ -n "$SERVED_ART" ] && [ -f "$SITE/dist/$SERVED_ART" ]; then
    TUNNEL_CONTROL=(--control-tarball "$SITE/dist/$SERVED_ART")
  else
    echo "promote-channel: NOTE no served artifact on disk to use as the tunnel gate's control ($PROD_NAME names '${SERVED_ART:-nothing}'); a candidate failure will HOLD rather than refuse." >&2
  fi
  echo "promote-channel: running the tunnel handshake gate on $ARTIFACT's connector (control: ${SERVED_ART:-none}): $TUNNEL_GATE_CMD"
  $TUNNEL_GATE_CMD --tarball "$SITE/dist/$ARTIFACT" ${TUNNEL_CONTROL[@]+"${TUNNEL_CONTROL[@]}"}; TUNNEL_RC=$?
  case "$TUNNEL_RC" in
    0) echo "promote-channel: tunnel handshake gate PASSED - $V's connector fetched a ticket, authenticated at the live relay and served." ;;
    1) echo "promote-channel: tunnel handshake gate FAILED (exit 1) - $V's connector cannot reach remote access (the gate's FAIL line above names the step and why). REFUSING to promote; --force does not override it." >&2; exit 1 ;;
    2)
      if [ "$FORCE" = 1 ]; then
        echo "promote-channel: tunnel handshake gate could not run here (exit 2, cannot-tell) and --force was given - promoting on the strength of a HAND verification. NOTE: remote access was NOT automatically verified." >&2
      else
        echo "promote-channel: tunnel handshake gate could not tell (exit 2; its CANNOT TELL line above says why) - the coordinator or relay is down or mid-deploy, the served build's connector fails too, no gate identity is enrolled here (kosmos-relay deploy/release-gate.md), or another connector holds the gate identity. HOLDING. Fix that and run again; pass $FORCE_WORDS only after verifying remote access by hand." >&2
        exit 2
      fi ;;
    *) echo "promote-channel: tunnel handshake gate returned an unexpected code ($TUNNEL_RC) - refusing to promote on an ambiguous result" >&2; exit 1 ;;
  esac
else
  # WINDOWS: derive the alias BEFORE anything is written, so a name that cannot be derived is a
  # refusal with prod untouched (the Mac derives it after the pointer write, below). The pointer's
  # `artifact` must BE that alias: the promoted latest-win.json names it as the download, so it
  # has to be the file this promote refreshes.
  _arch="${ARTIFACT#kosmos-$V-win-}"; _arch="${_arch%.zip}"
  if [ -z "$_arch" ] || [ "$ARTIFACT" != "kosmos-$V-win-$_arch.zip" ]; then
    echo "promote-channel: cannot derive the Windows alias from $ARTIFACT (expected kosmos-$V-win-<arch>.zip) - refusing before any write." >&2
    exit 1
  fi
  ALIAS="kosmos-win-$_arch.zip"
  POINTER_ALIAS="$(read_field artifact)"
  [ "$POINTER_ALIAS" = "$ALIAS" ] || { echo "promote-channel: the staging pointer's artifact ('$POINTER_ALIAS') is not the alias $ALIAS this promote refreshes - refusing (the promoted latest-win.json would name a download that does not hold these bytes)." >&2; exit 1; }

  # GATE 1: JOSH'S GO FOR THIS EXACT BUILD. A recorded human decision, not a check (see the
  # header). The refusal names the version and the pointer, never the sha to paste: the approval
  # has to come from Josh's message, not from this script's output.
  . "$(cd "$(dirname "$0")" && pwd)/lib/win-approval.sh"
  if [ -z "$APPROVED_VERSION" ] || [ -z "$APPROVED_SHA" ] || [ -z "$APPROVAL_REF" ]; then
    echo "promote-channel: REFUSING - Josh's go is required. A Windows promote needs his explicit approval for this exact build ($V, the sha256 in $STAGING), passed as --approved-version <V> --approved-sha <sha256> --approval-ref <the Slack ts or permalink of his message>. Pass it only once he has approved that sha; nothing was written." >&2
    exit 1
  fi
  [ "$APPROVED_SHA" = "$SHA" ] || { echo "promote-channel: REFUSING - the approval names sha256 $APPROVED_SHA, which is not the staged build's ($STAGING). Josh's go covers one exact build; nothing was written." >&2; exit 1; }
  [ "$APPROVED_VERSION" = "$V" ] || { echo "promote-channel: REFUSING - the approval names version $APPROVED_VERSION, but the staged build is $V. Josh's go covers one exact build; nothing was written." >&2; exit 1; }
  win_approval_ref_ok "$APPROVAL_REF" || { echo "promote-channel: REFUSING - --approval-ref '$APPROVAL_REF' is not a Slack message ts or permalink (letters, digits and . _ : / ? = & % # + - only). Nothing was written." >&2; exit 1; }

  # GATE 2: THE VERIFICATION RECORD for the same sha, read from the SNAPSHOT. Never forceable:
  # 1 refuses, 2 HOLDS. On a pass the gate names the record it read and that record's sha256.
  WIN_GATE="$(cd "$(dirname "$0")" && pwd)/win-staging-verified.sh"
  echo "promote-channel: running the Windows verification gate on the snapshot of $STAGING_NAME: bash $WIN_GATE"
  WIN_GATE_OUT="$(bash "$WIN_GATE" "$SNAP" 2>&1)"; WIN_RC=$?
  printf '%s\n' "$WIN_GATE_OUT"
  case "$WIN_RC" in
    0) echo "promote-channel: Windows gate PASSED - the verification record passes $V ($SHA)." ;;
    1) echo "promote-channel: Windows gate FAILED (exit 1) - the verification record fails or is ambiguous. REFUSING to promote; nothing overrides this." >&2; exit 1 ;;
    2) echo "promote-channel: Windows gate cannot tell (exit 2) - no verification record for this build here. HOLDING. Verify the staged build on the Windows box first (and copy its record here if the promote runs elsewhere); this cannot be forced." >&2; exit 2 ;;
    *) echo "promote-channel: Windows gate returned an unexpected code ($WIN_RC) - refusing to promote on an ambiguous result" >&2; exit 1 ;;
  esac
  RECORD_LINE="$(printf '%s\n' "$WIN_GATE_OUT" | sed -n 's/^win-staging-verified: record_sha256=\([0-9a-f]\{64\}\) record=\(.*\)$/\1 \2/p' | head -1)"
  RECORD_SHA="${RECORD_LINE%% *}"; RECORD_PATH="${RECORD_LINE#* }"
  [ -n "$RECORD_LINE" ] && [ -n "$RECORD_SHA" ] && [ -n "$RECORD_PATH" ] || { echo "promote-channel: the Windows gate passed but did not name the record it read - refusing on an ambiguous result; nothing was written." >&2; exit 1; }
fi

# THE STAGING POINTER MUST NOT HAVE MOVED. The gates passed for the snapshot's build; if a
# staging publish landed meanwhile, refuse rather than promote something nobody re-checked.
[ "$FAMILY" != mac ] || promote_linux_unchanged "$SITE" || exit 1   # kosmos#7281
[ -n "$NAMED_VERSION" ] || cmp -s "$STAGING" "$SNAP" || { echo "promote-channel: REFUSING - $STAGING_NAME changed while the promote ran (a new staging publish?). The gates passed for the build it named at the start ($V), not for what it names now. Nothing was written; re-run the promote for the build you mean." >&2; exit 1; }

if [ "$FAMILY" = win ]; then
  # Record Josh's go BEFORE any write; an approval that cannot be logged was not given. The record
  # path goes last because it may contain spaces.
  APPROVAL_LINE="$(date -u +%FT%TZ) family=win path=promote version=$V sha256=$SHA approval_ref=$APPROVAL_REF record_sha256=$RECORD_SHA approval=given record=$RECORD_PATH"
  win_append_approval_line "$APPROVAL_LINE" || { echo "promote-channel: REFUSING - could not record Josh's go in $WIN_APPROVAL_LOG (an approval that is not logged is not given). Nothing was written." >&2; exit 1; }
  echo "promote-channel: Josh's go recorded in $WIN_APPROVAL_LOG: $APPROVAL_LINE"
fi

# #5032: re-checked here, right before the first write: setup-staging must still be the bytes checked above (the
# gates take minutes, and a site pull meanwhile could replace it).
if [ -n "$SETUP_STAGING" ] && { [ "$(shasum -a 256 < "$SETUP_SRC" | awk '{print $1}')" != "$SETUP_STAGING" ] \
     || [ "$(awk 'NR==1{print $1}' "$SETUP_SRC.sha256")" != "$SETUP_STAGING" ]; }; then
  echo "promote-channel: setup-staging changed while the gates ran - refusing; nothing was written." >&2; exit 1
fi
# kosmos#7005: a named promote does not have the staging-pointer re-check above to catch V being re-cut while the gates
# ran (a re-cut replaces V's tarball and sidecar in dist/), so it re-verifies the bytes here, before the first write.
if [ -n "$NAMED_VERSION" ]; then
  ( cd "$SITE/dist" && shasum -a 256 --status -c "$ARTIFACT.sha256" ) && [ "$(awk '{print $1}' "$SITE/dist/$ARTIFACT.sha256")" = "$SHA" ] \
    || { echo "promote-channel: $ARTIFACT is no longer the bytes checked above (sha256 $SHA; was $V re-cut while the gates ran?) - refusing; nothing was written." >&2; exit 1; }
fi

# Promote: copy the staging SNAPSHOT to prod. A pointer copy - the artifact bytes are already
# served and unchanged; only which pointer prod fetches changes. Written ATOMICALLY (temp in
# the same dir + rename): latest.json is the prod pointer every install fetches, so an
# interrupted write must never leave it truncated. rename(2) within one directory is atomic.
# The temp copy is proven to BE the verified snapshot before it replaces prod.
# kosmos#7281 review 1 (W1): the Linux pointer's temp copy is made and checked BEFORE latest.json moves, so all that is
# left after it is one rename.
[ "$FAMILY" != mac ] || promote_linux_stage "$SITE" || exit 1
PTMP="$(mktemp "$SITE/dist/.$PROD_NAME.XXXXXX")" || { echo "promote-channel: could not make a temp file in $SITE/dist" >&2; exit 1; }
cp "$SNAP" "$PTMP" || { echo "promote-channel: could not write $PROD_NAME" >&2; exit 1; }
if ! cmp -s "$SNAP" "$PTMP" || [ "$(read_pointer_field "$PTMP" "$ARTIFACT_FIELD")" != "$ARTIFACT" ] || [ "$(read_pointer_field "$PTMP" sha256)" != "$SHA" ]; then
  echo "promote-channel: the temp copy of the verified staging pointer does not read back as it (a faulty filesystem?) - refusing; $PROD_NAME was not touched." >&2
  exit 1
fi
mv "$PTMP" "$SITE/dist/$PROD_NAME" || { echo "promote-channel: could not write $PROD_NAME" >&2; exit 1; }
PTMP=""
# kosmos#7281: the Linux pointer, one rename right behind latest.json. A failure does not exit here: the log line,
# /setup and the alias below still run, and the promote refuses at the end (promote_linux_refuse_if_failed).
[ "$FAMILY" != mac ] || promote_linux_commit "$SITE"
# #3940: the prod pointer now names this build, so from here on the promote has HAPPENED even if a
# later step (the read-back, the alias) fails and exits. Log it now, not at the end: a promote
# refused BEFORE this line leaves nothing, one that changed prod always leaves its line.
if [ "$FAMILY" != win ] && [ "${PLUS_UNVERIFIED:-0}" = 1 ]; then
  PLUS_HOME="${HOME:-}"
  PLUS_LOG_DIR="${KOSMOS_PLUS_VERIFY_DIR:-${PLUS_HOME:+$PLUS_HOME/.local/state/kosmos/release-verify}}"
  PLUS_LOG="${PLUS_LOG_DIR:+$PLUS_LOG_DIR/promote-plus-unverified.log}"
  PLUS_HOST="$(hostname -s 2>/dev/null)"; [ -n "$PLUS_HOST" ] || PLUS_HOST=unknown
  if [ -n "$PLUS_LOG" ] && mkdir -p "$PLUS_LOG_DIR" 2>/dev/null \
     && { printf '%s\thost=%s\tversion=%s\tsha256=%s\tforce=%s\tfirst Kosmos+ sign-in NOT verified; promoted per #3940 (Josh 2026-09-26)\treason=%s\n' \
            "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PLUS_HOST" "$(printf '%s' "$V" | tr '\t\n' '  ')" "$(printf '%s' "$SHA" | tr '\t\n' '  ')" "$FORCE" "$PLUS_REASON" >> "$PLUS_LOG"; } 2>/dev/null; then
    echo "promote-channel: recorded in $PLUS_LOG (on this machine, $PLUS_HOST)" >&2
  else
    echo "promote-channel: WARNING could not append to ${PLUS_LOG:-the unverified-promote log (no HOME and no KOSMOS_PLUS_VERIFY_DIR)}; the promote happened and this output is the only record." >&2
  fi
fi
# #5032: the staging installer onto /setup (checked before any write, above), right after the pointer
# and its #3940 log line (so a failure here is still logged), and before the alias, so an alias failure never leaves
# the pointer promoted with /setup not yet copied. Temp + rename, as the
# pointer: /setup is what every prod install and update runs, so a cut-off copy must never be served.
if [ -n "$SETUP_STAGING" ]; then
  for _f in setup setup.sha256; do
    _t="$(mktemp "$SITE/.$_f.XXXXXX")" && STMP="$_t" || { echo "promote-channel: could not make a temp file for $_f (latest.json is promoted; /setup is NOT yet). Finish by hand before any deploy: $SETUP_HAND (in $SITE), then commit them with latest.json (re-running promote-channel.sh also works, but repeats the gates)." >&2; exit 1; }
    cp "$SETUP_SRC${_f#setup}" "$_t" && chmod 644 "$_t" && mv "$_t" "$SITE/$_f" && STMP="" \
      || { rm -f "$_t"; echo "promote-channel: could not write $_f (latest.json is promoted; /setup is NOT yet). Finish by hand before any deploy: $SETUP_HAND (in $SITE), then commit them with latest.json." >&2; exit 1; }
  done
  cmp -s "$SETUP_SRC" "$SITE/setup" && cmp -s "$SETUP_SRC.sha256" "$SITE/setup.sha256" \
    && [ "$(shasum -a 256 < "$SITE/setup" | awk '{print $1}')" = "$SETUP_STAGING" ] \
    || { echo "promote-channel: /setup does not read back as the verified setup-staging - check both by hand before any deploy" >&2; exit 1; }
  echo "   copied the staging installer onto /setup (sha256 $SETUP_STAGING)"
elif [ "$FAMILY" = mac ]; then
  echo "   $PTR_WORDS names no installer (cut before #5032, or republished by hand): /setup left as it is"
  # Review 2: say it loudly when a committed staging installer differs from /setup. Then prod gets this
  # build beside the OLDER installer, the pairing #5032 removes; copying is not safe either, because
  # nothing says the staging installer belongs to this build.
  if [ -f "$SETUP_SRC" ] && ! cmp -s "$SETUP_SRC" "$SITE/setup"; then
    echo "promote-channel: WARNING setup-staging differs from /setup and the promoted pointer names no installer, so prod now serves $V beside the OLDER /setup. If $V was cut with $SETUP_HAND_HINT and commit them with $PROD_NAME." >&2
  fi
fi
# Prove the promote landed: the prod pointer now names the same artifact + sha as the snapshot.
PROD_ART="$(read_pointer_field "$SITE/dist/$PROD_NAME" "$ARTIFACT_FIELD")"
PROD_SHA="$(read_pointer_field "$SITE/dist/$PROD_NAME" sha256)"
[ "$PROD_ART" = "$ARTIFACT" ] && [ "$PROD_SHA" = "$SHA" ] || { echo "promote-channel: $PROD_NAME was renamed into place from the verified snapshot but does not read back as it (a faulty filesystem?). Check $PROD_NAME by hand before any deploy." >&2; exit 1; }
# Windows: the promoted pointer must be the snapshot byte for byte (one writer,
# tools/lib/write-latest-win-pointer.js, wrote it for both channels).
if [ "$FAMILY" = win ]; then
  cmp -s "$SNAP" "$SITE/dist/$PROD_NAME" || { echo "promote-channel: $PROD_NAME is not a byte-for-byte copy of the verified $STAGING_NAME snapshot (a faulty filesystem?). Check it by hand before any deploy." >&2; exit 1; }
fi

# #2036: refresh the unversioned prod alias (kosmos-<arch>.tar.gz) to the promoted bytes. The
# alias is the prod download fallback (old installers, and a modern install whose versioned fetch
# fails) and must track the CURRENT prod version. A staging cut deliberately leaves the alias at
# the prior prod bytes (release.sh gates its alias publish on a prod cut), so the PROMOTE is where
# the alias moves. Copy the just-verified versioned artifact onto the alias and re-derive its
# .sha256 named for the alias (verified in place by sha256_publish_as). The next deploy carries it.
# (Windows: the alias kosmos-win-<arch>.zip, derived and checked above before any write.)
if [ "$FAMILY" = mac ]; then
  _arch="${ARTIFACT#kosmos-$V-}"; _arch="${_arch%.tar.gz}"
  ALIAS="kosmos-$_arch.tar.gz"
  # REFUSE rather than report a successful promote with a stale or wrongly-named alias. latest.json
  # is already promoted here, so a silent stale prod alias (an old installer/fallback keeps getting
  # the prior version) is exactly the prod-facing surprise this card exists to prevent. The
  # recomposition check catches any artifact whose name does not have the kosmos-<V>-<arch>.tar.gz
  # shape (e.g. a version/name mismatch): then the strip is a no-op and the recomposed name differs.
  if [ -z "$_arch" ] || [ "$ARTIFACT" != "kosmos-$V-$_arch.tar.gz" ]; then
    echo "promote-channel: cannot derive the prod alias from $ARTIFACT (expected kosmos-$V-<arch>.tar.gz) -- latest.json was promoted but the prod alias would be stale. Refusing; refresh kosmos-<arch>.tar.gz by hand or fix the artifact name." >&2
    exit 1
  fi
fi
cp "$SITE/dist/$ARTIFACT" "$SITE/dist/$ALIAS" || { echo "promote-channel: could not refresh the prod alias $ALIAS" >&2; exit 1; }
. "$(cd "$(dirname "$0")" && pwd)/lib/sha256-name.sh"
sha256_publish_as "$SITE/dist/$ARTIFACT.sha256" "$SITE/dist/$ALIAS.sha256" "$ALIAS" \
  || { echo "promote-channel: could not write $ALIAS.sha256 (the alias may be half-refreshed)" >&2; exit 1; }
# The refreshed alias must hold the PROMOTED bytes (the sha the snapshot names), not whatever the
# versioned name held a moment ago.
[ "$(awk 'NR==1{print $1}' "$SITE/dist/$ALIAS.sha256")" = "$SHA" ] || { echo "promote-channel: the refreshed alias $ALIAS does not hash to the promoted sha $SHA - refresh it by hand before any deploy" >&2; exit 1; }
echo "   refreshed the prod alias $ALIAS to $V"
[ "$FAMILY" != mac ] || promote_linux_refuse_if_failed || exit 1   # kosmos#7281 review 1 (W1)


if [ "$FAMILY" = win ]; then
  # Not "to prod": users are served the Windows files from R2, which this does not write (#3725).
  echo "promote-channel: updated the SITE CHECKOUT's $PROD_NAME to $V ($ARTIFACT). This does NOT change what users are served: that is tools/windows/publish-r2.ps1 -Promote."
else
  echo "promote-channel: PROMOTED $V to prod - $PROD_NAME now points at the exact bytes staging verified ($ARTIFACT)."
  [ "${PLUS_UNVERIFIED:-0}" = 1 ] && echo "promote-channel: NOTE a first Kosmos+ sign-in was NOT verified on $V (#3940); see ${PLUS_LOG:-the output above}."
  # kosmos#7349: the What's New pool records what prod SERVES (#5713), so it falls behind the moment this promote is
  # deployed, and the next cut stops on it before it claims the machine. Said here, where the promoter can act on it.
  echo "promote-channel: NEXT, once the deploy serves $V: node tools/whats-new-pool.js build <the next cut's version> on a branch, merged to main. It records $V's highlights as shown; until it merges, the next cut stops at its What's New check (kosmos#7349)."
fi
echo "   -> $(cat "$SITE/dist/$PROD_NAME")"
echo "promote-channel: the next site deploy publishes the prod pointer. No rebuild happened."
[ -n "$SETUP_STAGING" ] && echo "promote-channel: COMMIT setup and setup.sha256 together with $PROD_NAME (#5032): a deploy serves the committed site, and deploy-site.sh refuses a committed /setup that does not hash to the pointer's setup_sha256."
[ "$PROMOTE_LINUX" != yes ] || echo "promote-channel: COMMIT dist/latest-linux.json in the same commit as $PROD_NAME (kosmos#7281 lockstep)."
# Review 7 (W2): deploy-site refuses a Linux pointer that moves backwards unless the rollback is named to it.
[ "$PROMOTE_LINUX" != yes ] || [ "$ALLOW_OLDER" != 1 ] || echo "promote-channel: this is a rollback, so deploy it with KOSMOS_LINUX_ROLLBACK=$V set (deploy-site refuses a Linux pointer that moves backwards without it)."

if [ "$FAMILY" = win ]; then
  win_append_approval_line "$(date -u +%FT%TZ) family=win path=promote version=$V sha256=$SHA approval_ref=$APPROVAL_REF promoted=yes" \
    || echo "promote-channel: WARNING could not append the promote outcome to $WIN_APPROVAL_LOG (the approval line above is recorded; the promote happened)" >&2
  # A Windows-only promote does not move latest.json, so deploy-site.sh --promote (which exists to
  # publish a MOVED latest.json) would refuse it as "nothing to promote"; a plain --publish carries
  # the committed Windows files (they are tracked, shipped by git archive).
  echo "promote-channel: commit dist/$PROD_NAME, dist/$ALIAS and dist/$ALIAS.sha256, then deploy with tools/deploy-site.sh --publish."
  echo "promote-channel: NOTE users are served the Windows files from R2 (kosmos-dist-win), which this does not write; tools/windows/publish-r2.ps1 -Promote is what moves served prod (#3725)."
  exit 0
fi

# #2159: PREVIEW the release-notes social posts (X + LinkedIn) for the promoted version, so the
# operator sees what will be announced. NOT a live post here (no --publish): a promote flips the
# pointer but the served go-live is the SUBSEQUENT deploy, so announcing now would post a version
# users cannot yet fetch. The live post is the prod CUT's job (release.sh, which deploys within the
# cut); for a promoted release, post on the deploy or by hand. Best-effort preview. (Mac only: the
# notes are keyed to the Mac release.)
KOSMOS_RELEASE_IS_PROD=1 KOSMOS_SITE="$SITE" bash "$(cd "$(dirname "$0")" && pwd)/post-release-notes.sh" "$V" \
  || echo "promote-channel: release-notes preview returned non-zero (harmless; the promote succeeded)"
