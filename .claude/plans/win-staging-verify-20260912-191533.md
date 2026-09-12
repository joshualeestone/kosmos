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
     every required check present once with its declared `by`, no unknown checks, and `result`
     equal to what the checks derive, so a hand-edited "pass" over a failed check is ambiguous).
2. `tools/win-staging-verified.sh` reads the record path and validates through that module. Exit
   contract unchanged (0 pass, 1 fail or ambiguous, 2 no record).
3. `tools/win-staging-verify.js` (Node built-ins only; dry run unless `--yes`):
   - V1 (automated, read-only network): fetch `latest-win-staging.json` from `update.releaseBase()`
     (`engine/update.js`, the S1 derivation, including `KOSMOS_RELEASE_BASE`), validate it with
     `update.readManifest('win32', ...)` and `update.pointerFor('win32', 'staging')`, fetch the
     versioned zip (streamed and hashed into a temp file, with byte and time caps, deleted after)
     and its `.sha256`. Computed, pointer and sidecar sha must agree.
   - V1 manifest (automated): read `manifest.json` out of the verified zip (a minimal central
     directory reader, one entry, capped); its version must be the pointer's, `source_sha` a
     40-hex commit, `source_dirty` false. `source_sha` in the record comes from here.
   - V2 (operator-attested this slice): the Explorer unpack plus Kosmos.exe, Z0-Z6
     (`kosmos-scripts\e2e-zip.js`), the multiline check and the msg check, the same checks that
     verified 0.6.55 on this box. The script prints the checklist and records only explicit
     `--attest <id>=pass|fail` answers. An un-attested check is `not-run`, never `pass`.
     Automating a second install beside the live Kosmos risks the real logon tasks and
     `engine-path`, so it is out of scope now.
   - V4: write the record atomically (temp file in the same dir, 0600, rename) at the reader's
     path. Never overwrite a record for the same sha without `--force-rewrite` (logged). Refuse
     to write an undecided record (nothing failed but some check not run): that is a HOLD, and a
     fail record would turn it into a refusal.
   - Output: a summary, the record path and its sha256 (posted with the result), and the exact
     `promote-channel.sh --family win` line for Josh with `--approval-ref` left for him.
4. Tests: `tools.win-staging-verify.test.js` (local HTTP server, no real network): V1 mismatches,
   bad pointer, caps, unreachable base; attestation parsing and marking; atomic write and
   no-overwrite; the round trip through the REAL `win-staging-verified.sh` (0/1/2, and all three
   record-directory arms). `tools/test-promote-channel-win.sh` fixtures move to the module's shape.
5. Docs: `docs/staging-channel.md`.

## Out of scope

- V3 (an in-app update from staging) needs S4.
- Automating V2 safely (a sandboxed second install that cannot move `engine-path` or the logon
  tasks) is a later slice.
- No publish, deploy or promote; the box's real install is never touched.
