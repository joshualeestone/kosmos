#!/usr/bin/env bash
# test-linux-check-runs-7942.sh -- kosmos#7942. Unit-tests tools/linux-check-runs.sh against a fake gh that answers
# from fixture files (no network): what counts as "both Linux check runs green for this exact build".
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/linux-check-runs-7942.XXXXXX")"; trap 'rm -rf "$T"' EXIT
PASS=0; FAIL=0
chk() { local d="$1"; shift; if "$@"; then PASS=$((PASS+1)); echo "PASS  $d"; else FAIL=$((FAIL+1)); echo "FAIL  $d"; fi; }
V=9.9.9; SHA="$(printf 'build' | shasum -a 256 | awk '{print $1}')"; OTHER="$(printf 'other' | shasum -a 256 | awk '{print $1}')"
FX="$T/fx"; mkdir -p "$FX"
# The fake gh: `gh api <path> --jq <expr>` prints what the fixture for that path holds (the jq result itself).
# artifacts?name=<n>  -> $FX/art-<n> (one run id per line; absent = no artifact)  | $FX/art-down makes it fail
# runs/<id>           -> $FX/run-<id> ("<conclusion> <branch> <path>")            | $FX/run-down makes it fail
cat > "$T/gh" <<FAKE
#!/usr/bin/env bash
[ "\$1" = api ] || exit 9
case "\$2" in
  *"/actions/artifacts?name="*) [ ! -e "$FX/art-down" ] || exit 1; n="\${2#*name=}"; n="\${n%%&*}"; cat "$FX/art-\$n" 2>/dev/null; exit 0 ;;
  *"/actions/runs/"*) [ ! -e "$FX/run-down" ] || exit 1; cat "$FX/run-\${2##*/}" 2>/dev/null || exit 1; exit 0 ;;
esac
exit 9
FAKE
chmod +x "$T/gh"
run() { KOSMOS_GH="$T/gh" KOSMOS_GH_REPO=o/r bash "$HERE/tools/linux-check-runs.sh" "$@" > "$T/out" 2>&1; echo $?; }
reset() { rm -f "$FX"/*; }
green() {  # <prefix> <file> <run id>: an artifact for the exact build from a successful main run of that workflow
  echo "$3" > "$FX/art-$1-$V-$SHA"; echo "success main .github/workflows/$2" > "$FX/run-$3"
}

reset; green linux-family-install linux-family-install-7281.yml 11; green linux-promote-check linux-promote-check-7933.yml 22
chk "CONTROL: both runs green for the exact build -> 0" [ "$(run "$V" "$SHA")" = 0 ]
chk "and it names both runs" grep -q 'linux-family-install-7281.yml run 11' "$T/out"
chk "  (the second too)" grep -q 'linux-promote-check-7933.yml run 22' "$T/out"

reset; green linux-family-install linux-family-install-7281.yml 11
chk "the check run missing -> 1" [ "$(run "$V" "$SHA")" = 1 ]
chk "naming what is missing" grep -q 'no green run of linux-promote-check-7933.yml has checked 9.9.9' "$T/out"
chk "and the command that runs it" grep -qF 'gh workflow run linux-promote-check-7933.yml --repo o/r' "$T/out"
chk "but not the one that was green" bash -c "! grep -qF 'gh workflow run linux-family-install-7281.yml' '$T/out'"

reset; green linux-family-install linux-family-install-7281.yml 11; green linux-promote-check linux-promote-check-7933.yml 22
mv "$FX/art-linux-promote-check-$V-$SHA" "$FX/art-linux-promote-check-$V-$OTHER"
chk "green runs of ANOTHER build of the same version do not count -> 1" [ "$(run "$V" "$SHA")" = 1 ]

reset; green linux-family-install linux-family-install-7281.yml 11; green linux-promote-check linux-promote-check-7933.yml 22
echo "failure main .github/workflows/linux-promote-check-7933.yml" > "$FX/run-22"
chk "an artifact whose run failed afterwards does not count -> 1" [ "$(run "$V" "$SHA")" = 1 ]
chk "saying it exists but not from a successful run" grep -q 'exists, but not from a successful run of linux-promote-check-7933.yml on main' "$T/out"

reset; green linux-family-install linux-family-install-7281.yml 11; green linux-promote-check linux-promote-check-7933.yml 22
echo "success linux-promote-ci-x .github/workflows/linux-promote-check-7933.yml" > "$FX/run-22"
chk "a green run on another branch does not count -> 1" [ "$(run "$V" "$SHA")" = 1 ]

reset; green linux-family-install linux-family-install-7281.yml 11; green linux-promote-check linux-promote-check-7933.yml 22
echo "success main .github/workflows/linux-family-install-7281.yml" > "$FX/run-22"
chk "an artifact of the right name from ANOTHER workflow does not count -> 1" [ "$(run "$V" "$SHA")" = 1 ]

reset; green linux-family-install linux-family-install-7281.yml 11; green linux-promote-check linux-promote-check-7933.yml 22
echo "success main .github/workflows/linux-promote-check-7933.yml@refs/heads/main" > "$FX/run-22"
chk "a workflow path with an @ref suffix still counts -> 0" [ "$(run "$V" "$SHA")" = 0 ]

reset; green linux-family-install linux-family-install-7281.yml 11; green linux-promote-check linux-promote-check-7933.yml 22
printf '21\n22\n' > "$FX/art-linux-promote-check-$V-$SHA"; echo "failure main .github/workflows/linux-promote-check-7933.yml" > "$FX/run-21"
chk "one failed and one green run of the same build: the green one counts -> 0" [ "$(run "$V" "$SHA")" = 0 ]

reset; green linux-family-install linux-family-install-7281.yml 11; green linux-promote-check linux-promote-check-7933.yml 22; touch "$FX/art-down"
chk "GitHub not answering for an artifact -> 2 (cannot tell)" [ "$(run "$V" "$SHA")" = 2 ]
reset; green linux-family-install linux-family-install-7281.yml 11; green linux-promote-check linux-promote-check-7933.yml 22; touch "$FX/run-down"
chk "GitHub not answering for a run -> 2 (cannot tell)" [ "$(run "$V" "$SHA")" = 2 ]
chk "no gh -> 2" [ "$(KOSMOS_GH=/nonexistent/gh bash "$HERE/tools/linux-check-runs.sh" "$V" "$SHA" > /dev/null 2>&1; echo $?)" = 2 ]
chk "a sha that is not 64 hex -> 2, before asking GitHub" [ "$(run "$V" "${SHA:0:12}")" = 2 ]
chk "a version that is not plain -> 2" [ "$(run "9.9.9;x" "$SHA")" = 2 ]

echo "test-linux-check-runs-7942: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
