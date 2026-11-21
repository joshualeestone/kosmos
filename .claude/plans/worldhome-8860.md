# worldhome-8860: a throwaway board's agents get their own launchd label scope (kosmos#8860)

Assigned by Splinter 11-21 14:41 after the 0.8.13 staging walk (#8810) found that a throwaway board's agents load
real `com.kosmos.agent.<name>` jobs in the account's one launchd domain, beside the real board's.

## The change
- `engine/create.js` `launchScope(worldId)`: the key a launchd label is built from.
  - A named world: its own id, unchanged (#1704).
  - The default world: `default` (bare labels, today's) unless ALL of: the platform is macOS (Linux units and
    Windows tasks stay keyed by the world, and so do their readers); run() is really live (the live-execution gate
    is open, no runner seam is installed, and dry-run is off); the agent job folder (`agentsDir()`) is not the account's real
    `~/Library/LaunchAgents` (from `os.userInfo().homedir`, not HOME); and the folder holds no bare-labelled agent
    job (`folderHasBareJob`). Then `launch-<first 8 hex of sha256(folder)>`.
  - The decision is the pure `launchScopeFor(inputs)`; `launchScope()` gathers the inputs. A test process can never
    be really live (it has a runner, or `setRunner(null)` turned dry-run on), so the arms are tested through it.
  - The bare-job guard keeps bare labels for a folder already holding a bare job: a real board whose HOME is not the
    account record's spelling (it would otherwise rename its jobs and start a second set), a throwaway board made
    before this change, and jobs a tool seeded in another process (docs/browser-checks/mobile-shots.js seeds bare
    plists, then starts a dry-run board).
  - Folders are compared and hashed in their on-disk spelling (`canonicalDir`: realpath, or the nearest existing
    parent plus the rest), so a symlinked or differently cased path to the real folder is never scoped, and a
    throwaway folder's label does not change when the folder is first created.
  - An unreadable account record keeps `default`: renaming a real board's jobs would orphan them.
  - `setLaunchScopeForTests` forces the scope, because any runner turns scoping off and the readers can only be
    tested through a runner. It and `launchScopeFor` are excused in `engine.reachable.test.js`.
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
- `engine/launchscope-8860.test.js`, through `launchScopeFor`: control (the account's folder keeps `default`); a
  throwaway folder is scoped; each arm keeps `default` alone (not live, Linux, Windows, unreadable account, a bare
  job in the folder); a named world is unchanged; two folders differ and one is stable; a folder's scope is the same
  before and after it exists; a symlink to the account's folder is not scoped; a real bare job in the folder keeps
  `default` while a scoped one does not. End to end: this test process (not live) keeps bare labels for a temporary
  folder; a scoped board's serviceLabel / plistPath / parseServiceLabel round-trip; the launchd fleet probes
  (`runningJobs`, `disabledJobs`) read only this board's scope, control both ways.
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

Also known and accepted (review 3):
- Another process acting for a throwaway board that requires create.js without opening the gate (a CLI tool that
  loads the engine) computes bare labels while the board uses scoped ones. Throwaway boards only.
- `install/setup.sh`'s uninstall derives a tmux session name from the label; for a scoped label it misses the session
  (`<name>`, not `<name>+launch-...`), and the sweep after it catches leftovers. Throwaway boards only.
- `launch-<hex>` shares the world-id namespace: a named world called exactly `launch-<8 hex>` would collide with a
  throwaway scope. Theoretical; worlds are named by people.

## Upgrade
A throwaway board started before this change has bare-label jobs; after the change it reads them as another board's.
With the bare-job guard, a folder still holding such a job keeps bare labels, so the old board keeps working as it
did. Once all its bare jobs are gone it scopes, and its old removed-agent records (bare labels) no longer match in
`reapplyRemovedDisables` (remove.js). Accepted: throwaway boards are torn down, not upgraded. Tear such a board down with
the old procedure (stop it, then `launchctl remove`). Real boards are unchanged.
