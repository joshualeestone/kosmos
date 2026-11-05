#!/usr/bin/env bash
# test-linux-check-runs-7942.sh -- kosmos#7942. Unit-tests tools/linux-check-runs.sh against a fake gh (no network):
# what counts as "both Linux check runs green for this exact build". The fake answers each API path from a JSON
# fixture shaped like GitHub's real response and applies the script's own --jq with the real jq, so the filters the
# real answers go through are exercised, not assumed.
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
command -v jq >/dev/null 2>&1 || { echo "test-linux-check-runs-7942: SKIP: no jq on this computer (the fake gh applies --jq with it)"; exit 0; }
T="$(mktemp -d "${TMPDIR:-/tmp}/linux-check-runs-7942.XXXXXX")"; trap 'rm -rf "$T"' EXIT
PASS=0; FAIL=0
chk() { local d="$1"; shift; if "$@"; then PASS=$((PASS+1)); echo "PASS  $d"; else FAIL=$((FAIL+1)); echo "FAIL  $d"; fi; }
V=9.9.9; SHA="$(printf 'build' | shasum -a 256 | awk '{print $1}')"; OTHER="$(printf 'other' | shasum -a 256 | awk '{print $1}')"
HS=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa   # the commit the runs ran
FX="$T/fx"; mkdir -p "$FX"
# The fake gh: `gh api <path> --jq <expr>` runs jq -r <expr> over the fixture for that path.
#   artifacts?name=<n>    -> $FX/art-<n>.json  (absent: {"artifacts":[]})     $FX/art-down: the call fails
#   runs/<id>             -> $FX/run-<id>.json (absent: the call fails, as a 404 does)  $FX/run-down: every one fails
#   compare/<sha>...main  -> $FX/cmp-<sha>.json (absent: diverged)             $FX/cmp-down: the call fails
cat > "$T/gh" <<FAKE
#!/usr/bin/env bash
[ "\$1" = api ] || exit 9
p="\$2"; expr=""; [ "\${3:-}" = --jq ] && expr="\$4"
answer() { if [ -n "\$expr" ]; then jq -r "\$expr" "\$1"; else cat "\$1"; fi; }
case "\$p" in
  *"/actions/artifacts?name="*) [ ! -e "$FX/art-down" ] || exit 1; n="\${p#*name=}"; n="\${n%%&*}"
    f="$FX/art-\$n.json"; [ -e "\$f" ] || { printf '{"artifacts":[]}' > "$FX/empty.json"; f="$FX/empty.json"; }; answer "\$f" ;;
  *"/actions/runs/"*) [ ! -e "$FX/run-down" ] || exit 1; f="$FX/run-\${p##*/}.json"; [ -e "\$f" ] || exit 1; answer "\$f" ;;
  *"/compare/"*) [ ! -e "$FX/cmp-down" ] || exit 1; c="\${p#*/compare/}"; c="\${c%%...*}"; f="$FX/cmp-\$c.json"
    [ -e "\$f" ] || { printf '{"status":"diverged"}' > "$FX/div.json"; f="$FX/div.json"; }; answer "\$f" ;;
  *) exit 9 ;;
esac
FAKE
chmod +x "$T/gh"
run() { KOSMOS_GH="$T/gh" KOSMOS_GH_REPO=o/r bash "$HERE/tools/linux-check-runs.sh" "$@" > "$T/out" 2>&1; echo $?; }
reset() { rm -f "$FX"/*; }
# art <name> <id:expired>...: an artifact list, as GitHub answers it
art() { local n="$1" a="" s; shift; for s in "$@"; do a="$a${a:+,}{\"name\":\"$n\",\"expired\":${s#*:},\"workflow_run\":{\"id\":${s%%:*},\"head_sha\":\"$HS\"}}"; done
  printf '{"total_count":%s,"artifacts":[%s]}' "$#" "$a" > "$FX/art-$n.json"; }
# runj <id> <conclusion|null> <event> <repo> <sha> <branch> <path>: a run object, as GitHub answers it
runj() { local c="\"$2\""; [ "$2" = null ] && c=null
  printf '{"id":%s,"conclusion":%s,"event":"%s","head_repository":{"full_name":"%s"},"head_sha":"%s","head_branch":"%s","path":"%s"}' \
    "$1" "$c" "$3" "$4" "$5" "$6" "$7" > "$FX/run-$1.json"; }
cmp() { printf '{"status":"%s"}' "$2" > "$FX/cmp-$1.json"; }
green() {  # <prefix> <file> <run id>: an unexpired artifact for the exact build from a successful dispatch on main
  art "$1-$V-$SHA" "$3:false"; runj "$3" success workflow_dispatch o/r "$HS" main ".github/workflows/$2"; cmp "$HS" identical; }
both() { green linux-family-install linux-family-install-7281.yml 11; green linux-promote-check linux-promote-check-7933.yml 22; }
PC=linux-promote-check-7933.yml

reset; both
chk "CONTROL: both runs green for the exact build -> 0" [ "$(run "$V" "$SHA")" = 0 ]
chk "and it names both runs" grep -q 'linux-family-install-7281.yml run 11' "$T/out"
chk "  (the second too)" grep -q 'linux-promote-check-7933.yml run 22' "$T/out"

reset; green linux-family-install linux-family-install-7281.yml 11
chk "the check run missing -> 1" [ "$(run "$V" "$SHA")" = 1 ]
chk "naming what is missing" grep -q 'no green run of linux-promote-check-7933.yml has checked 9.9.9' "$T/out"
chk "and the command that runs it" grep -qF 'gh workflow run linux-promote-check-7933.yml --repo o/r' "$T/out"
chk "but not the one that was green" bash -c "! grep -qF 'gh workflow run linux-family-install-7281.yml' '$T/out'"

reset; both; art "linux-promote-check-$V-$SHA" "22:true"
chk "an EXPIRED artifact does not count (the real select(.expired == false) through jq) -> 1" [ "$(run "$V" "$SHA")" = 1 ]
reset; both; art "linux-promote-check-$V-$SHA" "21:true" "22:false"
chk "an expired and an unexpired record: the unexpired one counts -> 0" [ "$(run "$V" "$SHA")" = 0 ]

reset; both; mv "$FX/art-linux-promote-check-$V-$SHA.json" "$FX/art-linux-promote-check-$V-$OTHER.json"
chk "green runs of ANOTHER build of the same version do not count -> 1" [ "$(run "$V" "$SHA")" = 1 ]

reset; both; runj 22 failure workflow_dispatch o/r "$HS" main ".github/workflows/$PC"
chk "an artifact whose run failed afterwards does not count -> 1" [ "$(run "$V" "$SHA")" = 1 ]
chk "saying it exists but not from a successful dispatch" grep -q "exists, but not from a successful dispatch of $PC on o/r" "$T/out"
reset; both; runj 22 null workflow_dispatch o/r "$HS" main ".github/workflows/$PC"
chk "a run still in progress (null conclusion, through the real jq) does not count -> 1" [ "$(run "$V" "$SHA")" = 1 ]

reset; both; runj 22 success workflow_dispatch o/r "$HS" linux-promote-ci-x ".github/workflows/$PC"
chk "a green run on another branch does not count -> 1" [ "$(run "$V" "$SHA")" = 1 ]
reset; both; runj 22 success workflow_dispatch o/r "$HS" main ".github/workflows/linux-family-install-7281.yml"
chk "an artifact of the right name from ANOTHER workflow does not count -> 1" [ "$(run "$V" "$SHA")" = 1 ]
reset; both; runj 22 success workflow_dispatch o/r "$HS" main ".github/workflows/$PC@refs/heads/main"
chk "a workflow path with an @refs/heads/main suffix still counts -> 0" [ "$(run "$V" "$SHA")" = 0 ]
reset; both; runj 22 success workflow_dispatch o/r "$HS" main ".github/workflows/$PC@refs/tags/main"
chk "a workflow path whose @ref names a tag does not count -> 1" [ "$(run "$V" "$SHA")" = 1 ]
reset; both; art "linux-promote-check-$V-$SHA" "21:false" "22:false"; runj 21 failure workflow_dispatch o/r "$HS" main ".github/workflows/$PC"
chk "one failed and one green run of the same build: the green one counts -> 0" [ "$(run "$V" "$SHA")" = 0 ]

reset; both; runj 22 success pull_request someone/fork "$HS" main ".github/workflows/$PC"
chk "a fork's pull-request run from ITS main does not count -> 1" [ "$(run "$V" "$SHA")" = 1 ]
reset; both; runj 22 success push o/r "$HS" main ".github/workflows/$PC"
chk "a push run (not a dispatch) does not count -> 1" [ "$(run "$V" "$SHA")" = 1 ]
reset; both; runj 22 success workflow_dispatch someone/fork "$HS" main ".github/workflows/$PC"
chk "a dispatch from another repository does not count -> 1" [ "$(run "$V" "$SHA")" = 1 ]

reset; both; cmp "$HS" ahead
chk "a run on a commit main has since moved past still counts -> 0" [ "$(run "$V" "$SHA")" = 0 ]
reset; both; cmp "$HS" diverged
chk "a run whose commit is NOT on main (a tag called main) does not count -> 1" [ "$(run "$V" "$SHA")" = 1 ]
reset; both; cmp "$HS" behind
chk "a run on a commit AHEAD of main does not count -> 1" [ "$(run "$V" "$SHA")" = 1 ]

reset; both; touch "$FX/art-down"
chk "GitHub not answering for an artifact -> 2 (cannot tell)" [ "$(run "$V" "$SHA")" = 2 ]
reset; both; touch "$FX/run-down"
chk "GitHub not answering for the runs -> 2 (cannot tell)" [ "$(run "$V" "$SHA")" = 2 ]
reset; both; touch "$FX/cmp-down"
chk "GitHub not answering the compare -> 2 (cannot tell)" [ "$(run "$V" "$SHA")" = 2 ]
reset; both; art "linux-promote-check-$V-$SHA" "21:false" "22:false"
chk "one run GitHub cannot answer for (404) does not hide a green one beside it -> 0" [ "$(run "$V" "$SHA")" = 0 ]
reset; both; art "linux-promote-check-$V-$SHA" "21:false"
chk "but with no other run, it is cannot tell, not a verdict -> 2" [ "$(run "$V" "$SHA")" = 2 ]

chk "no gh -> 2" [ "$(KOSMOS_GH=/nonexistent/gh bash "$HERE/tools/linux-check-runs.sh" "$V" "$SHA" > /dev/null 2>&1; echo $?)" = 2 ]
chk "a sha that is not 64 hex -> 2, before asking GitHub" [ "$(run "$V" "${SHA:0:12}")" = 2 ]
chk "a version that is not plain -> 2" [ "$(run "9.9.9;x" "$SHA")" = 2 ]
chk "the artifact query asks for the exact name" grep -qF 'actions/artifacts?name=$name' "$HERE/tools/linux-check-runs.sh"
# The fake keys the compare on the sha alone, so the ref it compares against is pinned by its text: heads/main, never a
# bare main (with a tag called main, git resolves the bare name to the tag, which compares identical to itself).
chk "the compare is against heads/main, not a bare main" grep -qF 'compare/$hsha...heads/main' "$HERE/tools/linux-check-runs.sh"

# The contract between the two sides: the names the workflows upload are the names the lookup asks for, and each
# record is made in the workflow file the lookup requires. The fixtures above build names themselves, so a rename on
# either side would pass every arm above and make every real promote refuse.
WF="$HERE/.github/workflows"
chk "contract: linux-family-install-7281.yml records linux-family-install-<version>-<sha>" grep -qF 'echo "name=linux-family-install-$WANT_VERSION-$WANT_SHA" >> "$GITHUB_OUTPUT"' "$WF/linux-family-install-7281.yml"
chk "contract: linux-promote-check-7933.yml records linux-promote-check-<version>-<sha>" grep -qF 'echo "name=linux-promote-check-$VV-$VS" >> "$GITHUB_OUTPUT"' "$WF/linux-promote-check-7933.yml"
chk "contract: the lookup asks for those two prefixes, in those two files" grep -qF 'for pair in "linux-family-install linux-family-install-7281.yml" "linux-promote-check linux-promote-check-7933.yml"; do' "$HERE/tools/linux-check-runs.sh"
chk "contract: and builds the name as <prefix>-<version>-<sha>" grep -qF 'local name="$1-$V-$SHA"' "$HERE/tools/linux-check-runs.sh"
chk "contract: both workflows upload the named record" [ "$(grep -c 'name: ${{ steps.record.outputs.name }}\|name: ${{ steps.same.outputs.name }}' "$WF/linux-family-install-7281.yml" "$WF/linux-promote-check-7933.yml" | awk -F: '{s+=$2} END {print s}')" = 2 ]
# kosmos#7941: the update verb stays out of the record and out of an ordinary promote check. If it joined either, every
# promote would depend on it, and a plain re-dispatch would no longer clear a red one for the reason it was asked.
PC_YML="$HERE/.github/workflows/linux-promote-check-7933.yml"; PC_LEGS="$HERE/tools/promote-check-legs-7933.sh"
chk "contract: the record needs only the two legs it records" grep -qF 'needs: [verify-and-data, update]' "$PC_YML"
chk "contract: the verb job runs only when asked or on a branch push" grep -qF "if: github.event_name == 'push' || inputs.old_version != ''" "$PC_YML"
chk "contract: the verb reads old_version through the environment, not into the script" grep -qF 'VERB_OLD: ${{ inputs.old_version }}' "$PC_YML"
PC_ALL="$(sed -n '/^  all) /,/;;$/p' "$PC_LEGS")"
chk "contract: all does run the update leg (so the next line reads the right block)" grep -q leg_update <<< "$PC_ALL"
if grep -q leg_verb <<< "$PC_ALL"; then chk "contract: all does not run the verb" false; else chk "contract: all does not run the verb" true; fi


echo "test-linux-check-runs-7942: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
