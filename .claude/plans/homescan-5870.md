# #5870: the token-only guard reads each config home's files once per pass

## The gap
#5774 route 5 added other agents' config homes outside ~/.claude* to the homes the guard covers. The job LIST was read once per pass (launchCache), but what is read for each home was not: `startcommands.startCommandScripts` re-read every home's settings tiers, plugin records, marketplace files and each installed plugin's config files for every token-only agent, on every refresh and every per-tick check. N homes and M agents meant N x M scans per tick. Nothing pays for it on this fleet today (every account lives in ~/.claude-*); correctness was never affected.

## The change
- `engine/startcommands.js`: `cachedReaders(cache)` memoises `readJsonFile` and `readPlistFile` in a pass's cache, keyed by the file's resolved path. `startCommandScripts` takes `readCache`, and every read in it goes through the reader: the config sources, `installedPlugins`, `known_marketplaces.json`, each marketplace's `marketplace.json`, and `pluginConfigFiles` (which now takes the reader too).
- `engine/setup-assistant.js`: passes `deps.launchCache` (the Map refreshTokenOnlyGuards and agentevents.guarded already share per pass) as `readCache`.

## Decisions
- Cache the READS, not the results. What a home's files say does not depend on the agent; how their commands are interpreted does (the agent's folder is the hooks' working folder and `CLAUDE_PROJECT_DIR`, and the merged settings env includes the agent's own tiers). Caching whole results per home would have needed every agent-dependent input in the key; caching reads needs only the path. Rejected: caching `startCommandScripts` per home.
- Per pass, by design: a new pass is a new Map, so a change between passes is seen. Within one pass (seconds) a file changed between two agents' reads is read once: the same as one agent reading it a moment earlier.
- What is cached is deep-frozen. Today no reader changes a parsed file (checked); a later one that did would otherwise change it for every agent after it in the pass, silently. Frozen, it throws (the module is strict).
- With no cache (a caller that passes none), reads are fresh and unfrozen, exactly as before.
- Weakest premise: that nothing downstream mutates the parsed JSON. The guard set (986 tests) passes with every cached read frozen, which would have thrown on any mutation those tests reach.

## Not done (the card's related note)
- agentevents' per-tick check still passes no accountConfigDir (its configUnsafe is not trusted; commented in route 5). A separate small change.

## Tests
`engine/homescan-5870.test.js` (3):
- one pass over two agents reads the other home's plugin record once, and a plugin's hooks.json once, while both agents still get the hook's script denied; the control (no shared cache) reads it once per agent, so the counter can see a second read;
- a change to the home between passes is seen, and (control) the same pass's cache still holds the old read;
- a cached read is deep-frozen and throws on a write; an uncached read is not frozen.
Mutations red: the cache not passed from setup-assistant (2 tests), the memo disabled (3), the freeze removed (1).

## Challenge loop notes
