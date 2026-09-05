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
   - fresh install: `curl -fsSL https://installkosmos.com/setup | KOSMOS_UPDATE_CHANNEL=staging sh`
     (the var MUST be on the `sh`, right of the pipe -- an env prefix binds to the LEFT of a pipe, so
     `KOSMOS_UPDATE_CHANNEL=staging curl ... | sh` sets it for curl and setup installs PROD, not staging)
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
     (state idle/working on **two consecutive polls** -- guarding a transient idle before a trust
     prompt registers -- never a `needs_you` trust wedge). It **creates real agents**, so it
     refuses on a populated (or uncountable) fleet board unless `KOSMOS_STAGING_VERIFY_ALLOW_LIVE=1`;
     run it on the fresh staging machine with both providers signed in.
     - **Exit codes are centered on the CLAUDE arm** (Splinter, 2026-09-04): #2129 fixes the
       Claude spawn wedge definitively, but a separate OpenAI/Codex spawn issue may remain and
       must not block shipping the Claude fix + the OpenAI-only gating. `0` both online; `1` the
       **Claude** arm failed (proven bad build, non-forceable); `2` cannot-tell (HOLD, forceable);
       `3` **partial** -- Claude online but the **OpenAI/Codex** arm failed, which the promoter
       **surfaces and routes** (forceable) rather than auto-holding.
     - **Residual (the plan's weakest premise):** detection hinges on the board reporting
       `needs_you` for a wedge; the gate is only fully proven on a real fresh machine (Part 2),
       which is why the default stays prod until then.
4. **Promote.** `tools/promote-channel.sh <site-checkout> <that-board's-port>` points `latest.json`
   at the same bytes `latest-staging.json` names, gated on (a) the served sha matching, (b) the
   board-reachability gate passing, and (c) the agent-spawn gate passing. Either gate: exit 1
   (provably broken) refuses and is **not** `--force`able; exit 2 (cannot-tell -- e.g. the dev box,
   or a provider not signed in) **HOLDS**, `--force`able only after a hand check. The agent gate's
   exit 3 (Claude online, OpenAI/Codex arm failed) also HOLDS but is `--force`able and prints
   which arm failed -- a routed decision (ship the Claude fix + gating now and chase the codex
   issue separately, or hold for a ruling), never a hard auto-hold. So you cannot promote from a
   machine that cannot test either class.
5. **Deploy the promoted pointer to prod.** `promote-channel.sh` only rewrites `latest.json` in the
   LOCAL site checkout ("the next site deploy publishes the prod pointer. No rebuild happened.");
   prod keeps SERVING the old version until a deploy. **`deploy-site.sh --publish` does NOT do this**
   -- it is a site-COPY tool whose committed-vs-live pointer guard REFUSES a pointer-move by design
   ("a site-copy deploy must never move the installer pointer"). Until the guarded `--promote` mode
   lands (**#2195**), deploy the pointer with `release.sh`'s proven step-8 machinery by hand. A
   promote is POINTER-ONLY: the versioned artifacts are already served from the staging cut.
   The artifacts MUST already be in `$S/dist` from the staging cut: `site_deploy_export` CARRIES from
   the working tree, it does NOT fetch (that is deploy-site.sh's addition), and `promote-channel.sh`
   already refreshed the local `kosmos-arm64.tar.gz` alias. Run the export + deploy under **bash**
   (the two libs are `#!/bin/bash` and are not safe to source into zsh), and CHAIN so a failed or
   empty export never reaches `vercel` (an early `site_deploy_export` refusal leaves an empty dir,
   and a deploy of that is the #1669 empty-site shape):
   ```sh
   S=$HOME/work/chaoskosmos-site; R=$HOME/work/agent-workforce; HOST=https://installkosmos.com
   git -C "$S" commit dist/latest.json -m "promote <V> to prod" && git -C "$S" push origin HEAD:refs/heads/main
   bash <<'DEPLOY'
   set -eu
   S=$HOME/work/chaoskosmos-site; R=$HOME/work/agent-workforce
   . "$R/tools/lib/site-deploy.sh"; . "$R/tools/lib/pkg-inputs.sh"
   EXPORT=$(mktemp -d)
   site_deploy_export "$S" "$EXPORT" "$(git -C "$S" rev-parse HEAD)" || { rm -rf "$EXPORT"; echo "export failed"; exit 1; }
   # the .vercelignore guard, exactly as release.sh step 8 runs it (a missing/bad .vercelignore lets
   # Vercel fall back to the site .gitignore and DROP dist/*.pkg):
   drop=$(pkg_upload_filter_excludes "$EXPORT/.vercelignore") || { rm -rf "$EXPORT"; echo "no .vercelignore in export"; exit 1; }
   [ -z "$drop" ] || { rm -rf "$EXPORT"; echo ".vercelignore would drop: $drop"; exit 1; }
   # honest-marker: the export must carry the pointer + the release marker (and the artifacts it globbed)
   [ -f "$EXPORT/dist/latest.json" ] && [ -f "$EXPORT/.kosmos-release-export" ] || { rm -rf "$EXPORT"; echo "export missing pointer/marker"; exit 1; }
   ( cd "$EXPORT" && vercel deploy --prod --yes ) && rm -rf "$EXPORT"
   DEPLOY
   ```
   Then **verify SERVED prod BY CONTENT** from outside: `curl $HOST/dist/latest.json` names `<V>`,
   and the DOWNLOADED `kosmos-<V>-arm64.tar.gz` sha matches the pointer. The control that returns the
   dangerous answer is "still `<old V>`" -- confirm it actually flipped. (First run for 0.6.30,
   2026-09-04; the vercel project aliases chaoskosmos.com + installkosmos.com.)
6. **Rollback** = promote a prior staging pointer, or flip `latest.json` back, then re-deploy per
   step 5. No rebuild.

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
