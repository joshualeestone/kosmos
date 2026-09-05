# connect-875: a completed 376MB download must not restart from zero on retry

Card: kosmos#875 (claimed:renettilley). Josh, 2026-08-25: "it downloaded the whole
376MB, then i hit connect and it started the whole download over." Night-shift
direct build; plan backfilled before the challenge-loop.

## Root cause (verified in engine/connect.js)

Two independent facts combine:

1. `installClaudeCode` downloads and checksum-verifies the binary, then runs
   `claude install`. On `!inst.ok` it DELETED the verified binary
   (`fs.unlinkSync(downloaded.path)`), with the comment "a retry re-downloads in
   seconds" - false for a 376MB build, which is the whole complaint.
2. `download()` never reused an existing binary - it always fetched to `.part`
   and renamed over `dest`, even when a verified `dest` for the target version
   already sat on disk.

So a completed download whose install step failed (often transiently) was thrown
away, and the retry re-fetched the whole thing.

## Decision (mine, per Josh's "make the call and implement it")

Fix both halves so a retry is instant:

- **Keep the verified binary on install failure.** It passed its checksum; only
  the install step failed. Removed the delete at the `!inst.ok` arm.
- **Reuse a verified on-disk binary in `download()`.** After the dir-owns sweep,
  if `dest` exists and `sha256File(dest) === want`, return it without fetching
  (and report it instantly-complete so the progress bar finishes). Hash-gated:
  a truncated/tampered file falls through to a fresh download, never installs.

**Rejected:** touching the CANCEL delete paths (a cancelled flow's contract is
"own nothing half-claimed") and the no-home delete path (install has nowhere to
go; a retry won't help until home is fixed). Both are out of scope for this card
and changing them would alter documented contracts.

**Stranding stays bounded.** Keeping the binary does not accumulate one file per
attempted version: `download()`'s "every fresh download owns the dir" sweep
removes all OTHER versions on the next Connect, so at most the one kept version
sits until then - the same guarantee the old delete gave, now via the sweep.

## Weakest premise

That an install failure is usually transient enough that the SAME verified binary
is the right thing to reuse. If the binary itself were the cause of the install
failure (corrupt build), reuse would repeat the failure - but the download is
checksum-verified against the manifest, so a corrupt build is refused before it
is ever kept; a manifest that itself lies is a different bug. The reuse is
additionally hash-gated at read time, so on-disk corruption after the fact
re-downloads rather than reinstalls.

## Change

- `engine/connect.js`: `sha256File()` streaming helper; reuse-if-verified in
  `download()`; keep the verified binary on the install-failure arm.
- `engine/connect.test.js`: rewrote the old "stuck install does not strand"
  test (which asserted the DELETE) to the #875 contract (KEEPS the verified
  binary, byte-intact); added reuse-instead-of-refetch (broken binary endpoint
  as discriminator), a corrupted-cache control (must re-fetch), and a
  new-version-sweeps-old-kept-binary test (bounds stranding).

## Verification done

- `node --check engine/connect.js` clean.
- All 75 connect.test.js + connect.install-997.test.js pass.
- Reuse test proven RED when the reuse block is reverted; corrupt-control stays
  green (re-fetches either way, as it should).
- Not a web/ change (engine only), so the browser-check CI gate does not apply.
