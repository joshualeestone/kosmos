# win-staging-verify: the Windows staging verification-record writer

Branch `win-staging-verify`, off `origin/main` at `e113b870` (#2951, the Windows staging channel).

## Why

`promote-channel.sh --family win` promotes a staged Windows build to prod only with BOTH Josh's
explicit go (`--approved-version/--approved-sha/--approval-ref`) AND a passing verification record
read by `tools/win-staging-verified.sh`. #2951 shipped the reader and gate; nothing writes the
record yet. Josh's rule: "everything has to go to staging before it goes to prod after my
approval". The record is the technical half, so it must never be writable in a way that claims a
check which did not happen.

## What

1. `tools/lib/win-staging-record.js`: THE one spec of the record, read by both sides.
   - the required checks (id, who performs it: `automated` or `operator`, label);
   - the record directory and path (`KOSMOS_WIN_VERIFY_DIR`, else
     `%LOCALAPPDATA%\Kosmos\release-verify`, else `$HOME/.local/state/kosmos/release-verify`);
   - `buildRecord` (derives `result`: `pass` only when every required check passed);
   - `validateRecord` (the reader's validation, moved out of its inline `node -e`, and tightened:
     every required check present once with its declared `by`, no unknown checks, `result`
     equal to what the checks derive, so a hand-edited "pass" over a failed check is ambiguous,
     and a `pass` must name a 40-hex `source_sha`).
2. `tools/win-staging-verified.sh` reads the record path and validates through that module. Exit
   contract unchanged (0 pass, 1 fail or ambiguous, 2 no record).
3. `tools/win-staging-verify.js` (Node built-ins only; dry run unless `--yes`):
   - V1 (automated, read-only network): fetch `latest-win-staging.json` from `update.releaseBase()`
     (`engine/update.js`, the S1 derivation, including `KOSMOS_RELEASE_BASE`), validate it with
     `update.readManifest('win32', ...)` and `update.pointerFor('win32', 'staging')`, fetch the
     versioned zip (streamed and hashed into a temp file, with byte and time caps, deleted after,
     and on SIGINT, SIGTERM or SIGBREAK) and its `.sha256`. Computed, pointer and sidecar sha must
     agree, and the saved file's size must equal the hashed byte count. An unreachable host, a
     timeout, HTTP 408, 429 or 5xx, or a full disk is "cannot tell" (exit 2, no record), never a
     failed check.
   - V1 manifest (automated): read `manifest.json` out of the verified zip (a minimal central
     directory reader, capped). The whole directory is scanned, and a zip that lists any path
     twice (case-folded) is refused, because extractors keep the last copy. Its version must be the
     pointer's, `source_sha` a 40-hex commit, `source_dirty` false. `source_sha` in the record
     comes from here.
   - V2 (operator-attested this slice): the Explorer unpack plus Kosmos.exe, Z0-Z6
     (`kosmos-scripts\e2e-zip.js`), the multiline check and the msg check, the same checks that
     verified 0.6.55 on this box. The script prints the checklist and records only explicit
     `--attest <id>=pass|fail` answers. An un-attested check is `not-run`, never `pass`.
     - The answers are bound to the build: `--attest` requires `--for-sha <sha256>`, and a
       pointer that names another sha when they are recorded is refused (exit 3, nothing
       written). The checklist prints the sha and `--attest <id>=<pass|fail>` placeholders, never
       an all-pass line.
     - The checklist says to get Josh's go before running the build (it moves `engine-path`, which
       the logon tasks run, and `e2e-zip.js` drives the board on the live port), to note
       `engine-path` first, to put the box back (`repoint-main.js <repo> <node.exe>` for a
       checkout), and to check that `engine-path` equals the noted value again.
     - Automating a second install beside the live Kosmos risks the real logon tasks and
       `engine-path`, so it is out of scope now.
   - V4: write the record atomically (a 0600 temp file in the same dir, fsynced, then `linkSync`
     for a new record, which refuses when one exists, or `renameSync` only under
     `--force-rewrite`) at the reader's path. One try/finally removes the temp file on every path,
     a failed write or fsync included. A new record therefore needs hard links (NTFS). Never
     overwrite a record for the same sha without `--force-rewrite`, which is logged after the
     rename succeeds; a rename refused because another program holds the record is a sentence and
     exit 3, the old record unchanged. Refuse to write an undecided record (nothing failed but some
     check not run): that is a HOLD, and a fail record would turn it into a refusal.
   - Output: a summary, the record path and its sha256 (posted with the result), and, only after
     a written pass, the exact `promote-channel.sh --family win` line for Josh with
     `--approval-ref` left for him.
4. Tests: `tools.win-staging-verify.test.js` (local HTTP server, no real network): V1 mismatches,
   bad pointer, caps, 408/429/5xx on each of the three fetches, unreachable base, a full disk, a
   short save, an interrupt; the duplicate-entry manifest; attestation parsing, marking and the
   `--for-sha` binding (the pointer moving between the dry run and `--yes`); atomic write,
   no-overwrite (refused before any temp file), a failed write leaving nothing, a held record;
   the round trip through the REAL `win-staging-verified.sh` (0/1/2, and all three
   record-directory arms). `tools/test-promote-channel-win.sh` fixtures move to the module's shape.
5. Docs: `docs/staging-channel.md`.

## Out of scope

- V3 (an in-app update from staging) needs S4.
- Automating V2 safely (a sandboxed second install that cannot move `engine-path` or the logon
  tasks) is a later slice.
- No publish, deploy or promote; the box's real install is never touched.

## Deviations from the first draft of this plan (recorded after review)

- `validateRecord` also requires a 40-hex `source_sha` on a pass record.
- HTTP 408, 429 and 5xx on any fetch, a timeout and a full disk are "cannot tell", not a failed
  `sha` check (a 404 on the zip or sidecar still fails it: the pointer names bytes that are not
  served).
- A new record is placed with `linkSync`, not `renameSync`; rename is used only under
  `--force-rewrite`.
- The `--for-sha` binding for attestations (round 1, SAFETY 1).
- `main` takes an injectable `base` (default `update.releaseBase()`) and `verifyStagedBuild`
  injectable interrupt signals and exit, for in-process tests.

## Follow-ups (not this slice)

- Records are unsigned; the copy to the promoting box is authenticated only by the posted
  `record_sha256`. The approval (`--approval-ref`) could also name the `record_sha256` so Josh's go
  pins the exact record.
- The interrupt handler is tested with an injected event; the real SIGINT/SIGBREAK wiring is not
  exercised by a test (node:test's own SIGINT handler owns that signal in a test process).
- The engine-path restore is a checklist step the operator confirms, not a check in the record.

## Review log

- Round 1 (opus) at `f55897b8`: NOT converged. 2 SAFETY, 2 BUG, 1 CONVENTION, 3 TEST-GAP, NITs.
  - SAFETY 1: attestations were not bound to the tested build (a dry run on X, the pointer moves
    to Y, `--yes` wrote a PASS for Y). Fixed: `--for-sha` required with `--attest`, checked
    against the fetched pointer; the checklist prints the sha and placeholders.
  - SAFETY 2: the checklist did not ask for Josh's go and gave a broken restore hint. Fixed: a
    STOP line before step 2, the `engine-path` note and equality check, `repoint-main.js <repo>
    <node.exe>`.
  - BUG 1: a failed write or fsync left the `.tmp` in the record directory. Fixed: one
    try/finally from open to link/rename.
  - BUG 2: the manifest reader took the FIRST `manifest.json`. Fixed: a whole-directory scan that
    refuses any path listed twice.
  - CONVENTION: this plan updated to match the code; the gate header lists "a pass whose
    source_sha is not a commit" as ambiguous.
  - TEST-GAPs: 408/429/5xx on pointer and sidecar, the duplicate manifest, the pointer moving
    between dry run and `--yes`, and the no-overwrite refusal asserted to happen before any temp
    file. All added.
  - NITs: the replacement is logged after the rename; a held record is a sentence; docs say a new
    record needs NTFS hard links; the saved size is checked against the hashed count; an interrupt
    deletes the temp zip; a full disk says so.
  - Verified after the fixes, rebased onto `origin/main` `cfaa273e`: `tools.win-staging-verify.test.js`
    20/20 and `tools/test-promote-channel-win.sh` 46/46 (Windows box, Git Bash, the Kosmos runtime
    node v24.19.0, a shasum shim). Revert controls, run on a scratch copy of the tree and restored
    after each: SAFETY 1 (the `--for-sha` comparison removed) turns the binding test red; BUG 1
    (the temp removed only after a successful write) turns the failed-write test red; BUG 2 (the
    first `manifest.json` wins, no duplicate refusal) turns the manifest test red; 19/20 each, and
    20/20 again after restore.
