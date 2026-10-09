# guardstate-5668: the agent's page says when its token-only guard is not whole or past the sandbox size (kosmos#5668)

Handed over by PigeonPete 2026-10-09 06:26 (his plan: card comment 05:20 CDT). Builds on #5663 (merged as #5676).

## Finished looks like
For an agent listed token-only, its page shows a notice when the last guard run said it is not whole (with the reason) or that its denied paths are past the measured sandbox size (its shell may not run). A guarded agent's page shows nothing new. Creation still succeeds with the size warning. The count includes the user-level settings file the agent's account reads.

## Plan
1. engine/setup-assistant.js:
   - a guard-state record per agent, `store.ROOT/token-only-guard/<name>.json` `{ ok, because?, warning?, at }`, written atomically: temp + rename for a launch and creation, temp + hard link (exclusive) for a board start (reviews 2, 4, 5);
   - written by each launch through the supervisor (a separate process) and at creation; a board start writes only an agent with no line (reviews 3, 4);
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
   - (Design shots: superseded, see Decided.)

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
  - engine/guardstate-5668.test.js (14 tests by review 5; each fix's mutation red);
  - server.tokenguard-5668.test.js (3 tests: route states, no list, the cache re-reads after a write; mutations red);
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

## Review 5 (Opus) and what changed
- **A launch replacing an existing line was untested**, and the whole design depends on it. It is now tested, with a mutation that made every launch exclusive going red.
- **The board-start create was not atomic.** A crash mid-write left a partial file that no later board start could replace. It is now temp + hard link (atomic, EEXIST like an exclusive create). A line that cannot be read is replaced by a board start; a readable one is not (control).
- **Comments and the README said every run writes.** Corrected to say what is true: each launch and creation write, and a board start writes only an agent with no line. This plan's drift is corrected too.
- **Pruning sweeps a temp file a dead writer left**, once it is a minute old (a fresh one may still be in use; control). An empty agent name records nothing.
- **The decision's "what would change it" now names the unmeasured question:** whether Claude Code reloads the file-tool rules mid-session.

## Review 6 (Sonnet) and what changed
- The route's cache is also re-read at least every five seconds, for a filesystem whose mtime is too coarse to see two writes apart. Tested by pinning the folder's mtime to a whole second around an in-place write, with a control that within the cap the cached line is served; removing the cap goes red.
- A board start replacing an unreadable line now removes it and links again, still exclusive, so a launch's line that lands first is kept (mutation red).
- The record's deny rule says, like its siblings, that a data root with a pattern character drops it and the guard then says it is not whole.
- Not changed:
  - a creation that fails leaves a not-whole line until the next board start prunes it, which is harmless: a rolled-back agent has no row on the page;
  - paths in both the agent's settings files are counted once, because sandboxDenySize dedupes within each clause.

## Review 7 (Opus) and what changed
- **The unreadable-line replace could delete a launch's fresh line.** It now reads only that agent's file, and removes it only if it is still the same file (inode). A launch's line renamed in since is a new inode and stays. The residual is a window of microseconds between that check and the removal, which needs a cut-off line to begin with; the comment says so.
- **The admin's managed settings file** (`MANAGED_SETTINGS_PATH`, root-owned, when installed) merges into the same sandbox profile, and now joins the size count (`deps.managedSettingsPath` is a test seam). It is absent on the fleet Mac, and the tests never read the real one.
- **Without hard links** (a filesystem that refuses them), a board start falls back to a rename where there is no line, rather than recording nothing.
- **Windows, decided:** the guard returns "not shown to hold yet" on Windows, so every token-only agent's page there shows the "not complete" notice from the first board start. That is honest: Kosmos does not claim the guard on Windows. To tell Homer on #5664 when this merges.
- The design-shots step is struck; Decided explains why.

## Review 8 (Sonnet) and what changed
- The comment above `sandboxDenySize` (written for #5663) said the user-level files were not counted and pointed at this card. Reworded: its caller passes the merged lists.
- One test of a usable line (`guardLineOf`), shared by the board's read and the board start's replace, so they cannot drift (a loosened validator goes red).
- The no-hard-links rename fallback names its own microsecond window in its comment; it applies only where the filesystem refuses hard links.
- Not an issue: the agent folder's settings.local.json is a separate file, and `cleanLocalSettings` keeps its denies there, not in settings.json. So they are not already in `next.permissions.deny`, and there is no double count.
