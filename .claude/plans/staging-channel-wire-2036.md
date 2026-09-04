# #2036 remainder: wire the staging channel into the cut (staging-first, manual promote)

## The goal (Josh's #1, from the 0.6.25 outage)
A cut must NOT reach prod directly. It publishes to a STAGING channel; a build is verified
from a genuinely FRESH-USER (no-token) state and, by default, HELD for Josh to test on a
machine; prod is reached only by an explicit PROMOTE that points prod at the exact
staging-verified bytes. Rollback = a pointer flip, never a rebuild.

0.6.25 shipped a correct one-line fix, was verified four ways, and killed every board -
because all four checks ran holding a board token and so were blind to #2023 (a no-token
user 403s every /api/* after update). The fresh-user verify is the whole point.

## The pieces already merged (standalone, NOT wired) - I connect them
- #2063 (Kitty) `tools/staging-experience-check.sh`: the fresh-user SERVER experience gate.
  Mints a nonce with the board token (off argv), redeems `?boot=` for the cookie, uses the
  cookie on a sensitive /api/* and asserts NOT refused. exit 0 usable / 1 broken / 2
  cannot-tell (no enforcing board, e.g. the dev box). Browser "polymer clicking" sits on top.
- #2077 (me) `tools/publish-staging-pointer.sh`: writes `dist/latest-staging.json` (2nd
  pointer to the same bytes), never touches `latest.json`, does not deploy.
- #2077 (me) `tools/promote-channel.sh`: points `dist/latest.json` at exactly the bytes
  `latest-staging.json` names, gated on (a) served sha match + (b) the #2063 experience gate;
  HOLDS on cannot-tell (dev box); never rebuilds. Rollback is the same tool at a prior pointer.
- #2089 sourceChannel display: board shows which channel a build came from.
- `tools/lib/write-latest-pointer.js` (me, #2077): the ONE pointer-shape writer both the cut
  and publish-staging-pointer use, so prod and staging pointers cannot diverge in shape.

## The wiring (the spine), in release.sh
Today (release.sh:730-736) the cut writes `dist/latest.json` = new version, commits it
(:820), pushes+deploys (:802-841, step 8), verifies `latest.json` serves new (step 9) =>
PROD updates immediately. Change to staging-first:

1. **Pointer write (730-736):** write `dist/latest-staging.json` = new version via the shared
   writer. Leave `dist/latest.json` (prod) UNCHANGED at its prior committed version.
2. **Commit set (:820):** `_site_paths` commits `dist/latest-staging.json` (not latest.json)
   + the versioned manifest + setup + versions.html. latest.json is untouched, so prod stays.
3. **Verify-served (step 9):** assert `latest-staging.json` serves the NEW version + its sha
   matches the served bytes; assert `latest.json` (prod) is UNCHANGED (still the prior
   version) - a cut must not move prod. (Keep the existing served-bytes/manifest checks, just
   aimed at the staging pointer for the new version.)
4. **Hand-off print (end of cut):** the cut ends by printing that the build is on STAGING,
   prod still serves <prior>, and the exact next commands: update a FRESH machine from
   staging, click, then `tools/promote-channel.sh <site> [port]`. Loud, not silent.

### Best-rec decisions (documented; Josh can steer)
- **DEFAULT = MANUAL promotion** (Splinter's steer + Josh's words "I could even test it
  before we push to prod"). The cut publishes staging + HOLDS. No auto-promote.
- **Seam for future auto-promote:** `KOSMOS_PROMOTE=auto` (default `manual`) reserved; when
  the fresh verify has earned trust, an `auto` path can call promote-channel after a green
  fresh-machine check. Not built now; the flag name is the seam.
- **Channel selector:** `KOSMOS_CUT_CHANNEL` = `staging` | `prod`. SUPERSEDED BELOW - see
  "CONFIRMED DESIGN": the default is `prod` (safe interim) until the loop is proven, NOT
  `staging`. `staging` is opt-in until the proof-gated default-flip follow-up.
- **The fresh verify + promote run on the FRESH machine, NOT the cut machine.** The cut
  machine holds a token (the 0.6.25 blindness), so it cannot self-verify a no-token user. The
  cut publishes to staging and hands off; promote-channel.sh already HOLDS on a non-fresh /
  non-enforcing board (exit 2), which enforces this by construction.

## Tests
- Extend `tools/test-staging-channel-2036.sh` (mine, #2077) and/or the cut-guard tests:
  - a staging cut writes latest-staging.json = new AND leaves latest.json = prior (the core
    invariant); prove red-capable (a version that advances latest.json fails).
  - the escape hatch `KOSMOS_CUT_CHANNEL=prod` writes latest.json (old behavior).
  - the hand-off text is printed on a staging cut.
- Keep the existing same-bytes / promote-gate arms green (they already cover the pointer copy
  + the experience gate hold).
- Prefer a release.sh unit-seam (like test-release-detached / test-cut-* patterns) so this is
  provable WITHOUT a full live cut.

## Runbook (docs) - the full flow + the Josh hand-off
Write `docs/staging-channel.md` (or extend releasing.md): cut -> staging (held) -> update a
fresh machine from the staging pointer -> exercise it (person clicks, or an agent drives a
browser; the server experience gate is staging-experience-check) -> Josh tests if he wants ->
`promote-channel.sh` flips prod to the same bytes. Rollback = promote a prior pointer.

## Increments
- **First PR (this branch): the spine** - the release.sh staging-first wiring (1-4 above) +
  the escape hatch + tests + the runbook. The verify/promote tools already exist.
- Later (separate): an `auto` promote path once the fresh verify earns trust; a fresh-machine
  orchestration helper if hand-driving proves fiddly. Seam left, not built now.

## Droppable
This is agent-workforce release tooling in its own worktree. If a higher-priority interrupt
lands (a live outage, a new Splinter directive), drop at a clean committed state and resume.

## CONFIRMED DESIGN + SEQUENCING (Splinter, 2026-09-04)
- MODEL A confirmed: latest-staging.json, a second POINTER on the same host (NOT model B, a
  second "staging base"/host, which update.js mentions but we are NOT building). Promotion is
  a pure pointer flip.
- Full mechanism ships in ONE carefully-reviewed PR: publish (cut->staging pointer) + CONSUME
  (update.js/setup.sh fetch latest-staging.json when on the staging channel) + promote-wire.
  The consume change gets its own challenge-loop scrutiny (it is the client update path).
- 🛑 HARD INVARIANT: the DEFAULT does NOT move to staging until the full loop is DEMONSTRATED
  end-to-end on a REAL fresh machine (staging cut -> fresh no-token pull via the new consume
  path -> experience verify -> pointer promote). Reason: the update.js consume path is a
  bootstrap that cannot be protected by the pipeline it introduces (chicken-and-egg), and a
  client-update-path bug IS the 0.6.25 class. So:
    - This PR: default = PROD (no live-cut behavior change). The whole mechanism is OPT-IN via
      KOSMOS_CUT_CHANNEL=staging + the consume-channel selector, each testable without touching
      a real cut's default.
    - The default-flip to staging = a SEPARATE, proof-gated follow-up PR, landed only after a
      manual real-fresh-machine demonstration of the loop (proof attached to that PR).
- REJECTED: indefinite phase-at-default-prod (leaves the outage class open). The default-prod
  is the SAFE INTERIM only until the loop is proven, then it flips.

## Consume side (the sensitive part) - design
update.js:112 and setup.sh:2236 fetch `<base>/latest.json`. Add a channel selector so a machine
on the staging channel fetches `<base>/latest-staging.json` instead:
- Source of the selector: #2089's `<store.ROOT>/source-channel` file (already the channel record)
  and/or an env (KOSMOS_UPDATE_CHANNEL) for a fresh machine that has no board yet.
- Default (no selector / "prod") = latest.json, byte-for-byte today's behavior (the safe path
  every existing install stays on).
- Its own challenge-loop; assert the prod path is unchanged when no selector is set (red-capable),
  and that a staging selector fetches the staging pointer.
