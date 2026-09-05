# kosmos #2066 - source-channel install-side write (the STAGING-badge writer)

## Goal

The #2089 read side (server.js `sourceChannelNow`) reads `<store.ROOT>/source-channel`,
defaulting to prod, and the board paints a loud STAGING badge when it reads `staging`. Nothing
wrote that file, so every board read prod and the badge stayed dark. This branch adds the writer,
completing the join. It is the exact "which build am I on" signal whose absence let a fresh-machine
test run against the wrong version.

## Approach

`install/setup.sh` records which channel pointer the install fetched from into
`<store.ROOT>/source-channel`, a single token (`staging` or `prod`):

- Keyed on `_PTR_FILE`, the pointer the fetch already resolved (`latest-staging.json` → `staging`,
  else `prod`). Same selector the pointer fetch uses, so the marker cannot disagree with the bytes.
- `store.ROOT` mirrors `engine/store.js dataRootFor` via its `root()` caller (store.js:158) for
  this macOS-only installer: `$AGENT_WORKFORCE_DATA/AgentWorkforce` when that override is set (the
  sandbox the tests seed), else `${AGENT_WORKFORCE_HOME:-$HOME}/Library/Application Support/AgentWorkforce`.
  The `AGENT_WORKFORCE_HOME` arm is load-bearing: `root()` reads `AGENT_WORKFORCE_HOME||os.homedir()`,
  so a bare `$HOME` here would write under a different root than the board reads when that seam is
  set. So the write lands exactly where the read side looks.
- Written BEFORE the board starts, so its first read is correct. A missing file reads prod, so an
  unrecorded staging install can never masquerade as staging.
- Resilient: a failed write prints a note and does not abort the install (the badge is a
  nice-to-have, not install-critical). Errexit-safe (if-guards + `||`), matching setup.sh's
  `set -euo pipefail`.

## Decision: one write covers both install paths (single funnel)

The #2066 join contract asked for a write in setup.sh AND engine/update.js. Measured: update.js's
auto-update does NOT install in-process - `beginInstall` spawns setup.sh via `curl | sh` with
`KOSMOS_UPDATE_CHANNEL` set. So `_PTR_FILE` in setup.sh already reflects the update's channel;
setup.sh is the single funnel both fresh-install and update share. A second write in update.js
would be redundant and could diverge from the funnel. Surfaced to Mona Lisa (read-side author) for
confirmation; a belt-and-suspenders update.js write, if she wants it, is an additive follow-up, not
a rework of this.

## Tests

Extended `tools/test-staging-wire-2036.sh` (the #2036 shell test, already wired into `test:shell`):
- staging → `staging`, default → `prod`, non-staging value → `prod`
- the file lands at `<AGENT_WORKFORCE_DATA>/AgentWorkforce/source-channel` (the store.ROOT the server reads)
- grep guards that setup.sh carries the write, the token selector, and the data-root override
  (red-capable: stripping the write line reds the guard - proven)
- a cross-check that server.js names the same `source-channel` filename

## Out of scope

- The read side (shipped, #2089). No product/UI change here - this is install-side recording only.
- A separate update.js write (see the decision above; pending Mona Lisa).
