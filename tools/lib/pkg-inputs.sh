#!/bin/bash
# The identity of the installer .pkg's INPUTS, so a served pkg can be proven
# current against source rather than trusted (#597's discipline, applied to
# the pkg per Splinter's B ruling, #638).
#
# ⚠️ WHY THIS EXISTS. The .pkg is payload-free and version-independent: it is
# rebuilt only when its own inputs change, NOT every cut. A
# slowly-changing artifact goes stale SILENTLY -- someone edits the postinstall,
# does not rebuild the pkg, and the served pkg runs an OLD postinstall while
# every test passes. And Kosmos.pkg + its .sha256 share one cache, so a stale
# pair verifies itself perfectly (the 0.5.13 wedge, different trigger). So the
# release does not SKIP the pkg (skipping is the hole); it compares the served
# pkg's inputs against what the CURRENT source would build.
#
# The input identity is the sha256 of everything the build consumes that
# decides the pkg's BEHAVIOUR (and, since #3643, who signs it): five paths.
#   install/pkg-scripts/**        the postinstall (what runs)
#   install/pkg-resources/**      the Welcome and Conclusion screens (what the
#                                 person is told; #662/#663 live here)
#   tools/build-installer-pkg.sh  the build itself, because the
#                                 distribution.xml (title, screens, arch,
#                                 choices) is a template INSIDE it
#   tools/lib/signing-identity.sh who signs it (#3643): the Installer identity
#                                 lived in the build script until it moved
#                                 here, so a team switch must still make the
#                                 next cut rebuild and re-sign the pkg
#   install/pkg-verify/**         the release check the postinstall runs (#6576):
#                                 its source and its floor
# (The bundle identifier is baked in by the build script, which is hashed, so
# it is not listed a second time here; a copy could drift from the real one.)
# NOT the version (metadata, and the pkg is version-independent) and NOT the
# signature/timestamp (those change every build and are not source), and NOT
# mtimes: bytes plus the executable bit (pkgbuild ships modes, and a postinstall
# without x is a pkg that runs nothing), and every path repo-relative, so a
# fresh worktree at any root hashes the same as the one it froze. The two-root
# control proves the hashing is root-independent; that git carries the x bit
# and nothing else mode-wise across a fresh worktree was measured separately
# (a detached worktree under umask 077, cwd /, a non-C locale: same sha).
# ⚠️ Hashing the whole build script means a comment edit there also asks for a
# rebuild + notarise + publish. That over-asks by minutes; the alternative
# under-asks by silently shipping an old Conclusion screen, which is the hole
# this guard exists to close. Baron's first pkg went out with new screens the
# guard's first draft could not see.
#
# Usage: source this file, then `pkg_input_sha <repo-root>` prints the sha.
pkg_input_sha() {
  local repo="${1:?pkg_input_sha needs a repo root}"
  local scripts="$repo/install/pkg-scripts"
  local resources="$repo/install/pkg-resources"
  local build="$repo/tools/build-installer-pkg.sh"
  local ident="$repo/tools/lib/signing-identity.sh"
  local verify="$repo/install/pkg-verify"   # #6576: the release check and its floor, built into the package
  # ALL inputs or nothing: a missing one is a refusal, never a sha over less.
  [ -d "$scripts" ]   || { echo "pkg_input_sha: no pkg-scripts at $scripts" >&2; return 1; }
  [ -d "$resources" ] || { echo "pkg_input_sha: no pkg-resources at $resources" >&2; return 1; }
  [ -f "$build" ]     || { echo "pkg_input_sha: no build script at $build" >&2; return 1; }
  [ -f "$ident" ]     || { echo "pkg_input_sha: no signing identity at $ident" >&2; return 1; }
  [ -d "$verify" ]    || { echo "pkg_input_sha: no release check at $verify" >&2; return 1; }
  # Deterministic: each input's path and bytes, in sorted order, under a
  # section label so a file moving between sections changes the sha too.
  # ⚠️ DOTFILES AND DOT-DIRECTORIES EXCLUDED. verify-served.sh runs this on the
  # SHARED checkout's working tree, where a .DS_Store from opening the folder
  # in Finder, or an editor's swap file, would report the served pkg as stale
  # against a sha nobody built. pkgbuild ships them too, but a hidden file has
  # never been a deliberate input here; if one ever is, name it and drop this.
  # ⚠️ EVERY INPUT READABLE FIRST: a `cat` failing inside the pipeline below
  # would hash the file as absent (the group's status is its last command),
  # which is "hashing less", the thing this function refuses to do. NUL-
  # delimited, so a name with a space is checked, not split into two names
  # that do not exist.
  local unreadable
  unreadable="$( _pkg_first_unreadable "$scripts" "$resources" "$build" "$ident" "$verify" )"
  [ -z "$unreadable" ] || { echo "pkg_input_sha: cannot hash input as it is: $unreadable" >&2; return 1; }
  # Each entry is framed: path, executable bit, byte count, then the bytes, so
  # a file with no trailing newline cannot run into the next path line.
  # 🛑 EVERY PATH IN THE STREAM IS REPO-RELATIVE (the dirs are entered, the
  # build script is named ./tools/...). The first version framed the build
  # script by its ABSOLUTE path, so the sha depended on the repo root: the
  # release freezes into a fresh mktemp worktree every cut, so cut N's
  # sidecar never matched cut N+1's source, and it would have rebuilt and
  # re-notarised every release while verify-served from the shared checkout
  # read STALE forever. Three real builds passed because "source" and
  # "built" were computed in the same directory. The two-root control in the
  # guard test is what sees this.
  {
    printf 'section:pkg-scripts\n'
    ( cd "$scripts" && _pkg_stream_dir )
    printf 'section:pkg-resources\n'
    ( cd "$resources" && _pkg_stream_dir )
    printf 'section:build-script\n'
    ( cd "$repo" && _pkg_stream_file ./tools/build-installer-pkg.sh )
    printf 'section:signing-identity\n'
    ( cd "$repo" && _pkg_stream_assignments ./tools/lib/signing-identity.sh )
    printf 'section:pkg-verify\n'
    ( cd "$verify" && _pkg_stream_dir )
  } | _pkg_hash | awk '{print $1}'
}
# The framed stream of one file: path, x or -, byte count, bytes.
_pkg_stream_file() {
  local f="${1:?}" x='-'
  [ -x "$f" ] && x='x'
  printf '%s\n%s\n%s\n' "$f" "$x" "$(wc -c < "$f" | tr -d ' ')"
  cat "$f"
}
# The signing identity's VALUES only (#3643): its lines that are not whole-line comments or blank,
# framed like a file but without the x bit. A reworded whole-line comment or a chmod must not force a
# re-notarise; a changed team, identity or notary value must. (An inline comment on a value line is
# hashed; test-cut-sign-preflight refuses one.)
_pkg_stream_assignments() {
  local f="${1:?}" body
  body="$(grep -v -E '^[[:space:]]*(#|$)' "$f" || true)"
  # All inputs or nothing: a signing identity with no values is a refusal, never a sha over less.
  [ -n "$body" ] || { echo "pkg_input_sha: $f holds no values" >&2; return 1; }
  printf '%s\n%s\n' "$f" "$(printf '%s' "$body" | wc -c | tr -d ' ')"
  printf '%s' "$body"
}
# Every non-hidden regular file under the cwd, sorted, framed.
_pkg_stream_dir() {
  find . -name '.?*' -prune -o -type f -print | LC_ALL=C sort | while IFS= read -r f; do _pkg_stream_file "$f"; done
}
# The first input that cannot be hashed as it is, among the three dirs (scripts, resources, and the release check
# when given), the build script and the signing identity, or nothing. NUL-delimited so a name with a space is one name.
# Three shapes, because "all inputs or nothing" has to hold for each:
#   a file that is not readable        cat would hash it as absent
#   a directory that is not searchable find cannot enter it, its contents
#                                      would hash as absent (measured: the
#                                      same sha as deleting the directory)
#   a symlink                          find -type f skips it, pkgbuild ships
#                                      it; the guard refuses rather than
#                                      guessing what a link is worth. None
#                                      exist today; if one is ever wanted,
#                                      decide here how to hash it.
#   a name containing a newline        this check is NUL-delimited, the
#                                      stream below is line-delimited, so
#                                      such a name would frame as two names
#                                      that do not exist and hash as absent
#                                      (measured). Refused here, by name.
# Hidden entries are pruned (not merely filtered), so a hidden tree is never
# entered: an unsearchable .dir printed find's complaint into the release log.
# A newline, held once, so the test below is a plain function call: a case
# pattern built from $(printf) inside a $( ) misparses on bash 3.2.
_PKG_NL="$(printf '\nx')"; _PKG_NL="${_PKG_NL%x}"
_pkg_has_newline() { case "$1" in *"$_PKG_NL"*) return 0;; esac; return 1; }
_pkg_first_unreadable() {
  local d f
  for d in "$1" "$2" ${5:+"$5"}; do   # #6576: the fifth argument is the release-check dir, checked like the other two
    # The ROOT itself first: cd into a mode-000 dir fails inside the
    # substitution below, which would report nothing and stream an empty
    # section (measured), the sha-over-less this function exists to refuse.
    [ -r "$d" ] && [ -x "$d" ] || { printf 'unsearchable directory %s' "$d"; return 0; }
    f="$(cd "$d" && find . -name '.?*' -prune -o \( -type f -o -type d -o -type l \) -print0 | while IFS= read -r -d '' f; do
           if _pkg_has_newline "$f"; then printf 'newline in the name of %s/%s' "$d" "${f#./}"; break; fi
           if [ -L "$f" ]; then printf 'symlink %s/%s' "$d" "${f#./}"; break; fi
           if [ -d "$f" ]; then [ -r "$f" ] && [ -x "$f" ] || { printf 'unsearchable directory %s/%s' "$d" "${f#./}"; break; }
           else [ -r "$f" ] || { printf 'unreadable %s/%s' "$d" "${f#./}"; break; }; fi
         done)"
    [ -z "$f" ] || { printf '%s' "$f"; return 0; }
  done
  [ -r "$3" ] || { printf 'unreadable %s' "$3"; return 0; }
  [ -z "${4:-}" ] || [ -r "$4" ] || printf 'unreadable %s' "$4"
  return 0
}

# A hasher that is a real command, never a string run as one.
_pkg_hash() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256; else sha256sum; fi
}

# The sidecar, Kosmos.pkg.inputs, is TWO lines and vouches for bytes, not
# only for inputs:
#   line 1   the input sha (pkg_input_sha) the pkg was built from
#   line 2   pkg:<sha256 of the Kosmos.pkg bytes>
# Without line 2 a mixed edge state (a new sidecar beside the PRIOR pkg pair,
# each self-consistent) passed every served check. With it, the sidecar names
# the bytes it describes, and any reader can bind the three files together.
pkg_sidecar_write() {   # <pkg-file> <input-sha> <sidecar-file>
  local pkg="${1:?}" insha="${2:?}" out="${3:?}"
  printf '%s\npkg:%s\n' "$insha" "$(_pkg_hash < "$pkg" | awk '{print $1}')" > "$out"
}
pkg_sidecar_inputs() { sed -n '1p' "${1:?}" | tr -d '[:space:]'; }             # <sidecar-file>
pkg_sidecar_pkgsha() { sed -n '2p' "${1:?}" | sed 's/^pkg://' | tr -d '[:space:]'; }

# Does the site's copy of the pkg need rebuilding + republishing? Prints ONE
# reason line and returns 0 (needed) or 2 (current); see the exit-code note. The decision reads the
# SITE checkout's dist (what the next deploy will serve), never the served
# host: the served host is what step 9c confirms AFTER the deploy.
#
# Six ways to need it, each named, because "rebuild" without a reason is the
# re-run-instead-of-read habit #708 is about:
#   no pkg          nothing to serve
#   no sidecar      the pkg predates the guard, its inputs are unknown
#   inputs differ   someone changed a postinstall, a screen or the build
#   no checksum     Kosmos.pkg.sha256 is missing beside the pkg
#   pair broken     Kosmos.pkg and Kosmos.pkg.sha256 disagree (the one-cache
#                   wedge shape, or a half-copied publish)
#   sidecar orphan  the sidecar vouches for different bytes than the pkg's
# ⚠️ EXIT CODES ARE THE VERDICT, and "current" is 2, not 1: bash's own errors
# (an unbound variable under set -u, a ${x:?} guard, a failing hasher) exit 1,
# and a caller that read "non-zero" as "current" would skip the publish on an
# ERROR, the fail-open direction (a reviewer measured it with a stub that
# returned 3). 0 = needed, 2 = current, anything else = could not decide.
pkg_publish_needed() {   # <site-dist> <source-input-sha> [pkg name, default Kosmos.pkg]
  local dist="${1:?pkg_publish_needed needs the site dist dir}"
  local want="${2:?pkg_publish_needed needs the source input sha}"
  local name="${3:-Kosmos.pkg}"
  local pkg="$dist/$name" side="$dist/$name.inputs" sum="$dist/$name.sha256"
  local have real pub vouch
  [ -f "$pkg" ]  || { echo "no $name in the site dist"; return 0; }
  [ -f "$side" ] || { echo "$name has no input sidecar (it predates the guard)"; return 0; }
  have="$(pkg_sidecar_inputs "$side")"
  [ "$have" = "$want" ] || { echo "the pkg's inputs (${have:0:12}) differ from source (${want:0:12})"; return 0; }
  [ -f "$sum" ] || { echo "$name has no .sha256 beside it"; return 0; }
  real="$(_pkg_hash < "$pkg" | awk '{print $1}')"
  pub="$(awk '{print $1}' < "$sum")"
  [ "$real" = "$pub" ] || { echo "$name and $name.sha256 disagree"; return 0; }
  vouch="$(pkg_sidecar_pkgsha "$side")"
  [ "$vouch" = "$real" ] || { echo "the sidecar vouches for other bytes (${vouch:0:12}) than $name's (${real:0:12})"; return 0; }
  echo "current: inputs match source (${want:0:12}), the pair agrees, the sidecar vouches for these bytes"
  return 2
}

# kosmos#8167: the pkg name follows the channel, as /setup does (#5032). The public Download button
# links /dist/Kosmos.pkg, so only a PROD cut or a promote may write it. A staging cut writes
# Kosmos-staging.pkg. Both names hold the same build: same bytes, signature and notarisation.
PKG_PROD_NAME="Kosmos.pkg"
PKG_STAGING_NAME="Kosmos-staging.pkg"
PKG_ALL_NAMES="$PKG_PROD_NAME $PKG_STAGING_NAME"

# The names a cut on <channel> publishes. A prod cut writes both, so staging is never older than prod.
pkg_names_for_channel() {   # <staging|prod>
  case "${1:?pkg_names_for_channel needs the channel}" in
    staging) printf '%s\n' "$PKG_STAGING_NAME" ;;
    prod) printf '%s\n%s\n' "$PKG_PROD_NAME" "$PKG_STAGING_NAME" ;;
    *) echo "pkg_names_for_channel: unknown channel '$1'" >&2; return 1 ;;
  esac
}

# Is <dir>/<name> a whole, self-consistent triple? Prints the pkg's sha256 and returns 0, or names
# what is wrong on stderr and returns 1. Used before a copy, and by promote before its first write.
pkg_triple_check() {   # <dir> <name>
  local d="${1:?}" n="${2:?}" f real pub vouch
  for f in "$n" "$n.sha256" "$n.inputs"; do
    [ -f "$d/$f" ] || { echo "$d/$f is missing; a pkg triple is whole or not at all" >&2; return 1; }
  done
  real="$(_pkg_hash < "$d/$n" | awk '{print $1}')"
  pub="$(awk '{print $1}' < "$d/$n.sha256")"
  vouch="$(pkg_sidecar_pkgsha "$d/$n.inputs")"
  [ -n "$real" ] && [ "$real" = "$pub" ] || { echo "$n and $n.sha256 disagree (${real:0:12} vs ${pub:0:12})" >&2; return 1; }
  [ "$vouch" = "$real" ] || { echo "$n.inputs vouches for other bytes (${vouch:0:12}) than $n's (${real:0:12})" >&2; return 1; }
  printf '%s\n' "$real"
}

# Copy a pkg triple from <src-dir>/<src-name> to <dst-dir>/<dst-name>. The .inputs sidecar is copied
# as it is: it names input and byte shas, not a file name. The .sha256 is WRITTEN under the destination
# name, so `shasum -c` and the served "names the file it describes" check hold for each name. Refused
# (returns 1) unless pkg_triple_check passes on the source and the copied bytes hash the same. The files
# are staged in a temp dir in <dst-dir>, so a refusal before the final moves leaves the destination as it
# was. The three moves are separate renames: a failure between them can leave a new .inputs or .sha256
# beside the old pkg, which the next pkg_publish_needed or pkg_triple_check reports as broken.
pkg_triple_copy() {   # <src-dir> <src-name> <dst-dir> <dst-name>
  local sd="${1:?}" sn="${2:?}" dd="${3:?}" dn="${4:?}" real got t
  real="$(pkg_triple_check "$sd" "$sn")" || { echo "pkg_triple_copy: not copying $sd/$sn (above)" >&2; return 1; }
  find "$dd" -maxdepth 1 -type d -name '.pkgcopy.*' -mmin +10 -exec rm -rf {} + 2>/dev/null   # a copy killed 10+ min ago
  t="$(mktemp -d "$dd/.pkgcopy.XXXXXX")" || { echo "pkg_triple_copy: cannot make a temp dir in $dd" >&2; return 1; }
  cp "$sd/$sn" "$t/pkg" && cp "$sd/$sn.inputs" "$t/inputs" && printf '%s  %s\n' "$real" "$dn" > "$t/sha256" \
    || { rm -rf "$t"; echo "pkg_triple_copy: copying into $dd failed" >&2; return 1; }
  got="$(_pkg_hash < "$t/pkg" | awk '{print $1}')"
  [ "$got" = "$real" ] || { rm -rf "$t"; echo "pkg_triple_copy: the copied bytes (${got:0:12}) are not the source's (${real:0:12})" >&2; return 1; }
  mv "$t/inputs" "$dd/$dn.inputs" && mv "$t/sha256" "$dd/$dn.sha256" && mv "$t/pkg" "$dd/$dn" \
    || { rm -rf "$t"; echo "pkg_triple_copy: moving the triple into place in $dd failed" >&2; return 1; }
  rm -rf "$t"
  return 0
}

# Does a gitignore-style upload filter (Vercel's .vercelignore) let the pkg
# triple through? Evaluated by git itself on a scratch repo with the filter
# as its .gitignore, because a grep for four spellings is a spot check that
# also passes on a MISSING file, and a missing .vercelignore makes Vercel fall
# back to the site's .gitignore, which excludes dist/*.pkg.
# Prints the first excluded path, or nothing. Returns 0 = evaluated, 1 = the
# filter file does not exist, 3 = could not evaluate (a caller must refuse on
# 3, not read "nothing printed" as "carries": a stub git that exits 128
# printed nothing and passed, measured).
# ⚠️ ISOLATED FROM THE OPERATOR'S GIT: a global core.excludesFile with *.pkg
# in it made a clean filter read as excluding (measured on this Mac, whose
# ~/.gitignore_global participates in check-ignore). Only the filter's own
# patterns are evaluated: no global or system config, no init template.
pkg_upload_filter_excludes() {   # <filter-file>
  local filter="${1:?}" t out rc
  [ -f "$filter" ] || return 1
  t="$(mktemp -d "${TMPDIR:-/tmp}/pkg-upload-filter.XXXXXX")" || return 3
  # ⚠️ NO COMMENTS INSIDE THE SUBSTITUTION BELOW: bash 3.2 does not skip
  # quotes inside a comment inside $( ), so an apostrophe there is an EOF
  # error, and a bare 0) pattern there is a syntax error (hence the (0) form).
  # And "check-ignore && rc=0 || rc=$?", because its 1 (not ignored) would
  # otherwise trip the subshell's errexit and read as "could not evaluate".
  out="$(
    set -e
    cd "$t"
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_NOSYSTEM=1 HOME="$t" XDG_CONFIG_HOME="$t"
    git init -q --template= . >/dev/null
    cp "$filter" .gitignore
    mkdir -p dist
    : > dist/Kosmos.pkg; : > dist/Kosmos.pkg.sha256; : > dist/Kosmos.pkg.inputs
    : > dist/Kosmos-staging.pkg; : > dist/Kosmos-staging.pkg.sha256; : > dist/Kosmos-staging.pkg.inputs
    for f in dist/Kosmos.pkg dist/Kosmos.pkg.sha256 dist/Kosmos.pkg.inputs \
             dist/Kosmos-staging.pkg dist/Kosmos-staging.pkg.sha256 dist/Kosmos-staging.pkg.inputs; do
      git check-ignore -q "$f" && rc=0 || rc=$?
      case "$rc" in (0) printf '%s' "$f"; exit 0;; (1) ;; (*) exit 3;; esac
    done
    exit 0
  )"; rc=$?
  rm -rf "$t"
  [ "$rc" = 0 ] || return 3
  printf '%s' "$out"
  return 0
}
