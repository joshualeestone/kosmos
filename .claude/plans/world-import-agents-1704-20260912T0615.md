# Plan: importing agents into a Kosmos (kosmos#1704 PR4, #2563)

Branch `world-import-agents-1704`, from main `e1e91030` (which carries PR3, #2877).
Parent plan: `.claude/plans/world-agents-1704-20260911T2145.md` §6 and §8 "PR4".

## What Josh asked for (verbatim)

> "when I go to create a new KOSMOS, I have the ability to click. In there when I'm
> creating the new KOSMOS, I can add agents to it that are my existing agents from
> another KOSMOS right there when I create it. Or I can just skip and not add any. I
> can always get back to that pane if I go to the little settings cog next to that
> particular KOSMOS and add agents from another KOSMOS"

He confirmed this shape:
- At New Kosmos: an optional step to pick existing agents from any other Kosmos,
  one agent at a time, or to skip.
- A settings cog next to EVERY Kosmos in the switcher, opening the same "add agents
  from another Kosmos" pane.
- An import is a complete copy (profile, avatar, brief) into the target's own
  store. The working `dir` is stripped, and the copy gets its own folder. The
  source is untouched. World-keyed launch identity keeps the copy apart from the
  source.
- Imported agents start when their Kosmos opens: at once if it is the open one,
  otherwise when that Kosmos's board boots. The start reuses #2877's worldstarts
  path and stays behind #2849's `namedWorldSpawnRefusal`. Until that guard is lifted,
  an import into a named Kosmos is recorded and shown as waiting, with a plain
  sentence. It is never dropped and never let through.

## Verified facts that shape the design

- **A profile holds only `provider`**, from which the runner follows (`openai` means
  codex). The model and the account (configDir) live only in the launch job: the
  plist's ProgramArguments and env on a Mac (`create.readJob`), and the Scheduled
  Task argument line on Windows (`win32argv.specFromArgv`, read back by
  `win32job.configDirFor`). This answers the parent plan's "weakest part". So the
  launch spec is read from the SOURCE's own job at import time and stored on the
  start record. It cannot be read later in the target, which has no job yet.
- **`worlds.js` must not require `create`, `remove` or `worldstarts`.** `worldenv`
  requires `worlds` before any world roots are applied, and those modules freeze
  `store.ROOT` at require. So the copy, which needs `create.briefFilename` and
  `NAME_RE`, lives in a new module that `server.js` requires after `worldenv`.
- **The start record already lives in the booted world's store** (`<store.ROOT>/
  world-starts.json`). For a target that is not booted, the same file name is
  written under `worlds.worldStoreRoot(base, target)`. That path equals
  `store.ROOT` when the target is the booted world, for both the default and a
  named world.
- **Nothing trusts a Claude folder on the Mac adopt path.** `createAgent` trusts at
  birth, `win32launch` trusts at launch, and the Mac supervisor never does. An
  imported folder is new, so the Mac start must trust it first, with the same call
  and arguments `createAgent` uses.
- **The rename modal is not in the Tab-trap table**, and its stops would now be
  dynamic (one checkbox per agent). The trap gains a "every enabled, visible
  control in the dialog" form for it.
- **Baseline on this box:** the 12 affected suites pass 100 of 100 on `e1e91030`.

## Design decisions

1. **One import path, in a new `engine/worldimport.js`.**
   - `importAgents(base, {target, picks})` copies each picked agent completely, or
     refuses it with a sentence.
   - `importableAgents(base, world)` lists a world's agents for the picker: a name,
     a display name, and whether the agent can be offered.
   - `picksFromBody(body, base)` validates a request. The legacy
     `importAgentsFrom:[ids]` maps to "every importable agent of each id".
   - `worlds.importAgents`, the whole-world, first-wins copy that kept `dir`, is
     REMOVED, so there are no longer two import paths. Its tests move to the new
     module. `worlds.js` keeps only pure path helpers: `worldWorkersDir` and
     `worldAvatarsDir` are new, beside `worldStoreRoot` and `worldProfilesDir`.
2. **A complete copy, all or nothing per agent.**
   - The order: a fresh worker folder (mkdir fails if it exists), then the brief
     (`briefFilename(runner)`), then the avatar, then the profile (temp file plus
     rename, never over an existing one), then the start record.
   - Any failure removes what this import wrote for that agent, and only that.
   - The profile goes through `store.stripIdentity`, and `dir` is deleted, so the
     copy uses `<target workers>/<name>`.
   - The source brief is read from the source's recorded `dir` when that is a real,
     absolute, non-link folder (the same rule as `create.agentDirRecorded`, now
     exported as a pure `create.usableRecordedDir`). Otherwise it is read from
     `<source workers>/<name>`.
3. **One derivation for each root.**
   - `store.workersRootFor(env, home)` is the worker-root formula.
     `create.workersDir` and `worlds.worldWorkersDir` both call it. The target's env
     is `preWorldEnv(env)` plus that world's `envOverridesFor`.
   - `store.PROFILES_DIRNAME` and `store.AVATARS_DIRNAME` name the store subfolders
     for `store` and `worlds` alike.
   - `store.avatarPathIn(dir, name)` is the avatar lookup, used by `avatarPath` and
     by the import.
   - `worldstarts.recordFileIn(storeRoot)` builds the start record's path, used by
     `RECORD_FILE` and by the import.
   - `remove.removedNamesIn(storeRoot)` reuses the removed list's own parser, so a
     removed agent in the source is neither offered nor imported.
4. **The launch spec is captured at import.**
   - Mac: `create.readJob(name, worldId)`. `plistPath` already takes a world.
   - Windows: `win32job.taskSpec(name, worldId)`, factored out of `configDirFor`'s
     XML parse. `configDirFor` keeps its cache and its self-check, and now reads
     through it.
   - A job that cannot be read falls back to the runner from `profile.provider`
     with no model or account. That is what `register.repair` does, and
     `installJob`'s `guessed` says so when the agent starts.
5. **The start reuses worldstarts; there is no second mechanism.**
   - An entry `{name, why:'imported', at, from, runner, model?, configDir?}` is
     written into the TARGET's record.
   - `resumeEntries` now starts both `paused` and `imported` entries. For an
     imported entry it trusts a Claude folder, then calls `create.installJob(name,
     {runner, model, configDir, platform})`.
   - An imported entry whose job already exists (a restart after a record write
     failed) takes the paused path: enable, then start.
   - `drainAtBoot` and the no-op switch's `resumePaused` therefore start imports
     too.
   - Importing into the open Kosmos calls `worldstarts.startImported(names,
     { spawnRefusal: namedWorldSpawnRefusal })`, which is `resumeEntries` limited to
     those names and to imported entries.
6. **The #2849 wait is shown, never bypassed.**
   - `namedWorldSpawnRefusal(worldId)` defaults to the booted world, which is what
     every existing caller means.
   - Its refusal gains `waiting`: the plain sentence for a start that is held
     rather than a create that is refused. The sentence is "Agents do not run in a
     named Kosmos yet, so it waits there and starts on its own once they can."
   - The import route asks the SAME function about the target. A named target's
     copies are recorded and listed as `waiting` with that sentence.
   - worldstarts writes `refused.waiting || refused.error` on held entries, one
     sentence for held starts in both cases.
   - `GET /api/worlds/list` returns each world's waiting imports, so the settings
     pane keeps showing them after the import.
7. **Refusals are per agent and person-facing, and nothing is destructive:**
   - the name is taken in the target (a profile, a worker folder or an avatar under
     that key), or it was taken earlier in the same request;
   - the source is unknown;
   - the source is the target;
   - the agent cannot be read (no profile, an unparseable profile, a name outside
     `NAME_RE`, an unreadable brief);
   - the agent was removed from the source.

   An unknown target is a 404 for the whole request.
8. **Routes:**
   - `POST /api/worlds {name, importAgents?:[{from,name}], importAgentsFrom?}`. The
     create never fails because of the import.
   - `POST /api/worlds/import {id, importAgents}`, for the cog. An empty or
     malformed list is a 400, an unknown id is a 404, and nothing added is a 409
     carrying the refusal sentence.
   - Both answer `imported: {copied, refused, started, waiting, later}`.
   - The route composes nothing a second time. The engine gives the sentences.
9. **The live-execution gate.**
   - Copying files and writing the record are data writes, like the import that
     already exists.
   - Every job, session, start or trust write happens inside worldstarts, behind
     `liveExecutionAllowed()`. With it off, the copies are recorded and reported as
     waiting, with the gate's sentence.
   - The resume's refusal sentence is split from the pause's, because "nothing was
     changed" is false once a copy exists.
   - Nothing runs at require.
10. **UI (`web/index.html`).**
    - Josh's wording stays: "New Kosmos", "Add my agents from", and the hint.
    - The import field becomes one group per other Kosmos. A group checkbox reads
      "Client work (2 agents)", as today, and ticks every agent in its group; it
      shows indeterminate when only some are ticked. Beneath it is one labelled
      checkbox per agent.
    - A Skip button, always enabled, clears every tick and moves focus to Create.
    - The cog is on EVERY row, including Kosmos 1. It opens the existing rename
      modal, now "Kosmos settings".
      - The rename section is hidden for the default Kosmos.
      - The same picker lists every other Kosmos.
      - The pane has Skip and "Add agents", with Add disabled until something is
        ticked.
      - A line lists the agents waiting to start here.
      - Close is at the bottom.
    - The outcome sentence is shown in the dialog's alert region.
    - The settings dialog gets a real Tab trap (dynamic stops). Initial focus: the
      name field for a named Kosmos, Close for the default one. Closing returns
      focus to the switcher button.
11. **Browser checks:** `render-world-import-2563.js` (per-agent rows, group select,
    Skip, the posted `importAgents`) and `render-worldrename-1704.js` (a cog on every
    row including Kosmos 1, the settings pane, rename hidden for the default,
    "Add agents" POSTs `/api/worlds/import`).
12. **Docs:**
    - CLAUDE.md "Where to Find Things": add `worldstarts.js`, `worldimport.js` and
      `launchidentity.js`.
    - WINDOWS-ROADMAP.md §5: a note on import.
    - `outbox.js` is not on main, so it gets no row.

## Files

- `engine/worldimport.js` (new).
- Engine: `worlds.js`, `store.js`, `create.js` (`readJob` world param,
  `usableRecordedDir`, `workersDir` via store), `win32job.js` (`taskSpec`),
  `remove.js` (`removedNamesIn`), `worldstarts.js`.
- `server.js`: the routes and `namedWorldSpawnRefusal(worldId)`.
- `web/index.html`, and the two browser checks.
- Docs: CLAUDE.md and WINDOWS-ROADMAP.md.
- Tests, listed below.

## Tests (each must fail when its fix is reverted; a control is run)

**`engine/worldimport.test.js` (new).**
- Copy completeness:
  - the profile arrives minus `id`, `idInstall` and `dir`, with everything else
    kept;
  - the avatar bytes match;
  - the brief matches (CLAUDE.md, and AGENTS.md for codex);
  - the source is byte-for-byte unchanged.
- The brief is found through a recorded `dir`.
- Collisions: a profile, a folder or an avatar already in the target, and a
  duplicate inside one request. Nothing is overwritten.
- Refusals: an unknown source, the same Kosmos, a missing or corrupt profile, a bad
  name, a missing brief, and an agent removed in the source.
- The record is written into the TARGET world's store (not the booted one), with
  the launch spec. That spec is read from the source world's plist, keyed by the
  source world, with a fallback to the profile's provider.
- Rollback: when the record cannot be written, the copy is taken back out.
- The legacy `importAgentsFrom` mapping.

**`engine/worldstarts.test.js` additions.**
- An imported entry is started through `create.installJob` with its runner, model
  and account.
- The Mac arm runs end to end in dry-run and trusts a Claude folder first.
- An existing job goes enable-then-start.
- `startImported` touches only the imported names given.
- `spawnRefusal` holds imported entries with the `waiting` sentence and sends
  nothing.
- Live execution off holds everything and sends nothing.

**`server.world-import-agents-1704.test.js` (new).**
- Validation 400s, an unknown target 404, the same-Kosmos and collision refusals,
  and the 409 when nothing was added.
- Create with `importAgents`.
- An import into the booted Kosmos starts now.
- An import into a named Kosmos that is not open is recorded, waiting, with the
  #2849 sentence.
- Live execution off: copied, recorded, not started, with its sentence.
- `GET /api/worlds/list` carries `agents` and `waiting`.
- The legacy `importAgentsFrom` still works.

**`web.world-import-agents-1704.test.js` (new, runs the shipped functions).**
- The creation step renders groups and per-agent boxes. Select-all and
  indeterminate work.
- Skip clears.
- The payload is `importAgents` only when ticked.
- `worldswRender` puts a cog on every row, including the default.
- Settings hides rename for the default.
- The outcome sentence, and the Tab trap entry.

**Updated suites:**
- `engine.worlds-import-2563.test.js`: `agentCount` stays; the import cases move.
- `server.worlds-import-2563.test.js` and `web.world-import-2563.test.js`: the new
  shapes.
- `one-derivation.test.js`: `startImported` must be handed `namedWorldSpawnRefusal`,
  and `worldimport.js` must not re-derive the named-world rule.
- `server.world-switch-agents-1704.test.js`: the held sentence is now `waiting`.

**Root inventories re-run:** `engine.reachable`, `one-derivation`,
`fixture-discipline`, `server.worldenv-order`, `engine/platform-gate-wiring`. Also
`web.modal-way-out-1316`, whose modal count must not change: no new modal is added.

## As built (notes against the design above)

- **Extra single sources beyond the plan:**
  - `store.profileFileName(name)`: the profile file name, which the import writes
    into another Kosmos. The path itself stays private.
  - `test-support/fake-dom.js`: one fake document for the two web suites that run
    the page's shipped functions.
- **The New Kosmos step closes on its own only when every agent started NOW.** A
  new Kosmos is always a named world, so while #2849 holds, a create with picks
  always ends waiting. The dialog then stays open with the outcome sentence, and
  Cancel reads Done.
- **The settings pane keeps the rename modal's ids.** `world-rename-*` is unchanged
  and the picker is `world-set-*`, so the rename wiring, its Escape and the
  modal-way-out sweep are untouched. No new modal is added: the sweep's count is
  unchanged.

## Validation (Windows box)

- **Baseline.** On `e1e91030`, the 12 affected suites passed 100 of 100.
- **The branch.** The new and updated suites plus the root inventories pass 141 of
  141, and `engine/worldstarts.test.js` passes 33 of 33. The root inventories are
  `engine.reachable`, `one-derivation`, `fixture-discipline`,
  `server.worldenv-order`, `engine/platform-gate-wiring`, `web.modal-way-out-1316`
  and `web.world-switch-agents-1704`.
- **Controls.** 21 perturbations, each reverting one fix, ran against its own tests,
  and all 21 went red. They cover:
  - keeping `dir`;
  - no avatar copy;
  - no collision check;
  - no rollback;
  - the Mac or Windows source spec read in the wrong world;
  - removed agents offered;
  - the first start skipped;
  - the spawn rule ignored;
  - the gate removed;
  - no waiting sentence;
  - a named target not asked the rule;
  - the list dropping the sentence;
  - the default workers ignoring the pre-world env;
  - no cog on Kosmos 1;
  - the payload always sent;
  - Skip a no-op;
  - the Kosmos box a no-op;
  - rename offered for Kosmos 1;
  - no Tab trap;
  - waiting agents closed over.
- **Wider suites that touch the refactored helpers** (`create`, `remove`,
  `win32job`, `store`, `worlds`, `register`, `discover`, `trust`, `server.test`,
  and others): the only failing names not also failing on main are the old #2563
  whole-world import tests, which this branch rewrites.
- **Browser checks.** Playwright is not on this box. Both checks pass
  `node --check`. macOS CI runs them.
- **The full test list** (`engine/*.test.js` plus `*.test.js`): main `e1e91030`
  fails 822 of 6313, all Mac or tmux assumptions. Comparing failing NAMES, the
  first branch run failed three tests that main does not, and all three are fixed:
  - `web.modal-exit-1438`: the settings pane's first `rm-acts` row held only
    "Save name". The rename button row now uses the picker's actions class, so
    the dialog's actions row is the one with Close.
  - `web.open-sentence-1199`: two new inline sentence-capitalizers. Both now go
    through the page's `asSentence`.
  - `engine/windows-coupling-audit-1732`: `store.workersRootFor` joined `home`
    with the ambient `path.join`. It now uses `joinerFor(platform)`, like
    `dataRootFor`, on the running platform by default.
- **A flake.** `engine/commitments.test.js` "a reader never observes a torn record
  while writers are racing" failed once in the full run and passed on rerun. It
  touches nothing here.
- **After the fixes,** the 20 affected and inventory suites pass 200 of 200.

## Weakest part

1. **Nothing can prove a start into a named Kosmos works end to end in this PR.**
   #2849 holds every such start, so that path is exercised only as "held". The
   start that really runs is an import into the open Kosmos 1. Its Mac arm (the
   trust write, `installJob`, launchctl) is proven here only in dry-run, through the
   runner seam. The live start is for macOS CI and a Mac builder. On this box, the
   Windows live check is: import an agent from a named Kosmos into the open Kosmos
   1, and see it start and answer in its board thread.
2. **The brief is copied verbatim.** Its Kosmos-managed project block still names
   the SOURCE Kosmos's project folders, because projects are per Kosmos, until the
   agent is added to a project in the target and the block is re-synced. It is
   stated here as a follow-up, not hidden.
3. **`reportsTo` may name an agent that was not imported.** It is kept, so importing
   the manager too keeps the line, and the org chart shows nobody above them
   otherwise.
4. **`win32job.taskSpec` refactors `configDirFor`'s parse**, which is a safety check
   with a cache. The existing `configDirFor` suites must stay green unchanged.
