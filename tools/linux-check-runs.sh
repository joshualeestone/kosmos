#!/usr/bin/env bash
# linux-check-runs.sh - kosmos#7942: did BOTH Linux check workflows pass for this exact Linux build?
#
#   bash tools/linux-check-runs.sh <version> <linux sha256>
#
# tools/promote-channel.sh runs this before a promote moves latest-linux.json. A Mac board cannot boot the Linux build,
# so the Linux legs run on GitHub's stock ubuntu-24.04 runners:
#   linux-family-install-7281.yml   a fresh install from /setup-staging
#   linux-promote-check-7933.yml    prod's verifier with controls, data up and back, a prod install updated in place
# Each workflow uploads an artifact named for the build it checked, and only when every check passed against the live
# site (https://installkosmos.com) on the staging channel:
#   linux-family-install-<version>-<sha256>      linux-promote-check-<version>-<sha256>
# So a run proves the exact bytes it tested, not "the latest staging build" at some moment. This looks the two names
# up and requires, for each, an unexpired artifact whose run is that workflow's file, on main, and concluded success
# (the workflows record only from main, so a test branch's code never vouches for a promote).
#
# Exit: 0 both found and green | 1 one or both missing or not green (says which, and how to run them) |
#       2 cannot tell (no gh, not signed in, or GitHub did not answer): the promote HOLDS, as for a gate's cannot-tell.
# Overrides (for the test): KOSMOS_GH (the gh command, default gh), KOSMOS_GH_REPO (default joshualeestone/kosmos).
set -uo pipefail
V="${1:-}"; SHA="${2:-}"
case "$V" in ''|*[!0-9.]*) echo "linux-check-runs: usage: $0 <version> <linux sha256>" >&2; exit 2 ;; esac
case "$SHA" in *[!0-9a-f]*|'') echo "linux-check-runs: the sha256 must be 64 lowercase hex characters" >&2; exit 2 ;; esac
[ "${#SHA}" = 64 ] || { echo "linux-check-runs: the sha256 must be 64 lowercase hex characters" >&2; exit 2; }
GH="${KOSMOS_GH:-gh}"; REPO="${KOSMOS_GH_REPO:-joshualeestone/kosmos}"
command -v "$GH" >/dev/null 2>&1 || { echo "linux-check-runs: $GH is not installed, so the Linux check runs cannot be read" >&2; exit 2; }

missing=""; told=0
# <artifact prefix> <workflow file>: prints why it does not count, or nothing when it does. Exit 2 = cannot tell.
one() {
  local name="$1-$V-$SHA" file="$2" ids id run concl branch path
  ids="$("$GH" api "repos/$REPO/actions/artifacts?name=$name&per_page=30" --jq '.artifacts[] | select(.expired == false) | .workflow_run.id' 2>/dev/null)" \
    || { echo "linux-check-runs: GitHub did not answer for the artifact $name" >&2; return 2; }
  [ -n "$ids" ] || { echo "no green run of $file has checked $V ($SHA)"; return 0; }
  while IFS= read -r id; do
    case "$id" in ''|*[!0-9]*) continue ;; esac
    run="$("$GH" api "repos/$REPO/actions/runs/$id" --jq '.conclusion + " " + .head_branch + " " + .path' 2>/dev/null)" \
      || { echo "linux-check-runs: GitHub did not answer for run $id" >&2; return 2; }
    concl="${run%% *}"; run="${run#* }"; branch="${run%% *}"; path="${run#* }"
    # .path can carry an @ref suffix ("…/x.yml@refs/heads/main").
    if [ "$concl" = success ] && [ "$branch" = main ] && [ "${path%%@*}" = ".github/workflows/$file" ]; then
      echo "ok $file run $id"; return 0
    fi
  done <<< "$ids"
  echo "the artifact $name exists, but not from a successful run of $file on main"
}
for pair in "linux-family-install linux-family-install-7281.yml" "linux-promote-check linux-promote-check-7933.yml"; do
  out="$(one ${pair% *} ${pair#* })"; rc=$?
  [ "$rc" = 0 ] || exit 2
  case "$out" in
    "ok "*) echo "linux-check-runs: ${out#ok }: green for $V ($SHA)" ;;
    *) echo "linux-check-runs: $out" >&2; missing="$missing ${pair#* }"; told=1 ;;
  esac
done
if [ "$told" = 1 ]; then
  echo "linux-check-runs: run what is missing, against the staging channel, then promote again:" >&2
  for f in $missing; do
    case "$f" in
      linux-family-install-7281.yml) echo "  gh workflow run linux-family-install-7281.yml --repo $REPO -f channel=staging" >&2 ;;
      *) echo "  gh workflow run $f --repo $REPO" >&2 ;;
    esac
  done
  exit 1
fi
exit 0
