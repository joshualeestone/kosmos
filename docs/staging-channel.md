# The staging channel (kosmos#2036)

Prevents the 0.6.25 class: a cut that reaches every user directly, verified only from machines
that already hold a board token and so are blind to what a fresh (no-token) user hits.

## The model: one host, two pointers, same bytes

The versioned artifact (`kosmos-<V>-arm64.tar.gz`) is published once, immutably. A **channel is
just which pointer you fetch**, never a different build:

- `dist/latest.json` -- the **prod** pointer.
- `dist/latest-staging.json` -- the **staging** pointer.

Promotion points prod at the exact bytes staging verified. It never rebuilds. Rollback is the
same: flip the pointer back. (Model A, confirmed 2026-09-04. Not a second host / "staging base".)

## The loop

1. **Cut to staging.** `KOSMOS_CUT_CHANNEL=staging bash tools/release.sh <V>` publishes the
   versioned artifact + `latest-staging.json` and **leaves `latest.json` (prod) at the prior
   version**. verify-served confirms the staging pointer serves `<V>` and prod is unchanged. The
   cut ends by printing this hand-off.
2. **Update a FRESH machine from staging.** On a machine/account with **no board token, no cookie,
   no prior install** -- NOT the build machine (it holds a token, the 0.6.25 blindness):
   - fresh install: `KOSMOS_UPDATE_CHANNEL=staging curl -fsSL https://installkosmos.com/setup | sh`
   - an existing box's auto-updater: set `AGENT_WORKFORCE_UPDATE_CHANNEL=staging` for it (e.g. in
     its launchd env). update.js then fetches `latest-staging.json` and hands the same channel to
     the installer it spawns, so both read the staging pointer and the staging **versioned**
     artifact is installed (setup.sh prefers `kosmos-<V>-arm64` over the shared alias).
3. **Exercise it.** Open the board and click -- a person, or an agent driving a browser. The
   server-side fresh-user experience gate is `tools/staging-experience-check.sh` (#2063): it mints
   a nonce with the board token off argv, redeems `?boot=` for the cookie, and asserts a fresh
   session can use a sensitive `/api/*` -- exactly the check every 0.6.25 verification was blind to.
4. **Promote.** `tools/promote-channel.sh <site-checkout> <that-board's-port>` points `latest.json`
   at the same bytes `latest-staging.json` names, gated on (a) the served sha matching and (b) the
   experience gate passing. It **HOLDS** (exit 2) on a board that cannot enforce (e.g. the dev box),
   so you cannot promote from a machine that cannot test.
5. **Deploy the promoted pointer** (the next `tools/deploy-site.sh --publish` carries it).
6. **Rollback** = promote a prior staging pointer, or flip `latest.json` back. No rebuild.

## The default is PROD, on purpose (the invariant)

`KOSMOS_CUT_CHANNEL` defaults to **prod**, and the update channel defaults to **prod
(latest.json)**, so every existing install and a bare `curl | sh` is byte-for-byte today's path.
The whole mechanism is **opt-in** until the loop is demonstrated end-to-end on a real fresh
machine (staging cut -> fresh no-token pull -> experience verify -> pointer promote). The reason:
the consume side (the update.js/setup.sh channel fetch) is a bootstrap that cannot be protected by
the pipeline it introduces (chicken-and-egg), and a bug in the client update path IS the 0.6.25
class. The default flips to staging only in a separate, proof-gated change once that demonstration
is done.

## Where each piece lives
- publish: `tools/release.sh` (`KOSMOS_CUT_CHANNEL`), `tools/publish-staging-pointer.sh`,
  `tools/lib/write-latest-pointer.js` (the one pointer-shape writer).
- consume: `engine/update.js` + `install/setup.sh` (`AGENT_WORKFORCE_UPDATE_CHANNEL` /
  `KOSMOS_UPDATE_CHANNEL`).
- verify + promote: `tools/staging-experience-check.sh`, `tools/promote-channel.sh`.
- abort safety: `release_site_restore` in `tools/lib/release-freeze.sh` cleans up an uncommitted
  staging pointer.
- tests: `engine/update.test.js` (consume selector), `tools/test-staging-wire-2036.sh` (release +
  setup selectors + restore cleanup), `tools/test-staging-channel-2036.sh` (pointer/promote tools).
