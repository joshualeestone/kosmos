# #2036 - staging channel: the CHANNEL half (release-side)

Josh's #1 priority out of the 0.6.25 outage: put a build through a fresh-user-state
test before it reaches prod. Kitty's #2063 (verification half) merged - it drives the
real mint->redeem->cookie'd /api/* flow and asserts a fresh session can use the board
after update. This card is the CHANNEL half: how a build reaches a staging pointer,
gets verified there, and is then promoted to prod as THE SAME BYTES.

## The grounded mechanism (not a second build - a second pointer)

The cut already publishes an IMMUTABLE versioned artifact (`kosmos-$V-arm64.tar.gz` +
`.sha256` + `kosmos-$V-arm64.manifest.json`) and writes a MUTABLE pointer
`dist/latest.json` = `{version, sha256, artifact, manifest}` (release.sh ~730-740).
Installs fetch `latest.json`.

**Staging is a second pointer, `dist/latest-staging.json`, to the SAME artifact.**
- Publish-to-staging = write `latest-staging.json` pointing at the versioned artifact;
  do NOT touch `latest.json`.
- Promote = verify `latest-staging.json` names an artifact that EXISTS and whose served
  sha matches the pointer, run the #2063 experience gate, then copy the pointer to
  `latest.json`. NO rebuild.

### The invariant this protects (Kitty, 2026-09-03), and why it is the whole point
**The channel must never be baked into the artifact bytes.** If a build carried a
"staging"/"prod" stamp, promotion would force a REBUILD to flip the stamp, producing
different bytes - so you would ship to prod an artifact no one tested. Keeping the
channel in the POINTER means promotion is "point prod at the exact bytes staging
verified". `promote-channel.sh` enforces it: it refuses unless the artifact the staging
pointer names is byte-identical (by served sha) to what it promotes.

## Build increments (each its own PR)

1. **(this PR) The mechanism as standalone tools, not wired into the cut default.**
   - `tools/publish-staging-pointer.sh <site> [version]` - write `latest-staging.json`
     for a versioned artifact already in `<site>/dist`, reusing release.sh's exact
     node pointer generation and the verified `.sha256`. Refuses if the artifact or its
     verified sha is absent (never advertises bytes that are not there).
   - `tools/promote-channel.sh <site>` - promote staging->prod: (a) read
     `latest-staging.json`; (b) assert the artifact it names exists and its `.sha256`
     verifies in place AND equals the pointer's sha (same-bytes invariant, the refusal
     that makes this safe); (c) run the #2063 experience gate against a fresh-state
     board (exit 2 cannot-tell is a HOLD, not a pass); (d) copy the pointer to
     `latest.json`. It stages into the site dist; it does not deploy (same boundary as
     publish-kosmos-windows.sh #2008).
   - Tests for both, in isolation (a fake site dist with a fixture artifact + sha),
     covering the same-bytes refusal and the missing-artifact refusal. Wired into
     test:shell.
   Safe because it changes NOTHING the cut does by default - the tools exist to be
   wired in next.

2. **(follow-up) The consume side.** `install/setup.sh` / `engine/update.js` fetch a
   channel-specific pointer when `KOSMOS_CHANNEL=staging` (default prod, unchanged), so
   a fresh machine can install/update from staging. This touches the installer, so it is
   its own reviewed PR.

3. **(follow-up) Wire into the cut.** release.sh publishes the staging pointer as part
   of a cut, and a `promote` verb runs increment 1's promote + gate. Whether the cut goes
   staging-FIRST by default is a release-cadence choice - built as opt-in
   (`KOSMOS_CHANNEL`), Josh adopts the flow.

## The two hard deps that are Josh's, stated so nobody pretends they are closed

- **A genuinely fresh OS account / VM.** Josh confirmed 2026-09-03 the dev box
  STRUCTURALLY cannot exercise auto-update: the board runs from a source checkout, and
  `engine/update.js` refuses to auto-install over a working tree by design. So no
  mechanism built here can be end-to-end verified on this Mac. The #2063 gate exits 2
  (cannot-tell) on a from-source board - correctly - and increment 1's tests prove the
  refusals in isolation, but the LIVE staging->verify->promote loop needs a fresh
  machine only Josh (or a tester) has.
- **The staging-first flow default** is a cadence decision. Increment 1 is opt-in and
  reversible; it does not presuppose the answer.

## Weakest premise
The #2063 gate in promote (step c) can only run where an enforcing fresh board exists;
on the dev box it returns cannot-tell and promote must HOLD (not promote) on a 2 - a
human/fresh-machine has to run the real gate. Increment 1 makes that explicit rather
than papering over it with a green that means nothing.
