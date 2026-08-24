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
printf '#!/bin/sh\necho hello\n' > "$T/install/pkg-scripts/postinstall"
printf '<p>welcome</p>\n' > "$T/install/pkg-resources/welcome.html"
printf '<p>done</p>\n' > "$T/install/pkg-resources/conclusion.html"
printf '#!/bin/bash\n# build\n' > "$T/tools/build-installer-pkg.sh"

a="$(pkg_input_sha "$T")"
[ -n "$a" ] && ok "computes an input sha" || bad "no sha computed"
b="$(pkg_input_sha "$T")"
[ "$a" = "$b" ] && ok "deterministic: same inputs give the same sha" || bad "non-deterministic ($a != $b)"

# CONTROL: change the postinstall, the sha MUST change (a stale pkg is caught).
printf '#!/bin/sh\necho hello world\n' > "$T/install/pkg-scripts/postinstall"
c="$(pkg_input_sha "$T")"
[ "$c" != "$a" ] && ok "CONTROL: editing the postinstall changes the sha (divergence is detectable)" || bad "editing the postinstall did NOT change the sha -- the guard is blind"

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
h1="$(pkg_input_sha "$T")"; mv "$T/install/pkg-resources/welcome.html" "$T/install/pkg-scripts/welcome.html"
h2="$(pkg_input_sha "$T")"; mv "$T/install/pkg-scripts/welcome.html" "$T/install/pkg-resources/welcome.html"
[ "$h1" != "$h2" ] && ok "a file moving between sections changes the sha" || bad "a file moved between sections was not seen"
[ "$(pkg_input_sha "$T")" = "$h1" ] && ok "and moving it back restores the sha (determinism across sections)" || bad "sha did not restore after moving the file back"

# CONTROLS THE OTHER WAY: things that are NOT inputs must leave the sha alone,
# or the release rebuilds + notarises every cut from a fresh worktree. An
# mtime-based hasher passes every edit control above and fails these.
base="$(pkg_input_sha "$T")"
touch "$T/install/pkg-scripts/postinstall" "$T/install/pkg-resources/conclusion.html" "$T/tools/build-installer-pkg.sh"
[ "$(pkg_input_sha "$T")" = "$base" ] && ok "CONTROL: touching every input (mtime only) leaves the sha alone" || bad "an mtime change moved the sha -- the hasher reads stat, not bytes"
printf '{"version":"9.9.9"}\n' > "$T/package.json"
[ "$(pkg_input_sha "$T")" = "$base" ] && ok "CONTROL: the version (package.json) is not an input" || bad "package.json moved the sha"
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

# The publish decision release.sh step 5b makes, every arm named.
D="$(mktemp -d "${TMPDIR:-/tmp}/pkg-publish.XXXXXX")"; want="$(pkg_input_sha "$T")"
why="$(pkg_publish_needed "$D" "$want")" && case "$why" in *"no Kosmos.pkg"*) ok "publish: no pkg in the site dist -> needed ($why)";; *) bad "no-pkg reason wrong: $why";; esac || bad "no pkg was judged current"
printf 'PKGBYTES\n' > "$D/Kosmos.pkg"
why="$(pkg_publish_needed "$D" "$want")" && case "$why" in *"no input sidecar"*) ok "publish: pkg without a sidecar -> needed ($why)";; *) bad "no-sidecar reason wrong: $why";; esac || bad "a pkg with no sidecar was judged current"
printf 'deadbeef\n' > "$D/Kosmos.pkg.inputs"
why="$(pkg_publish_needed "$D" "$want")" && case "$why" in *"differ from source"*) ok "publish: inputs differ -> needed ($why)";; *) bad "differ reason wrong: $why";; esac || bad "differing inputs were judged current"
pkg_sidecar_write "$D/Kosmos.pkg" "$want" "$D/Kosmos.pkg.inputs"
[ "$(pkg_sidecar_inputs "$D/Kosmos.pkg.inputs")" = "$want" ] && ok "sidecar: line 1 reads back the input sha" || bad "sidecar line 1 wrong"
[ "$(pkg_sidecar_pkgsha "$D/Kosmos.pkg.inputs")" = "$(shasum -a 256 "$D/Kosmos.pkg" | awk '{print $1}')" ] && ok "sidecar: line 2 names the pkg's own bytes" || bad "sidecar line 2 wrong"
why="$(pkg_publish_needed "$D" "$want")" && case "$why" in *"no .sha256"*) ok "publish: no checksum beside the pkg -> needed ($why)";; *) bad "no-sha256 reason wrong: $why";; esac || bad "a pkg with no checksum was judged current"
printf '%s  Kosmos.pkg\n' "0000000000000000000000000000000000000000000000000000000000000000" > "$D/Kosmos.pkg.sha256"
why="$(pkg_publish_needed "$D" "$want")" && case "$why" in *"disagree"*) ok "publish: pkg and checksum disagree -> needed ($why)";; *) bad "disagree reason wrong: $why";; esac || bad "a broken pair was judged current"
( cd "$D" && shasum -a 256 Kosmos.pkg > Kosmos.pkg.sha256 )
if why="$(pkg_publish_needed "$D" "$want")"; then bad "CONTROL: a current pair was judged as needing a publish ($why)"; else ok "CONTROL: a current triple (inputs match, checksum agrees, sidecar vouches) -> not needed ($why)"; fi
# the mixed state: a sidecar that vouches for OTHER bytes beside a self-consistent pair.
printf 'OTHERBYTES\n' > "$D/other.pkg"; pkg_sidecar_write "$D/other.pkg" "$want" "$D/Kosmos.pkg.inputs"; rm -f "$D/other.pkg"
why="$(pkg_publish_needed "$D" "$want")" && case "$why" in *"vouches for other bytes"*) ok "publish: a sidecar for other bytes beside a good pair -> needed ($why)";; *) bad "orphan-sidecar reason wrong: $why";; esac || bad "an orphan sidecar was judged current"
pkg_sidecar_write "$D/Kosmos.pkg" "$want" "$D/Kosmos.pkg.inputs"
# and the control's control: touch one input in source, the current pair is stale again.
printf '#!/bin/sh\necho changed again\n' > "$T/install/pkg-scripts/postinstall"; want2="$(pkg_input_sha "$T")"
if pkg_publish_needed "$D" "$want2" >/dev/null; then ok "CONTROL: after a source edit the same pair is stale again"; else bad "a source edit did not make the pair stale"; fi
rm -rf "$D"

echo "pkg-input-guard: $FAILS failures"; [ "$FAILS" -eq 0 ]
