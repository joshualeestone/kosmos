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
# up and requires, for each, an unexpired artifact whose run is a workflow_dispatch of that workflow's file on this
# repository's own main that concluded success, and whose commit is on main (identical to it or behind it: a tag can
# also be called main). The workflows record only from main, so a test branch's code, a fork's pull request or a tag
# does not vouch for a promote. Records are kept 90 days: a named promote or rollback of an
# older build finds none and needs --skip-linux-check (an old build can no longer be staged to check it).
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
  local name="$1-$V-$SHA" file="$2" ids id run concl event from hsha branch path cmp
  ids="$("$GH" api "repos/$REPO/actions/artifacts?name=$name&per_page=30" --jq '.artifacts[] | select(.expired == false) | .workflow_run.id' 2>/dev/null)" \
    || { echo "linux-check-runs: GitHub did not answer for the artifact $name" >&2; return 2; }
  [ -n "$ids" ] || { echo "no green run of $file has checked $V ($SHA)"; return 0; }
  while IFS= read -r id; do
    case "$id" in ''|*[!0-9]*) continue ;; esac
    run="$("$GH" api "repos/$REPO/actions/runs/$id" --jq '.conclusion + " " + .event + " " + .head_repository.full_name + " " + .head_sha + " " + .head_branch + " " + .path' 2>/dev/null)" \
      || { echo "linux-check-runs: GitHub did not answer for run $id" >&2; return 2; }
    concl="${run%% *}"; run="${run#* }"; event="${run%% *}"; run="${run#* }"; from="${run%% *}"; run="${run#* }"
    hsha="${run%% *}"; run="${run#* }"; branch="${run%% *}"; path="${run#* }"
    # .path can carry an @ref suffix ("…/x.yml@refs/heads/main"): when it does it must name main itself.
    case "$path" in *@*) [ "${path#*@}" = refs/heads/main ] || continue ;; esac
    # A dispatch of THIS repository's own main: a fork's pull-request run can name its own branch main, edit the
    # workflow and upload an artifact of the right name into this repository's list.
    if [ "$concl" = success ] && [ "$event" = workflow_dispatch ] && [ "$from" = "$REPO" ] && [ "$branch" = main ] \
      && [ "${path%%@*}" = ".github/workflows/$file" ]; then
      # A TAG can be named main, and a dispatch on it reports head_branch main too. So the commit the run ran must be
      # on this repository's main: identical to it, or behind it (main has moved on since). Anything else, no.
      case "$hsha" in *[!0-9a-f]*|'') continue ;; esac
      cmp="$("$GH" api "repos/$REPO/compare/$hsha...main" --jq '.status' 2>/dev/null)" \
        || { echo "linux-check-runs: GitHub did not answer whether $hsha is on main" >&2; return 2; }
      case "$cmp" in identical|ahead) echo "ok $file run $id"; return 0 ;; esac
    fi
  done <<< "$ids"
  echo "the artifact $name exists, but not from a successful dispatch of $file on $REPO's main"
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
