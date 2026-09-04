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
3. **Exercise it -- TWO gates, two classes.** Open the board and click -- a person, or an agent
   driving a browser. Two independent server-side gates back the promote:
   - **Board reachability (#2063), `tools/staging-experience-check.sh`:** mints a nonce with the
     board token off argv, redeems `?boot=` for the cookie, and asserts a fresh session can use a
     sensitive `/api/*` -- the #2023 class every 0.6.25 verification was blind to.
   - **Agent spawn (#2129), `tools/staging-agent-online-check.sh`:** the board gate does NOT
     exercise agent spawn, and #2129 was exactly that gap -- spawned agents wedged at the Claude
     Code trust prompt while the board served fine, so the board gate alone would PASS a #2129
     build. This gate creates a Claude agent AND an OpenAI agent and confirms each comes ONLINE
     (state idle/working, never a `needs_you` trust wedge). It **creates real agents**, so it
     refuses on a populated fleet board unless `KOSMOS_STAGING_VERIFY_ALLOW_LIVE=1`; run it on the
     fresh staging machine with both providers signed in.
4. **Promote.** `tools/promote-channel.sh <site-checkout> <that-board's-port>` points `latest.json`
   at the same bytes `latest-staging.json` names, gated on (a) the served sha matching, (b) the
   board-reachability gate passing, and (c) the agent-spawn gate passing. Either gate: exit 1
   (provably broken) refuses and is **not** `--force`able; exit 2 (cannot-tell -- e.g. the dev box,
   or a provider not signed in) **HOLDS**, `--force`able only after a hand check. So you cannot
   promote from a machine that cannot test either class.
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
- verify + promote: `tools/staging-experience-check.sh` (board reachability, #2063),
  `tools/staging-agent-online-check.sh` (agent spawn, #2129), `tools/promote-channel.sh` (runs both
  gates; override the commands via `KOSMOS_PROMOTE_GATE_CMD` / `KOSMOS_PROMOTE_AGENT_GATE_CMD`).
- abort safety: `release_site_restore` in `tools/lib/release-freeze.sh` cleans up an uncommitted
  staging pointer.
- tests: `engine/update.test.js` (consume selector), `tools/test-staging-wire-2036.sh` (release +
  setup selectors + restore cleanup), `tools/test-staging-channel-2036.sh` (pointer/promote tools,
  both gate arms), `tools/test-staging-agent-online-check.sh` (the agent-spawn gate's
  online/wedge/refuse discrimination, red-capable via the `KOSMOS_AOC_CURL` transport seam).
