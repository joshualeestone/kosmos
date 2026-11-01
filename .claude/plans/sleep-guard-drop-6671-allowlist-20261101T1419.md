# Plan: drop the two stale #6671 entries from the sleep-control guard allowlist

## Problem

`tools/test-sleep-control-guard-6710.sh` scans every `tools/test-*.sh` and fails any that carry a
long-lived bare-`sleep` control (a timer a stray `pkill -f "sleep N"` could end mid-test). It keeps
an ALLOWLIST of basenames NOT scanned, each with a reason. Two entries were added for files whose
bare-sleep controls were out of #6710's scope and would be converted by a separate fix:

- `test-test-leak-guard-4273.sh`
- `test-start-waits-for-starting-board-6586.sh`

The ALLOWLIST comment states, verbatim, that Kano owns removing these two `#6671` entries once
`leakctl-6671` merges, so the exemptions do not outlive the fix. `leakctl-6671` has merged
(commit `4f319bf57d`, "the leak guard's outside control cannot be failed by a stray pkill (#6813)")
and #6671 is CLOSED, so the trigger is met. While the entries remain, those two files are exempt
from the scan, i.e. silently unguarded against a future bare-sleep regression.

## Scope

In scope: remove the two allowlist entries and reword the ALLOWLIST comment (the list becomes
empty). Nothing else: the guard's matcher, its scan, and its stale-entry self-check are unchanged.

## Design

Set `ALLOWLIST=""` and reword the comment to describe when a file belongs in the allowlist at all
(a deliberate bare-sleep shape the matcher cannot auto-detect, named with its converting card) and
to note it is empty now that leakctl-6671 (#6671) has merged and its two files are converted. The
`allowlisted()` helper and the stale-entry check both iterate `$ALLOWLIST`; an empty value makes
both no-ops (nothing allowlisted, no stale entries), and #6710's four converted files stay in the
scanned set.

## Verification

Run the guard directly: it must report the two now-scanned files clean and pass overall. Observed:
`scanned 177 non-allowlisted test-*.sh, 177 clean` and `all sleep-control-guard checks passed`
(exit 0), confirming the leakctl-6671 conversion landed and coverage is restored.

## Done means

The two stale #6671 allowlist entries are gone, the allowlist is empty with an accurate comment,
and the guard passes with both formerly-exempt files now scanned and clean.
