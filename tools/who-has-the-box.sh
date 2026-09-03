#!/usr/bin/env bash
# kosmos#1962: "who has the box?" -- one line saying whether a release currently
# holds the machine, and until when. Anyone on the fleet can run this to see why
# their gate refused, or to confirm the box is free before a heavy run.
#
#   bash tools/who-has-the-box.sh
#
# Read-only. Consulting the claim self-cleans a dead-holder or expired claim (the
# same safe cleanup every gate consult does), so a stale claim left by a crashed
# cut is swept the first time anyone looks.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
. "$REPO/tools/lib/cut-guard.sh"
kosmos_machine_claim_status
