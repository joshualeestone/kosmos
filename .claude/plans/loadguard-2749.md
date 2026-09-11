# #2749: make the cut-load-guard field-index check deterministic (stop reading a moving value twice)

**Branch:** `loadguard-2749` · **Card:** kosmos#2749 (filed by April from PR #2745; in my lane)

## The defect

`tools/test-cut-load-guard.sh` read the live 1-minute load TWICE and asserted the two reads were
string-equal:

```sh
live_load="$(kosmos_box_load_1min)"                       # read 1 (sysctl vm.loadavg, field 2)
sys1="$(sysctl -n vm.loadavg | awk '{print $2}')"          # read 2 (sysctl again)
[ "$live_load" = "$sys1" ]                                 # a MOVING value compared to itself
```

The 1-minute load average changes between the two calls, so on a busy box the assertion reds for a
reason that has nothing to do with what it guards. Observed intermittently in CI (the same job's own
diagnosis printed "A red that is green alone is contention"). This is the `a-control-assumes-a-stable-
subject` bulletin exactly.

## What the arm is actually for

To guard that `kosmos_box_load_1min` extracts FIELD 2 of `vm.loadavg` (the 1-minute figure), not
field 1 (`{`), field 3 (5-min) or field 4 (15-min). Picking the wrong field would silently gate
cuts on the 5- or 15-minute average. So the arm must be KEPT and made deterministic, not deleted,
and not weakened with a tolerance or retry (which would defeat the field-index check it exists for -
the card calls this out explicitly).

## The fix

Two parts:

1. **`tools/lib/cut-load-guard.sh` - unify the extraction and add a raw seam.** `kosmos_box_load_1min`
   now reads the raw `vm.loadavg` string ONCE - from a new `KOSMOS_LOADAVG_RAW` seam if a test set
   it, else from live sysctl - and runs ONE shared `awk '{print $2}'` on that single string.
   - This is the key move: because the live path and the seam path now share the SAME extraction, a
     test that drives the seam guards the LIVE field index too (a test that only exercised a
     test-only branch would guard nothing that ships). `KOSMOS_FAKE_LOAD` is untouched (it still
     bypasses the parse for arms that just need a fixed load value).

2. **`tools/test-cut-load-guard.sh` - deterministic field-index arm.** Keep the live-numeric smoke
   check (a single read, asserts the live sysctl path returns a numeric value). Replace the two-read
   equality with: hand the function a FIXED raw with three DISTINCT figures
   (`KOSMOS_LOADAVG_RAW='{ 1.11 5.55 9.99 }'`) and assert it returns `1.11` (field 2). Distinct
   fields mean a swap to field 1/3/4 is always caught; the fixed input means nothing moves under it.

## The call, what I rejected

- **Chosen: distinct-field synthetic seam** over the card's live-raw-read-once suggestion. Both are
  deterministic, but once the extraction is unified, the live-raw version is tautological (both sides
  run the same awk on the same string) and its discrimination depends on the live 1-/5-min figures
  differing; a synthetic distinct-field input guarantees a swap is caught unconditionally. The card
  invited disagreement and this is strictly stronger for the field-index purpose.
- **Rejected: a tolerance or a retry** - the card's explicit "what NOT to do"; both pass on a busy
  box while making the arm unable to detect a wrong field.
- **Rejected: deleting the arm** - the field index is a real thing worth guarding.

## Verification

- `bash tools/test-cut-load-guard.sh` -> ALL PASS, including the field-index arm passing
  deterministically (got 1.11) while the machine was at load ~10.8.
- Perturbation-checked: changing the shared extraction to field 3 reds the field-index arm
  (got 5.55, expected 1.11), so it is genuinely red-capable for a wrong-field regression.
- Only `release.sh` sources the lib (via `kosmos_wait_for_quiet_box`/`kosmos_gate_or_abort`); the
  refactor preserves the return value, so cut gating is unchanged. No JS touched.

## Weakest premise

That the synthetic raw `'{ 1.11 5.55 9.99 }'` matches the real macOS `sysctl -n vm.loadavg` shape
(`{ 1m 5m 15m }`). The retained live-numeric smoke arm covers "the real live format still yields a
numeric field 2"; if macOS ever changed the format, that arm would catch a non-numeric result, and
the synthetic arm still correctly guards the field index against our documented format.
