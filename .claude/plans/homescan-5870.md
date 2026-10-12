# #5870: the token-only guard reads each config home's files once per pass

## The gap
#5774 route 5 added other agents' config homes outside ~/.claude* to the homes the guard covers. The job LIST was read once per pass (launchCache), but what is read for each home was not: `startcommands.startCommandScripts` re-read every home's settings tiers, plugin records, marketplace files and each installed plugin's config files for every token-only agent, on every refresh and every per-tick check. N homes and M agents meant N x M scans per tick. Nothing pays for it on this fleet today (every account lives in ~/.claude-*); correctness was never affected.

## The change
- `engine/startcommands.js`: `cachedReaders(cache)` memoises `readJsonFile` and `readPlistFile` in a pass's cache, keyed by the file's resolved path. `startCommandScripts` takes `readCache`, and every read in it goes through the reader: the config sources, `installedPlugins`, `known_marketplaces.json`, each marketplace's `marketplace.json`, and `pluginConfigFiles` (which now takes the reader too).
- `engine/setup-assistant.js`: passes `deps.launchCache` (the Map refreshTokenOnlyGuards and agentevents.guarded already share per pass) as `readCache`.

## Decisions
- Cache the READS, not the results. What a home's files say does not depend on the agent; how their commands are interpreted does (the agent's folder is the hooks' working folder and `CLAUDE_PROJECT_DIR`, and the merged settings env includes the agent's own tiers). Caching whole results per home would have needed every agent-dependent input in the key; caching reads needs only the path. Rejected: caching `startCommandScripts` per home.
- Per pass, by design: a new pass is a new Map, so a change between passes is seen. Within one pass (seconds) a file changed between two agents' reads is read once: the same as one agent reading it a moment earlier.
- What is cached is deep-frozen, ITERATIVELY (review 3: a recursive freeze overflowed on a file nested ~12,000 deep, outside every per-file try, and lost the agent's whole scan). Today no reader changes a parsed file (checked); a later one that did would otherwise change it for every agent after it in the pass, silently. Frozen, it throws (the module is strict): inside one config's commands that names the config, anywhere else it loses the agent's whole scan (fails closed, with the error text). A freeze that still threw would leave the read fresh and uncached.
- A FAILED read is never cached (review 1): a torn write, EACCES or EMFILE is read again by the next agent. Cached, one torn read of a file Claude Code rewrites constantly (.claude.json) would make every agent in the pass not whole. A good read and a missing file are kept.
- A tier the guard itself rewrites in the pass (an agent folder's own settings, `rewritten`) is never cached (review 2), so no later scan in the pass could see it from before the rewrite.
- With no cache (a caller that passes none), reads are fresh and unfrozen, exactly as before.
- Weakest premise: that nothing downstream mutates the parsed JSON. The guard set (986 tests) passes with every cached read frozen, which would have thrown on any mutation those tests reach.

## Gaps, stated
- The rewritten-tier bypass covers the scanning agent's OWN folder. If agent folders were ever nested (A's folder above B's), A's settings would be a cached tier for B, which A's rewrite could change mid-pass. Nothing nests agent folders, and the guard's rewrite keeps every command-bearing key, so the scan result could not change even then (review 4).
- Two spellings of one file are read twice (the key is the resolved path, not the real one): one extra read, never a wrong answer.

## Not done (the card's related note)
- agentevents' per-tick check still passes no accountConfigDir (its configUnsafe is not trusted; commented in route 5). A separate small change.

## Tests
`engine/homescan-5870.test.js` (6; the fourth since review 1, the fifth since review 2, the sixth since review 3):
- one pass over two agents reads the other home's plugin record once, and a plugin's hooks.json once, while both agents still get the hook's script denied; the control (no shared cache) reads it once per agent, so the counter can see a second read;
- a change to the home between passes is seen, and (control) the same pass's cache still holds the old read;
- a cached read is deep-frozen and throws on a write; an uncached read is not frozen.
Mutations red: the cache not passed from setup-assistant (2 tests), the memo disabled (3), the freeze removed (1).

## Challenge loop notes
- Iteration 1 (Opus), on 7645954a: no BLOCKER. The reviewer checked every consumer of a parsed file and found none that writes to it; and that a pass's Map cannot outlive the pass (agentevents makes one per tick, refreshTokenOnlyGuards one per call, create.js passes none).
  - [WARNING] FIXED. Failed reads were cached, so one torn read (most likely .claude.json, rewritten by every running session) would be handed to every later agent in the pass and make each not whole at board start. Only good reads and missing files are kept now. Tested (a torn file, then whole, read again in the same pass; a good read and a missing file kept); mutation red.
  - [NIT] FIXED (comment): where a TypeError from a frozen read surfaces (an unreadable config, named), so a "could not be read" on a file that reads fine is traced here.
  - [NIT] FIXED in part: known_marketplaces.json is counted (read once in a two-agent pass). The plist reader (managed preferences) is not counted: it goes through the same memo, and a hermetic plutil read is not worth a fixture.
  - [NIT] not taken: two spellings of one file are read twice (one extra read, never wrong; as the guard keys elsewhere).
- Iteration 2 (Sonnet), on 4ec80bc7: no BLOCKER.
  - [WARNING, a hazard, not wrong today] FIXED. An agent folder's own settings (a tier the guard rewrites during the pass) was cached like any read; no later scan reads another agent's folder today, but if one ever did it would see the file from before the rewrite. Rewritten tiers now bypass the cache. Tested, with a control that a home tier IS cached in the same pass; mutation red.
  - [NIT] DUPLICATE: two spellings read twice (stated). [NIT] not taken: test 2 restores the shared settings in a finally (as written); the plist path is untested (stated).
- Iteration 3 (Opus), on 0924fa89: no BLOCKER.
  - [WARNING] FIXED (measured by the reviewer both ways). The recursive deepFreeze overflowed the stack on a config nested ~12,000 deep (JSON.parse takes it), outside every per-file try: the agent's whole scan was lost and the guard written with no script denies (fails closed, but one file's gap became every script's; the agent can write such a .mcp.json into its own folder). Uncached, only that file was named. The freeze is iterative now, and a freeze that still threw leaves the read uncached. Tested: the same files and the same named gaps with and without the cache, the deep file named; mutation (the recursive freeze back) red.
  - [NIT] FIXED: the comment no longer says a TypeError always lands in a per-config try; it says which do and that the rest lose the whole scan.
  - [NIT] PARTLY TAKEN: the review-3 test runs the cached path through startCommandScripts against the uncached one. A reader that mutates a cached object is not exercised through the scan (none exists to exercise).
- Iteration 4 (Sonnet), on 6b997012: no BLOCKER, nothing new above NIT. CONVERGED.
  - [WARNING, cannot bite today, no change asked] STATED (Gaps): nested agent folders would make one agent's rewritten tier a cached tier for another; the rewrite keeps every command-bearing key, so the scan result could not differ.
  - [NIT] DUPLICATE: two spellings read twice (stated). [NIT] not taken: test 5 covers the own folder only (the nested case is the stated gap); the iterative freeze holds a wide array's values twice, transiently.

