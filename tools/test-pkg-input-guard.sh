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

# the compare semantics release.sh uses: equal passes, differ/absent red.
served="$c"; want="$c"; [ "$served" = "$want" ] && ok "compare: matching served and source pass" || bad "matching compare failed"
served="$a"; want="$c"; [ "$served" != "$want" ] && ok "compare: a stale served sha differs from source (release reds)" || bad "stale compare not caught"
served="";  [ -z "$served" ] && ok "compare: an absent sidecar is empty (release reds)" || bad "absent sidecar not caught"

# missing pkg-scripts dir refuses rather than emitting an empty sha.
if pkg_input_sha "$T/nope" >/dev/null 2>&1; then bad "a missing pkg-scripts dir did not refuse"; else ok "a missing pkg-scripts dir refuses, not a blank sha"; fi
# ALL inputs or nothing: a repo with scripts but no screens, or no build script, refuses.
U="$(mktemp -d "${TMPDIR:-/tmp}/pkg-input-guard-u.XXXXXX")"; mkdir -p "$U/install/pkg-scripts" "$U/tools"; printf 'x\n' > "$U/install/pkg-scripts/postinstall"; printf 'x\n' > "$U/tools/build-installer-pkg.sh"
if pkg_input_sha "$U" >/dev/null 2>&1; then bad "a missing pkg-resources dir did not refuse"; else ok "a missing pkg-resources dir refuses, not a sha over less"; fi
mkdir -p "$U/install/pkg-resources"; rm "$U/tools/build-installer-pkg.sh"
if pkg_input_sha "$U" >/dev/null 2>&1; then bad "a missing build script did not refuse"; else ok "a missing build script refuses, not a sha over less"; fi
rm -rf "$U"

echo "pkg-input-guard: $FAILS failures"; [ "$FAILS" -eq 0 ]
