---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: winroot-570
diff_hash: 23f3d8c4950b5c88e927dd401ce2d22d8595142d8f246bd302e9ce6a07508106
subdir_audit: passed
timestamp: 2026-08-29T19:31:28Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent** (Josh 09:24). Bracketed markers, my #1458.
**Josh's v1 is an unsigned Windows install that comes online. This is step zero
of it and it needs no Windows machine.**

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING] NOBODY HAS RUN THIS ON WINDOWS.** It is a claim about what the code
  computes for `win32`, not a claim about a machine. **The one thing a Mac cannot
  tell me is whether `APPDATA` is populated the way I expect in the environment a
  Kosmos process actually inherits there** (a service, a scheduled task and a
  desktop launch do not all get the same environment).
- **[WARNING] LINUX IS STILL WRONG** and now visibly so: it falls through to the
  Mac path. That is unchanged behaviour, it is not a regression, and there is a
  test whose stated job is to be DELETED by whoever adds the XDG branch.
- **[WARNING] THIS DOES NOT MIGRATE ANYTHING.** Nobody has a Windows install yet,
  so there is nothing to move. **If one is ever created before this ships, it
  needs a migration and this change alone would strand that person's data.**

### CONVENTIONs

- **[CONVENTION]** Em dash sweep 0, planted control 1.
- **[CONVENTION]** No closing keyword: #570 is a whole Windows card and this is
  one file of it.

### NITs

- **[NIT]** `dataRootFor` is exported solely so a test can reach it. That is the
  `set*` seam pattern this codebase already uses, without the `set` prefix
  because it is a query rather than an injection point.

### Attacked and CLEARED

- **THE DEFECT DOES NOT CRASH, WHICH IS THE WHOLE REASON IT NEEDED FINDING.**
  `path.join(homedir(),'Library','Application Support')` on Windows creates a
  real directory. **Nothing throws, nothing warns**, and the data is simply
  somewhere nothing on that computer looks.
- **PURE FUNCTION SO IT IS ASSERTABLE FROM A MAC.** `process.platform` cannot be
  set, so a module reading it directly has Windows behaviour that cannot be
  tested from here. **Unassertable is how this survived.**
- **THE TEST ASSERTS COMPONENTS, NOT A STRING**, because `path.join` emits `/`
  here and `\` there. **A string pin would pass on the Mac and fail on the one
  platform it is about**, which is the same untestability one layer down.
- **THE SANDBOX OVERRIDE IS ITS OWN TEST, ON THREE PLATFORMS.** 17 files honour
  `AGENT_WORKFORCE_DATA`; a platform branch that could beat it would make every
  fixture on a Windows machine write to the operator's real store.
- **`ROOT` IS ASSERTED TO BE BUILT BY THE SAME FUNCTION.** Without it,
  `dataRootFor` could be a correct function nothing calls, **which is a defect I
  shipped twice this week and filed as #1502.**
- **SWEPT FOR OTHER HARDCODED MAC DATA PATHS** across `engine/`, `server.js`,
  `bin/` and `install/`: two hits, both correct (`install/setup.sh` is the Mac
  installer, the other is a comment). The remaining home-relative paths are
  `~/.claude`, `~/.codex` and `~/work/workers`, **which are Claude Code's and
  Codex's own conventions and are the same on Windows.**
- **Suite 2975 pass, 0 fail.**
