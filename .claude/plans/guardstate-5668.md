# guardstate-5668: the agent's page says when its token-only guard is not whole or past the sandbox size (kosmos#5668)

Handed over by PigeonPete 2026-10-09 06:26 (his plan: card comment 05:20 CDT). Builds on #5663 (merged as #5676).

## Finished looks like
For an agent listed token-only, its page shows a notice when the last guard run said it is not whole (with the reason) or that its denied paths are past the measured sandbox size (its shell may not run). A guarded agent's page shows nothing new. Creation still succeeds with the size warning. The count includes the user-level settings file the agent's account reads.

## Plan
1. engine/setup-assistant.js:
   - a guard-state record per agent, `store.ROOT/token-only-guard/<name>.json` `{ ok, because?, warning?, at }`, written atomically (temp + rename) (review 2: one file per agent, not one shared file);
   - written for every agent `refreshTokenOnlyGuards` guards (board start, and each launch through the supervisor, a separate process) and at creation;
   - read by the board, never recomputed per request (a refresh scans the PATH).
2. The size count adds the agent's account's user-level settings file:
   - the folder is the account's config home from the agent's launch job (`create.readJob(name).configDir`), or `~/.claude` when the job names none;
   - its `permissions.deny` and `sandbox.filesystem` lists join the count.
3. server.js `/api/status`: each row of an agent that is token-only carries `tokenGuard: { state: 'notWhole' | 'warning' | 'guarded', because?, warning?, at }` from the record. An agent not listed carries nothing.
4. web/index.html: a notice on the agent page (`#d-tokenguard`), painted in `paintDetailState` like `#d-linklost`, shown for `notWhole` and `warning` only.
5. Tests:
   - engine: the record is written per agent by both callers, and the account file is counted;
   - server: the route carries the field only for listed agents;
   - a browser check renders both notices through the real openDetail, with a control that a guarded agent shows none.
   - Design shots for the page.

## Decided
- A guarded agent shows nothing. The notice is for something the person should act on. A "guarded" line on every token-only agent's page would be noise.
- A listed agent with no record yet (never refreshed since this change) shows nothing. The next board start writes it.
- No design shots. The notice reuses the existing link notice's class and colour token exactly (`fhint`, `--label-2`), in the same place on the page. The browser check reads it on chromium and webkit. What would change it: a reviewer asking to see it.
- The page asks `'tokenGuard' in card` before reading the field, because it is absent for most agents in production as well. The fleet fixture's strict card (which refuses a field the snapshot never emits) agrees.

## Built
- engine/setup-assistant.js:
  - `guardTokenOnlyFolder` now wraps the run (`guardTokenOnlyFolderNow`) and records its result with `recordGuardState`, written atomically with mode 0600. `readGuardState` reads it, and treats anything unreadable or wrong-shaped as none.
  - `accountSettingsLists` reads the account's settings.json and settings.local.json; their deny lists join the size count.
- server.js: `withTokenGuard` on the `/api/status` rows.
- web/index.html: `#d-tokenguard`, painted in `paintDetailState`.
- Tests:
  - engine/guardstate-5668.test.js (4 tests; 9 mutations red);
  - server.tokenguard-5668.test.js (route: not whole, warning, guarded, no record, not listed, no list; 3 mutations red);
  - docs/browser-checks/render-tokenguard-5668.js (gated, README row; 12 arms on both engines; 2 page mutations red).

## Review 1 (Opus) and what changed
- **Creation counted the wrong account.** The agent's launch job is not written when creation runs the guard. Creation now passes the account it is creating the agent on (`accountConfigDir: configDir`); a source pin and a mutation cover it.
- **The agent folder's own settings.local.json was not counted.** Its denies are kept, and they reach the same profile. It now counts. The account side reads only settings.json, the one user-level file Claude Code reads. Both are tested, with mutations.
- **The record was not protected.** An agent could overwrite it to hide its own notice. It is now Edit-denied and sandbox write-denied, as the token-only list is. Tested in both layers.
- **Stale lines.** The board-start refresh drops lines for agents no longer listed; a launch refresh (one agent) does not.
- The default account's file comes from `trust.defaultAgentSettings`, the one derivation of it.
- The browser check renders the combined case: not whole and past the size.

## Review 2 (Sonnet) and what changed
- **The shared record could lose a not-whole line.** It was updated by read-modify-write with no lock, so a launch running beside the board could write an older copy back. The line it would drop is the one that says the guard is not whole, and the page would then show nothing, which reads as guarded. It is now one file per agent in `token-only-guard/`: a run writes only its own agent's file. The folder is Edit-denied (`/**`) and sandbox write-denied. The test shows the shape (another agent's line survives a write), not a staged race.
- **A listed agent with no folder now has its line removed**, so no stale state shows if it comes back.
- Not changed:
  - other rule kinds (Write, Bash) are not counted, as sandboxDenySize documents;
  - the reason text is the person's own machine's paths, shown on their own board;
  - the route reads two small files per poll.

## Review 3 (Opus) and what changed
- **A board start replaced a launch's verdict.** It measures the board's own PATH, not the one the agent was launched with. So after a board restart under a running agent, a launch's "not whole" became "ok" and the notice went. A board-start run now records only an agent with no line yet; a launch (what the running agent has) and creation always record. Tested with a control that a board start records a new agent; two mutations red.
- **The #4491 doc comment on `guardTokenOnlyFolder` had been deleted by my review-1 edit** (its contract and its NOT A BOUNDARY residuals). It is restored verbatim, with one line saying the result is now recorded.
- The default account's file is read only through `trust.defaultAgentSettings`; the test-only `home` branch is gone, so the test runs the production path (mutation red).
- Pruning reads the folder's own listing, so a malformed file for an unlisted agent goes. It also re-reads the list just before it prunes; that re-read is not staged by a test.
- A reason that already ends in a full stop gets no second one (browser-check arm).

## Review 4 (Sonnet) and what changed
- **Decided, not changed: a launch's line stays until the next launch**, even if a board start now reads better or worse. The running agent keeps the PATH it was launched with, and Claude Code built its sandbox profile at that launch. So the launch's reading is what the running agent has, and a fix (or a new problem) takes effect at its next launch, which writes the next line. What would change it: a measurement that Claude Code rebuilds the profile mid-session.
- **The board start's check-then-write left a race.** A launch's line could land in between and be written over. A board-start write is now an exclusive create, so it never replaces a line (mutation red).
- **An empty token-only list prunes nothing.** `tokenOnlyList` reads an unreadable list as empty, and one bad read must not wipe every agent's line; the route shows only listed agents anyway. Tested with a control that a list without the agent prunes it.
- **The route re-reads the record only when its folder changed** (a write is a rename into it, which moves the folder's mtime), not on every poll. Tested; a never-invalidating cache goes red.
- The two comments spliced onto one line are split.
