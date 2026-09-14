# win32-trust-board-card-3013 — pre-challenge proof (Addresses #3013)

Branch `win32-trust-board-card-3013`; merge-base `b7907c3e36b011a267dd5517874cab532d9d535b` (origin/main).
Head `80fb83f35ecf5807a6e824e9b0558e6b6a8f76da`.

## diff_hash

    git diff b7907c3e..HEAD -- . ':(exclude).claude/plans/win32-trust-board-card-3013-proof-*.md' | sha256sum
    => d4a7039bafbad5a7d1f0cb038735204a31cc9528fbbb7a4b8aafa85b82d44dcb

(Excludes this proof file so the hash is stable across committing it. Merge-base above.)

## What #3013 does

Surfaces the #2281 workspace-trust-hang diagnostic on the board card. A Windows agent that
spawned but hung at Claude Code's invisible workspace-trust prompt never registers, so it has
no live pane and no `win32sessions` record; `register.survey()` still lists its Scheduled Task,
so the board's offline builder rendered it as a misleading "Not running" / "Can't tell". The
new `engine/win32trustcard.diagnose(name)` reuses the exact two signals the supervisor
composes — `win32trustwait` (the lone-`.key` detector) and `trust.folderTrusted` (the positive
signal) — plus the task's own enabled flag, to turn that offline row into an accurate
"Waiting on a trust prompt" card (`state: needs_trust`, `needsTrust: true`, the supervisor's
`because`). No re-detection.

## Convergence across 3 review rounds

- **Round 1 (perf, #2717-class):** the first cut called a fleet-level `waiting()` that, per
  offline enabled agent per 5s poll, spawned the uncached `win32job.taskEnabled` + raw
  `taskSpec` (two identical `/Query /XML`) plus a second `claude agents --json` — the verbatim
  #2717 regression (main spawns 0). Fixed: per-agent `diagnose(name)` called from the offline
  builder, which already owns the fleet facts (not-live via the roster it holds; the fleet job
  list via `register.survey`). `diagnose` reads config only through `win32job.cachedTaskSpec`
  (the process-lifetime #2717 cache) and runs no live query → zero per-agent per-poll spawns.
  Dropped the discarded engine `needsTrust` boolean (returns `{because}` only).
- **Round 2 (correctness):** round-1 gated on `create.disabledJobs()`, which is darwin-only
  (`process.getuid` undefined on Windows → throws → empty Set), so the enabled gate was dead
  on win32 and a switched-off agent could render `needs_trust`. Fixed: `taskSpec` now carries
  the task's `<Settings><Enabled>` (parsed via the shared `enabledFromTaskXml` — one
  derivation), so `cachedTaskSpec` yields config AND a locale-safe enabled flag in one cached
  read; `disable()`/`enable()` bust the spec cache so the flag stays fresh across a flip;
  `diagnose` requires `enabled === true` (fails closed on an unreadable flag). No new spawn
  (`cachedTaskSpec` is the read `diagnose` already makes). The fleet-`list()` route was
  rejected: `list()` is a CSV query, and a fleet-wide XML query is an untested schtasks output
  shape unverifiable against the live box.
- **Round 3 (converged):** absent-`<Enabled>` = enabled (schema default, the shape Windows
  emits for an enabled task) confirmed end-to-end; fail-closed and locale-safe confirmed; no
  #2717 regression (spawn-shape control). Two test-only arms added (absent-Enabled diagnosed;
  `enable()` freshness).

## The 3 folded-in #2281 review items

- (a) `win32trustwait.sessionsDir(null)` mirrors `trust.defaultAgentSettings` — ignores the
  engine's own `CLAUDE_CONFIG_DIR` (a default-account agent launches with it deleted and reads
  `~/.claude/sessions`); load-bearing now the card asks about default-account agents.
- (b) control test for the float-ms age clamp in `stuckSessions` (a future-dated `.key` counts
  at `olderThanMs:0`, not under a positive threshold).
- (c) `trust.folderTrusted` default-account arm (`agentDefaultAccount:true`, no configDir →
  `defaultAgentConfig()`).

## Tests

- `engine/win32trustcard.test.js` — `diagnose` over seams: untrusted+stuck→strong; null→hedged;
  trusted→null; no-detector→null; switched-off→null; unreadable-enabled→null; default-account
  classification; two SPAWN-SHAPE arms (only `cachedTaskSpec`, never uncached `taskEnabled`/
  `taskSpec`/`list`; no live seam).
- `engine/win32trustcard.enabled-3013.test.js` — RUNTIME, real win32job task-XML parse
  (`setRunner`) + real `trust` + real `win32trustwait`: enabled+stuck→diagnosed;
  switched-off→null; absent-`<Enabled>`→diagnosed; `disable()`/`enable()` bust the cache.
- `web.trust-wait-card-3013.test.js` — DOM-level `card()`/`lrow()` render (cards from
  `test-support/fleet`, augmented): needs_trust treatment, seven-column row, label single-source.
- `server.trust-wait-offline-3013.test.js` — static call-site guards (diagnose win32-gated; no
  `waiting()`/`defaultRun()`; not gated on darwin-only `switchedOff`; `needsTrust` in the page).
- `engine/win32trustwait.test.js` — folded (a)+(b) + `dirWaiting`.
- `engine/trust.folder-trusted-2281.test.js` — folded (c).
- `web.avatarver-2762.test.js` — avatar-URL count pin 18→19 (the new lrow avatar, bare/innerHTML-per-poll).

## Revert (mutation) controls — all go red (hand-edited, restored)

- enabled gate (`if(read.enabled!==true)`→`if(false)`) → 4 tests incl. the runtime switched-off case.
- spawn-shape (diagnose→uncached `taskSpec`+`taskEnabled`) → both spawn-shape arms.
- detector gate (`if(!detected)`→`if(false)`) → `no stuck .key`.
- sessionsDir (a) (re-add `CLAUDE_CONFIG_DIR` arm) → the item-(a) test.
- card render (`card()` needs_trust branch→`if(false)`) → 4 render arms.

## Full suite comparison vs origin/main (b7907c3e)

Ran the canonical set (`node --test "engine/*.test.js" "*.test.js"`, runtime node, schtasks-guard
preload, scratch APPDATA/LOCALAPPDATA) on branch and on origin/main. Branch 7499 tests / 909 fail
/ 6582 pass; baseline 7464 / 909 / 6547 (branch +35 pass = new arms). **Failing-name sets
byte-identical (908 unique each) — zero new, zero gone.** Reason parity confirmed on the one
harness extracting the changed `card`/`lrow` (`web.not-running`): identical `TypeError …reading
'find'` on both (its sh-tmux server fixture can't build on Windows; the render arms never run).
The 908 pre-existing failures are Windows-box/environment (sh stubs, real-schtasks fixtures).

## Gates & safety

- Browser-check #1720 (coarse) exit 0 (`Browser-check:` trailer); #2518 (surface) exit 0
  (`Browser-check-surface: render-dm-badges-2863.js …`).
- `/api/status` inventory: the new `needsTrust` field is referenced in `web/index.html`
  (statically verified) — no `UNREAD_ON_PURPOSE` entry needed.
- Block log empty across every run — 0 schtasks calls; no real Task Scheduler / live-agent /
  `\Kosmos\*` / port-16180 contact (win32job refuses in test processes; all tests use seams).

## Known limits (also in the PR body)

Account-level attribution: `win32trustwait.dirWaiting` scans the account's sessions dir, which
several agents can share (esp. the default account), so a still-starting agent Y whose folder is
untrusted can be flagged off agent X's older lone `.key`. Directionally correct (Y flagged only
when Y's own folder is untrusted, i.e. Y would hang too); true per-agent attribution needs the
child pid, which the board lacks for an unregistered agent.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Anwz2k5SbPCSy3yNnPQEok
