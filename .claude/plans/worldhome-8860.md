# worldhome-8860: a throwaway board's agents get their own launchd label scope (kosmos#8860)

Assigned by Splinter 11-21 14:41 after the 0.8.13 staging walk (#8810) found that a throwaway board's agents load
real `com.kosmos.agent.<name>` jobs in the account's one launchd domain, beside the real board's.

## The change
- `engine/create.js` `launchScope(worldId)`: the key a launchd label is built from.
  - A named world: its own id, unchanged (#1704).
  - The default world: `default` (bare labels, today's) unless ALL of: the platform is macOS (Linux units and
    Windows tasks stay keyed by the world, and so do their readers); run() is really live (the live-execution gate
    is open AND no runner seam is installed); and the agent job folder (`agentsDir()`) is not the account's real
    `~/Library/LaunchAgents` (from `os.userInfo().homedir`, not HOME). Then `launch-<first 8 hex of sha256(folder)>`.
  - Folders are compared and hashed in their on-disk spelling (`canonicalDir`: realpath, or the nearest existing
    parent plus the rest), so a symlinked or differently cased path to the real folder is never scoped, and a
    throwaway folder's label does not change when the folder is first created.
  - An unreadable account record keeps `default`: renaming a real board's jobs would orphan them.
  - `setLaunchScopeForTests` forces the scope, because any runner turns scoping off and the readers can only be
    tested through a runner. Excused in `engine.reachable.test.js`.
- `serviceLabel` builds on `launchScope`. The three places that read labels back into "this board's agents" compare
  with `launchScope()` instead of `currentWorldId()`: `nameInThisWorld` (create.js, the launchd fleet probes),
  `createdroster` (the created-never-run roster) and `register` (the reconcile listing).

## Decisions
- **A label scope, not a derived KOSMOS_WORLD** (the card's first recommendation, rejected while building): a named
  world nests the store roots (`worlds.applyWorldEnv`, `applyAgentWorldEnv` on the agent side), so a derived world
  would move a throwaway board's data and change what a walk tests. Only the launchd label is shared machine-wide
  with the real board here; tmux sessions sit on the throwaway's own socket in the walk recipe.
- **Keyed on the job folder**, because `AGENT_WORKFORCE_LAUNCH` already moves where the plist is written but not the
  label it registers under (the #1539 shape). HOME alone moves the folder too (`agentsDir` uses `os.homedir()`), so
  the real folder is read from the account record.
- **Only while run() is really live.** Rejected: scoping every non-real folder. That renamed labels in 25 existing
  tests whose temporary folder stands in for the real board's (measured), and 7 more in worldstarts.test.js that arm
  the gate but install a runner. A label can only collide in launchd when it reaches launchd.
- Not changed: Linux units (`linuxjob`), Windows tasks, tmux session names. Same class on those platforms is a
  follow-up if a throwaway board ever runs there beside a real one.

## Tests
- `engine/launchscope-8860.test.js`: control (the real folder, by AGENT_WORKFORCE_LAUNCH and by HOME, keeps
  `com.kosmos.agent.ava`); a throwaway folder gets `ava+launch-<8 hex>`, never the real label, and parses back into
  its own scope; HOME-only throwaway is scoped; two folders differ, one is stable; a named world is unchanged;
  control: a dry run keeps the bare label.
- `engine/launchscope-8860.test.js` also: Linux keeps the bare key; a symlink to the real folder keeps it (skipped
  where the account has no ~/Library/LaunchAgents); a folder's label is the same before and after it is created; the
  launchd fleet probes (`runningJobs`, `disabledJobs`) read only this board's scope, control both ways.
- `engine/createdroster.test.js`: a throwaway board rosters its own scoped job and drops the real board's bare one;
  control the other way.
- `engine/register.test.js`: the stray survey sees only this board's scope's jobs, control both ways.
- Mutants, each red: no runner check (worldstarts 3), no gate check (launchscope 1), the old label rule (launchscope 3),
  the old roster comparison (createdroster 1), the old register comparison (register 1), the probes on the world
  (launchscope 1), no platform check (launchscope 1), a lexical folder compare (launchscope 1).
- The 44 test files that name a label or read the roster: 1535 tests, 0 failed.

## Weakest premise
A label now depends on process state (the gate, a runner, the platform, the job folder), so anything that caches or
persists a label must have been made in the same state it is read in. In particular, nothing must build a label for
this board before `allowLiveExecution()` runs in `start()`. Read: the sweeps before it
run on timers, and requests that arrive before it would see bare labels, but nothing can reach launchd before the
gate opens either. A board whose label is built in that window and cached would mix the two.

## Upgrade
A throwaway board started before this change has bare-label jobs; after the change it reads them as another board's.
Its removed-agent records also carry bare labels, so `reapplyRemovedDisables` (remove.js) no longer matches them and
does not re-apply their disable. Accepted: throwaway boards are torn down, not upgraded. Tear such a board down with
the old procedure (stop it, then `launchctl remove`). Real boards are unchanged.
