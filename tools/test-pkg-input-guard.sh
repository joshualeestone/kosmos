#!/bin/bash
# The pkg-input freshness guard, with its control: prove the input sha CHANGES
# when the postinstall changes, so a stale served pkg would be caught (#638).
# A guard shipped without a control is the defect this whole day was about.
set -u
cd "$(dirname "$0")/.." || exit 1
. tools/lib/pkg-inputs.sh
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/pkg-input-guard.XXXXXX")"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/install/pkg-scripts" "$T/install/pkg-resources" "$T/tools"
printf '#!/bin/sh\necho hello\n' > "$T/install/pkg-scripts/postinstall"; chmod +x "$T/install/pkg-scripts/postinstall"
printf '<p>welcome</p>\n' > "$T/install/pkg-resources/welcome.html"
printf '<p>done</p>\n' > "$T/install/pkg-resources/conclusion.html"
printf '#!/bin/bash\n# build\n' > "$T/tools/build-installer-pkg.sh"

a="$(pkg_input_sha "$T")"
[ -n "$a" ] && ok "computes an input sha" || bad "no sha computed"
b="$(pkg_input_sha "$T")"
[ "$a" = "$b" ] && ok "deterministic: same inputs give the same sha" || bad "non-deterministic ($a != $b)"
# 🛑 THE SAME INPUTS AT A DIFFERENT ROOT give the same sha. The release hashes
# a fresh mktemp worktree every cut and verify-served hashes the shared
# checkout; a sha that depended on the root (the first version framed the
# build script by its absolute path) made every cut rebuild and every
# verify read stale, and this file could not see it because every control
# shared one root.
T2R="$(mktemp -d "${TMPDIR:-/tmp}/pkg-input-guard-root2.XXXXXX")"; cp -R "$T/." "$T2R/"
[ "$(pkg_input_sha "$T2R")" = "$a" ] && ok "CONTROL: the same inputs at a second root give the same sha (root-independent)" || bad "the sha depends on the repo root ($a vs $(pkg_input_sha "$T2R")) -- every cut would rebuild and verify-served would read stale"
rm -rf "$T2R"

# CONTROL: change the postinstall, the sha MUST change (a stale pkg is caught).
printf '#!/bin/sh\necho hello world\n' > "$T/install/pkg-scripts/postinstall"
c="$(pkg_input_sha "$T")"
[ "$c" != "$a" ] && ok "CONTROL: editing the postinstall changes the sha (divergence is detectable)" || bad "editing the postinstall did NOT change the sha -- the guard is blind"

# CONTROL AGAINST A LENGTH-ONLY HASHER: every edit above changes a file's
# length, so a hasher reading path + byte count passed the whole suite
# (measured by a reviewer with a wc -c stand-in). Same length, different
# bytes, the sha MUST move: a flipped flag in the postinstall is this shape.
printf '#!/bin/sh\necho hello WORLD\n' > "$T/install/pkg-scripts/postinstall"
c2="$(pkg_input_sha "$T")"
[ "$c2" != "$c" ] && ok "CONTROL: a same-length edit (bytes, not length) changes the sha" || bad "a same-length edit did NOT change the sha -- the hasher reads length, not bytes"
printf '#!/bin/sh\necho hello world\n' > "$T/install/pkg-scripts/postinstall"
# a NEW pkg-scripts file also changes the sha (an added script is an input).
printf 'x\n' > "$T/install/pkg-scripts/preinstall"
d="$(pkg_input_sha "$T")"
[ "$d" != "$c" ] && ok "adding a pkg-scripts file changes the sha" || bad "a new pkg-scripts file was not seen"

# CONTROLS for the inputs added in #665: the screens and the build script are
# inputs too (Baron's first pkg carried new screens the first guard could not
# see). Each edit MUST change the sha.
printf '<p>done, differently</p>\n' > "$T/install/pkg-resources/conclusion.html"
e="$(pkg_input_sha "$T")"
[ "$e" != "$d" ] && ok "CONTROL: editing the Conclusion screen changes the sha" || bad "editing conclusion.html did NOT change the sha -- the guard is blind to the screens"
printf '<p>hello</p>\n' > "$T/install/pkg-resources/welcome.html"
f="$(pkg_input_sha "$T")"
[ "$f" != "$e" ] && ok "CONTROL: editing the Welcome screen changes the sha" || bad "editing welcome.html did NOT change the sha"
printf '#!/bin/bash\n# build, with a changed distribution template\n' > "$T/tools/build-installer-pkg.sh"
g="$(pkg_input_sha "$T")"
[ "$g" != "$f" ] && ok "CONTROL: editing the build script (the distribution template lives in it) changes the sha" || bad "editing build-installer-pkg.sh did NOT change the sha"
# moving bytes between sections is a change too (a screen is not a script).
# ⚠️ A FIXTURE WHERE THE MOVE IS ORDER-NEUTRAL, or the control cannot fail:
# with scripts {a} and resources {c}, the file b moved between them produces
# the same sorted stream a,b,c either way, and the same path line, so only
# the section labels can tell the two apart. (Two earlier versions of this
# control passed on a sectionless hasher, measured by mutation: one changed
# the order, one changed the name.)
T2="$(mktemp -d "${TMPDIR:-/tmp}/pkg-input-guard-sec.XXXXXX")"
mkdir -p "$T2/install/pkg-scripts" "$T2/install/pkg-resources" "$T2/tools"
printf 'A\n' > "$T2/install/pkg-scripts/a"; printf 'C\n' > "$T2/install/pkg-resources/c"; printf 'B\n' > "$T2/tools/build-installer-pkg.sh"
printf 'B\n' > "$T2/install/pkg-resources/b"
h1="$(pkg_input_sha "$T2")"
mv "$T2/install/pkg-resources/b" "$T2/install/pkg-scripts/b"
h2="$(pkg_input_sha "$T2")"
[ "$h1" != "$h2" ] && ok "a file moving between sections changes the sha (order-neutral move)" || bad "a file moved between sections was not seen -- the section labels are not doing their job"
mv "$T2/install/pkg-scripts/b" "$T2/install/pkg-resources/b"
[ "$(pkg_input_sha "$T2")" = "$h1" ] && ok "and moving it back restores the sha (determinism across sections)" || bad "sha did not restore after moving the file back"
rm -rf "$T2"

# CONTROLS THE OTHER WAY: things that are NOT inputs must leave the sha alone,
# or the release rebuilds + notarises every cut from a fresh worktree. An
# mtime-based hasher passes every edit control above and fails these.
base="$(pkg_input_sha "$T")"
touch "$T/install/pkg-scripts/postinstall" "$T/install/pkg-resources/conclusion.html" "$T/tools/build-installer-pkg.sh"
[ "$(pkg_input_sha "$T")" = "$base" ] && ok "CONTROL: touching every input (mtime only) leaves the sha alone" || bad "an mtime change moved the sha -- the hasher reads stat, not bytes"
printf '{"version":"9.9.9"}\n' > "$T/package.json"
[ "$(pkg_input_sha "$T")" = "$base" ] && ok "CONTROL: the version (package.json) is not an input" || bad "package.json moved the sha"
# the executable bit IS an input: a postinstall without x is a pkg that runs nothing.
chmod -x "$T/install/pkg-scripts/postinstall"
[ "$(pkg_input_sha "$T")" != "$base" ] && ok "CONTROL: dropping the postinstall's x bit changes the sha" || bad "chmod -x on the postinstall left the sha alone -- a pkg that runs nothing reads as current"
chmod +x "$T/install/pkg-scripts/postinstall"; base="$(pkg_input_sha "$T")"
printf 'junk\n' > "$T/install/pkg-resources/.DS_Store"
[ "$(pkg_input_sha "$T")" = "$base" ] && ok "CONTROL: a dotfile in an input dir (.DS_Store) is not an input" || bad "a dotfile moved the sha -- the shared checkout would read stale"
rm -f "$T/install/pkg-resources/.DS_Store"

# missing pkg-scripts dir refuses rather than emitting an empty sha.
if pkg_input_sha "$T/nope" >/dev/null 2>&1; then bad "a missing pkg-scripts dir did not refuse"; else ok "a missing pkg-scripts dir refuses, not a blank sha"; fi
# ALL inputs or nothing: a repo with scripts but no screens, or no build script, refuses.
U="$(mktemp -d "${TMPDIR:-/tmp}/pkg-input-guard-u.XXXXXX")"; mkdir -p "$U/install/pkg-scripts" "$U/tools"; printf 'x\n' > "$U/install/pkg-scripts/postinstall"; printf 'x\n' > "$U/tools/build-installer-pkg.sh"
if pkg_input_sha "$U" >/dev/null 2>&1; then bad "a missing pkg-resources dir did not refuse"; else ok "a missing pkg-resources dir refuses, not a sha over less"; fi
mkdir -p "$U/install/pkg-resources"; rm "$U/tools/build-installer-pkg.sh"
if pkg_input_sha "$U" >/dev/null 2>&1; then bad "a missing build script did not refuse"; else ok "a missing build script refuses, not a sha over less"; fi
rm -rf "$U"

# The publish decision release.sh step 3c makes, every arm named, and the
# verdict is the EXIT CODE: 0 needed, 2 current, anything else an error.
D="$(mktemp -d "${TMPDIR:-/tmp}/pkg-publish.XXXXXX")"; want="$(pkg_input_sha "$T")"
why="$(pkg_publish_needed "$D" "$want")" && case "$why" in *"no Kosmos.pkg"*) ok "publish: no pkg in the site dist -> needed ($why)";; *) bad "no-pkg reason wrong: $why";; esac || { rc=$?; [ "$rc" = 2 ] && bad "no pkg was judged current" || bad "no pkg was judged current (rc $rc: an error, not a verdict)"; }
printf 'PKGBYTES\n' > "$D/Kosmos.pkg"
why="$(pkg_publish_needed "$D" "$want")" && case "$why" in *"no input sidecar"*) ok "publish: pkg without a sidecar -> needed ($why)";; *) bad "no-sidecar reason wrong: $why";; esac || { rc=$?; [ "$rc" = 2 ] && bad "a pkg with no sidecar was judged current" || bad "a pkg with no sidecar was judged current (rc $rc: an error, not a verdict)"; }
printf 'deadbeef\n' > "$D/Kosmos.pkg.inputs"
why="$(pkg_publish_needed "$D" "$want")" && case "$why" in *"differ from source"*) ok "publish: inputs differ -> needed ($why)";; *) bad "differ reason wrong: $why";; esac || { rc=$?; [ "$rc" = 2 ] && bad "differing inputs were judged current" || bad "differing inputs were judged current (rc $rc: an error, not a verdict)"; }
pkg_sidecar_write "$D/Kosmos.pkg" "$want" "$D/Kosmos.pkg.inputs"
[ "$(pkg_sidecar_inputs "$D/Kosmos.pkg.inputs")" = "$want" ] && ok "sidecar: line 1 reads back the input sha" || bad "sidecar line 1 wrong"
[ "$(pkg_sidecar_pkgsha "$D/Kosmos.pkg.inputs")" = "$(_pkg_hash < "$D/Kosmos.pkg" | awk '{print $1}')" ] && ok "sidecar: line 2 names the pkg's own bytes" || bad "sidecar line 2 wrong"
why="$(pkg_publish_needed "$D" "$want")" && case "$why" in *"no .sha256"*) ok "publish: no checksum beside the pkg -> needed ($why)";; *) bad "no-sha256 reason wrong: $why";; esac || { rc=$?; [ "$rc" = 2 ] && bad "a pkg with no checksum was judged current" || bad "a pkg with no checksum was judged current (rc $rc: an error, not a verdict)"; }
printf '%s  Kosmos.pkg\n' "0000000000000000000000000000000000000000000000000000000000000000" > "$D/Kosmos.pkg.sha256"
why="$(pkg_publish_needed "$D" "$want")" && case "$why" in *"disagree"*) ok "publish: pkg and checksum disagree -> needed ($why)";; *) bad "disagree reason wrong: $why";; esac || { rc=$?; [ "$rc" = 2 ] && bad "a broken pair was judged current" || bad "a broken pair was judged current (rc $rc: an error, not a verdict)"; }
( cd "$D" && _pkg_hash < Kosmos.pkg | awk '{print $1"  Kosmos.pkg"}' > Kosmos.pkg.sha256 )
why="$(pkg_publish_needed "$D" "$want")"; rc=$?
if [ "$rc" = 2 ] && case "$why" in current:*) true;; *) false;; esac; then ok "CONTROL: a current triple (inputs match, checksum agrees, sidecar vouches) -> rc 2 and a current: reason ($why)"
else bad "CONTROL: a current triple did not come back as rc 2 + current: (rc=$rc, $why)"; fi
# and an ERROR is neither: a missing argument must not read as current (rc 1 != 2).
( pkg_publish_needed "$D" >/dev/null 2>&1 ); rc=$?
[ "$rc" != 0 ] && [ "$rc" != 2 ] && ok "an error (missing argument) is rc $rc, neither needed nor current" || bad "an error came back as a verdict (rc=$rc)"
# the mixed state: a sidecar that vouches for OTHER bytes beside a self-consistent pair.
printf 'OTHERBYTES\n' > "$D/other.pkg"; pkg_sidecar_write "$D/other.pkg" "$want" "$D/Kosmos.pkg.inputs"; rm -f "$D/other.pkg"
why="$(pkg_publish_needed "$D" "$want")" && case "$why" in *"vouches for other bytes"*) ok "publish: a sidecar for other bytes beside a good pair -> needed ($why)";; *) bad "orphan-sidecar reason wrong: $why";; esac || { rc=$?; [ "$rc" = 2 ] && bad "an orphan sidecar was judged current" || bad "an orphan sidecar was judged current (rc $rc: an error, not a verdict)"; }
pkg_sidecar_write "$D/Kosmos.pkg" "$want" "$D/Kosmos.pkg.inputs"
# and the control's control: touch one input in source, the current pair is stale again.
printf '#!/bin/sh\necho changed again\n' > "$T/install/pkg-scripts/postinstall"; want2="$(pkg_input_sha "$T")"
if pkg_publish_needed "$D" "$want2" >/dev/null; then ok "CONTROL: after a source edit the same pair is stale again"; else bad "a source edit did not make the pair stale"; fi
rm -rf "$D"

# a name with a space is one input, checked and hashed as one.
mkdir -p "$T/install/pkg-resources"; printf 'logo\n' > "$T/install/pkg-resources/welcome logo.txt"
sp="$(pkg_input_sha "$T")" && [ -n "$sp" ] && ok "an input named with a space is hashed, not split" || bad "a name with a space broke the hash"
chmod -r "$T/install/pkg-resources/welcome logo.txt"
if pkg_input_sha "$T" >/dev/null 2>"$T/err"; then bad "an unreadable input (with a space) did not refuse"; else grep -q "welcome logo.txt" "$T/err" && ok "an unreadable input refuses and names the real file, space and all" || bad "the refusal misnamed the file: $(cat "$T/err")"; fi
chmod +r "$T/install/pkg-resources/welcome logo.txt"; rm -f "$T/install/pkg-resources/welcome logo.txt"

# an unsearchable directory or a symlink among the inputs refuses (measured before
# this control existed: chmod 000 on a subdir gave the same sha as deleting it).
mkdir -p "$T/install/pkg-resources/sub"; printf 'deep\n' > "$T/install/pkg-resources/sub/x"
withsub="$(pkg_input_sha "$T")"; chmod 000 "$T/install/pkg-resources/sub"
if pkg_input_sha "$T" >/dev/null 2>"$T/err"; then bad "an unsearchable input directory did not refuse"; else grep -q "unsearchable directory" "$T/err" && ok "an unsearchable input directory refuses and says so" || bad "the refusal did not name the directory: $(cat "$T/err")"; fi
chmod 755 "$T/install/pkg-resources/sub"
[ "$(pkg_input_sha "$T")" = "$withsub" ] && ok "and restoring the directory restores the sha" || bad "sha changed after restoring the directory"
rm -rf "$T/install/pkg-resources/sub"
# the ROOT itself unsearchable (cd fails inside the check) must refuse too, never stream an empty section.
chmod 000 "$T/install/pkg-resources"
if pkg_input_sha "$T" >/dev/null 2>"$T/err"; then bad "an unsearchable input ROOT did not refuse (an empty section was hashed)"; else grep -q "unsearchable directory" "$T/err" && ok "an unsearchable input root refuses and says so" || bad "the refusal did not name the root: $(cat "$T/err")"; fi
chmod 755 "$T/install/pkg-resources"
ln -s welcome.html "$T/install/pkg-resources/link.html"
if pkg_input_sha "$T" >/dev/null 2>"$T/err"; then bad "a symlinked input did not refuse (it would hash as absent)"; else grep -q "symlink" "$T/err" && ok "a symlink among the inputs refuses and says so" || bad "the refusal did not name the symlink: $(cat "$T/err")"; fi
rm -f "$T/install/pkg-resources/link.html"

# the upload filter, evaluated by git, not grepped.
F="$(mktemp -d "${TMPDIR:-/tmp}/pkg-filter.XXXXXX")"
printf 'docs/\ntools/\n' > "$F/ok"
out="$(pkg_upload_filter_excludes "$F/ok")"; rc=$?
[ "$rc" = 0 ] && [ -z "$out" ] && ok "filter: a .vercelignore that names no dist files lets the triple through (rc 0, nothing excluded)" || bad "a clean filter came back rc $rc '$out'"
for line in 'dist/*.pkg' '*.pkg' '**/*.pkg' 'dist/**' 'dist/Kosmos.pkg' 'Kosmos.pkg' 'dist/*.pkg.inputs'; do
  printf 'docs/\n%s\n' "$line" > "$F/bad"
  [ -n "$(pkg_upload_filter_excludes "$F/bad")" ] && ok "filter: '$line' is seen to drop part of the triple" || bad "filter: '$line' was NOT seen to exclude"
done
pkg_upload_filter_excludes "$F/missing" >/dev/null; rc=$?
[ "$rc" = 1 ] && ok "filter: a missing .vercelignore is rc 1, refused, not passed" || bad "a MISSING filter file came back rc $rc"
# fail CLOSED when git itself cannot evaluate: a git that exits 128 must be rc 3, never "carries".
mkdir -p "$F/bin"; printf '#!/bin/sh\nexit 128\n' > "$F/bin/git"; chmod +x "$F/bin/git"
out="$(PATH="$F/bin:$PATH" pkg_upload_filter_excludes "$F/ok")"; rc=$?
[ "$rc" = 3 ] && ok "filter: a broken git is rc 3 (could not evaluate), not a pass" || bad "a broken git came back rc $rc with '$out' -- the evaluator fails open"
# isolated from the operator's git: a global excludes file matching *.pkg must not leak in.
printf '*.pkg\n' > "$F/global-ignore"; printf '[core]\n\texcludesFile = %s\n' "$F/global-ignore" > "$F/gitconfig"
out="$(GIT_CONFIG_GLOBAL="$F/gitconfig" HOME="$F" pkg_upload_filter_excludes "$F/ok")"; rc=$?
[ "$rc" = 0 ] && [ -z "$out" ] && ok "filter: a global core.excludesFile with *.pkg does not leak into the evaluation" || bad "the operator's global gitignore leaked in (rc=$rc, '$out')"
# the control's control: the same global file DOES exclude when git is not isolated.
G="$(mktemp -d "${TMPDIR:-/tmp}/pkg-filter-ctl.XXXXXX")"; ( cd "$G" && GIT_CONFIG_GLOBAL="$F/gitconfig" HOME="$F" git init -q . && mkdir dist && : > dist/Kosmos.pkg && GIT_CONFIG_GLOBAL="$F/gitconfig" HOME="$F" git check-ignore -q dist/Kosmos.pkg ) && ok "CONTROL: without isolation that global file really excludes dist/Kosmos.pkg" || bad "CONTROL: the global excludes file did not exclude even unisolated, so the isolation assert proves nothing"
rm -rf "$G" "$F"

echo "pkg-input-guard: $FAILS failures"; [ "$FAILS" -eq 0 ]
