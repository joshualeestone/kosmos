# Plan: worlds-boot-sandbox-2628 -- a board can boot into a named world

Card: #2628, and #2528's "switch Kosmos, the restart errors, I'm back in Kosmos 1".
worlds-abandon-visible-2628 parked the root cause as needs-operator; this is that
root cause. The multi-Kosmos lane is Angel's, so she reviews.

## The defect (measured 2026-09-11, Windows box; cross-platform by code)

- server.js line ~39 bootstraps the active world: `bootstrapWorldEnv(process.env)`
  writes a named world's AGENT_WORKFORCE_DATA, _PROJECTS and _WORKERS into
  process.env.
- server.js line ~320 then runs the #634 guard: `sandbox.audit(process.env)`.
  - It sees three of the four roots set, while AGENT_WORKFORCE_LAUNCH and tmux are
    live, as they are for every world.
  - That is `partial`, so the board prints "Kosmos will not start half-sandboxed"
    and calls exit 2.
- worldbootguard's never-served fast path abandons the world on that first failed
  boot and resets the pointer, so the next boot lands on Kosmos 1.
- **Evidence:**
  - A live switch on the Windows box: board-restart.log shows "attempt 1 did not
    leave the board running", then a successful second start on Kosmos 1, with
    activeWorldId reset to default.
  - Sandboxed boots of main `03b99146` and of branch `world-agents-identity-1704`,
    each with a named world active, both print the refusal right after
    "#1704: booting into a named world".
- `sandbox.audit` has no platform input, so macOS is affected the same way.

## The change

The guard audits `LAUNCH_ENV_OVERRIDES` instead of `process.env`. That is the
launch's own PORT and AGENT_WORKFORCE_* variables, which server.js already copies
BEFORE the world bootstrap for the Windows hand-off's identical reason. The audit
reads only AGENT_WORKFORCE_* keys (the four roots, TMUX_BIN and HALF_SANDBOX_OK),
so the copy holds everything it needs.

- A real half-sandbox sets those variables at launch, so it is still refused.
  #634's protection is unchanged.
- An unsandboxed launch into a named world now boots.

Not touched: `boardauth.fullySandboxed` also calls `sandbox.audit`, but only to
answer "is this board FULLY sandboxed". For a named world that is correctly false,
so the token stays enforced.

## Interaction with #2849 (merged 2026-09-11 22:40Z)

#2849 refuses agent spawn (create, team, connect-agent, restore, register) while
the board is booted into a named world. That is #2827's direction 1, as an interim
guard.

- Before this fix, #2849 was unreachable, because no named world could boot.
- After it, a named world opens and serves its data, and spawning is cleanly
  refused. That is the safe interim state.
- The full named-world agents chain (PR #2845 plus Angel's PR1m) lifts #2849's
  guard in its final slice.

## Tests (`server.world-boot-sandbox-2628.test.js`)

- **CONTROL:** in this exact setup, `sandbox.audit` of the launch env is not
  partial, while `sandbox.audit` of the env AFTER `applyActiveWorldEnv` IS partial.
  That proves the test exercises the defect.
- **A real board in a child process:**
  - its own temp home, HOME / USERPROFILE / APPDATA / LOCALAPPDATA /
    AGENT_WORKFORCE_HOME, so no real root is reachable;
  - tmux stubbed (`test-support/fake-tmux.sh`);
  - the Claude config sandboxed;
  - PORT 0;
  - a named world active in its registry.

  It must reach `Kosmos on http://...` and answer GET / with `x-kosmos-board`
  ending `@<world>`.
- **Red without the fix:** run against main, the board exits 2 with the refusal.

## Validation (Windows box)

- `server.world-boot-sandbox-2628.test.js`: 2/2 with the fix.
- The same file against unfixed code (a detached tree at fbe246e0, with the
  identical audit): the CONTROL passes and the boot test FAILS, with "the board
  exited 2 before listening ... Kosmos will not start half-sandboxed". So the test
  is discriminating.
- Neighbouring suites were run: sandbox, worldenv*, worldbootguard*,
  named-world-spawn-2827, worldenv-order, board-identity-header-570,
  openai-subscription-2338, forget-claude-1659, connections-refresh-1649,
  claude-apikey-2420, reachable and one-derivation.
  - 13 failures, all in connections-refresh-1649, forget-claude-1659 and
    claude-apikey-2420.
  - They are IDENTICAL on main `718c72b8`, without this change: the same 13 names,
    all tmux/plist-assuming tests that do not run on Windows.
- macOS CI is the gate.

## Review log

- **Round 1 (opus).** It found no problem with the audit change, and #634 is
  preserved. It checked every half-sandbox shape, the in-process path and the
  test's isolation. Findings:
  - [BUG] Now that a named world can boot, the Windows boot path derived MACHINE
    paths from the post-world env. `win32board.ensureInstalled` / `install` /
    `claimed` / `claim` / `restart` all use `anchorDirFor`, and
    `win32anchor.anchorDir` honours AGENT_WORKFORCE_DATA. On an installed zip, that
    means three things:
    - the logon task is re-registered against a runtime copied under the world;
    - a claim file is read from the world, so a task the person removed would be
      re-created;
    - a restart from a named world (the switch back) logs into a missing folder.

    Fixed:
    - `worldenv` captures the environment exactly as launched (`launchEnv()`,
      frozen, taken before any override);
    - `win32board.machineEnv(o)` defaults every machine path to it (an explicit
      `env` still wins, and before a boot it is process.env, as before);
    - `engine/win32board.world-2628.test.js` boots a named world the way server.js
      does and pins `anchorDirFor`, `install`'s anchor env and `launchEnv`, with a
      control showing the world env would move them.
    - PR #2845's marker-aware `anchorDir` fixes the same class another way; the two
      agree, and this branch must be safe on its own because it may merge first.
  - [SECURITY, low, pre-existing] The token guard read the post-world env while
    the boot guard now reads the launch env. `boardauth.enforced` now reads
    `LAUNCH_ENV_OVERRIDES` too, so there is one input for both. The boot test now
    also asserts that a named world's board answers 403 without its token.
  - [NIT] "Set AGENT_WORKFORCE_LAUNCH in the test" was NOT taken as written:
    LAUNCH is one of #634's four roots, so setting it alone makes the launch itself
    half-sandboxed and the board would refuse. `AGENT_WORKFORCE_DRY_RUN=1` was
    added instead, and the reason is in the test.
- **Between rounds (merge-order hazard, found by us).** The new board-world test's
  control assumed a post-world env always moves the anchor. With PR #2845 in, its
  marker-aware `anchorDir` maps a world env back to the launch roots, so the
  control went vacuous and failed in a combined tree. Both env comparisons now use
  the post-world env with the #2845 marker stripped (`worldOnlyEnv`), so the tests
  hold whichever PR lands first. Verified in both trees:
  - this branch alone: 38/38;
  - #2845 plus this branch: 179/180, with the one failure the known Windows
    baseline (`worlds.registry-1704`).
- **Round 2 (sonnet): no bug.** It verified that `launchEnv` is frozen before any
  override (the abandon path included), that `machineEnv` is used by
  `anchorDirFor`, `install` and `restart`, and that `LAUNCH_ENV_OVERRIDES` is
  captured with nothing in between. Its two [NIT]s:
  - `startedByTask` still reads process.env. Left as is: its one key
    (`KOSMOS_WIN32_BOARD_TASK`) is never a world root, so the two envs always agree
    on it.
  - The `machineEnv` comment wrongly cited the detached restart helper as having
    the launch env; it inherits the board's post-world env. Corrected: the comment
    now says it is safe only because it derives no machine path, and that anything
    added to it must be handed the launch env.

  Converged.
