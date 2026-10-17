# Item 7 (and item 8 decision) -- Windows put-back async conversion (#6231)

Branch `moveputback-6231-item7`, off main `cfb48b047`. Addresses #6231 items 7(-8). Reviewer: Raiden.

## Problem (item 7)

When an account move is STOPPED, every unreached agent is "put back" onto its old account. On
Windows each put-back is three Task Scheduler ops issued through the SYNCHRONOUS `win32job.run()`
(`execFileSync`), and the stop route answers only after the whole per-agent loop finishes. On a large
move that freezes the board thread (the Node event loop) for up to ~60s, which is what the client's
60s abort timer and "the move may already be stopping" message (`web/index.html:27585`,`:27600`) paper
over. The forward restarts already avoid this by running async (`restartAsync` -> `driveAsync`); the
put-back must match.

## Map (do not re-derive; all on origin/main cfb48b047)

Put-back path (`engine/accountmove.js`):
- `putBack(m, a)` @ `:251` -- bookkeeping + one dep call `deps.putBack(a.name, a.from.dir)` @ `:271`;
  re-reads account @ `:263`, staleness compare `now !== a.to.dir` @ `:264`.
- stop loop @ `:292-296` runs `putBack` synchronously per unreached agent; `server.js:13786` answers
  after the loop. `deps.putBack` -> `create.restoreAccount` (`create.js:1717`) -> `rewriteAgentJob`
  (`create.js:1346`, win32 arm `:1369-1418`).
- Three schtasks ops per agent, all via sync `win32job.run()` (`win32job.js:172`, execFileSync `:201`,
  SCHTASKS_TIMEOUT_MS=20000 `:146`):
  1. cachedTaskSpec `/Query /XML` -- `win32job.cachedTaskSpec` (`win32job.js:1037`) via `create.js:1286`,
     reader `readTaskXml` -> run([...'/XML']) @ `win32job.js:962`.
  2. taskEnabled `/Query /XML` (uncached) -- `win32job.taskEnabled` (`win32job.js:1068`) via `create.js:1395`.
  3. install `/Create /F` -- `win32job.install` via `win32RegisterJob` (`create.js:1408`->`:3811`),
     run(['/Create','/F',...]) @ `win32job.js:452`.

Win32 step infra (mine, #6183, merged):
- `win32job.endSteps` @ `:518`, `startSteps` @ `:540`, `runningSteps` @ `:646`; `win32stop.endSteps` @ `:286`.
- `win32StepResult` @ `win32job.js:152` (exported `:1104`); `endedOk` `:493`; `startedOk` `:525`;
  `idAccepts` `:579`; SCHTASKS_TIMEOUT_MS `:146`; TASKKILL_TIMEOUT_MS `win32stop.js:59`.
- Drivers `driveSync` @ `remove.js:313`, `driveAsync` @ `:322` (answerAsync `{exec}`->runAsync `:306`,
  `{sleep}`->timer `:307`); op table `jobOps('win32')` `:605-652` with `steps:` block `:647-651`;
  consumer `restartSteps` `:2156`, dispatcher `act` `:2247` (prefers `ops.steps[k]`); entries
  `restart`->driveSync `:2479`, `restartAsync`->driveAsync `:2522` (ASYNC_RESTART_CAP_MS `:2494`).
- PRESENCE_MEMO `win32job.js:741`, cleared in `run()` on mutating calls `:174` AND up-front in
  `endSteps`/`startSteps` `:519`/`:541` (step path bypasses run(); a put-back step path must clear too).

## Design (item 7)

Convert the put-back's three win32 schtasks ops into async step generators driven off the board thread,
and restructure the stop so the HTTP route answers first, then drives the put-backs with `driveAsync`.

1. New win32 step generators in `win32job.js`, mirroring endSteps/startSteps, for the put-back ops:
   a query step twin (the cachedTaskSpec/taskEnabled `/Query /XML` reads) and an install step twin
   (`/Create /F`). Each yields `{exec:['schtasks.exe',[...],{timeout:SCHTASKS_TIMEOUT_MS}]}` and returns
   via the shared parsers + `win32StepResult`. The mutating install twin clears PRESENCE_MEMO up-front
   (as endSteps/startSteps do); the read-only query twin does not.
2. A step-generator form of the put-back write (the `create.restoreAccount`/`rewriteAgentJob` win32 arm)
   that `yield*`s those twins, so the whole per-agent put-back is one generator. Keep the sync arm intact
   for non-async callers (same dual-path discipline as the restart: sync acts untouched, steps added).
3. Restructure `accountmove.stop()` (`:287`) so it records the move as stopping and ANSWERS, then drives
   the per-unreached-agent put-backs with `driveAsync` off the board thread (bounded by a cap, as
   restartAsync is). The response no longer waits on the put-back loop, and the event loop is never
   frozen because each schtasks spawn is async.

## Item 8 decision: SPLIT into its own follow-up PR

Item 8 (`accountmove.js:165` `to: readNow(name)` forces an uncached `/Query /XML` per agent on the START
path) is coupled to putBack's staleness compare (`:264`) and the default-account `configDir:null` case
(`wrote.account` carries `.dir` but the job's configDir is null), so it is NOT a free-standing one-call
removal. Item 7 is already a large async conversion that itself restructures putBack. Shipping item 8
separately keeps item 7 focused and lets item 8 build on item 7's restructured putBack cleanly. Noted on
#6231. (Liu Kang m5823 criterion: same PR "if it stays small"; it does not.)

## Folded from Raiden's #6243 review (Liu Kang m5831 gates) -- SPLIT to a follow-up (2026-10-17)

These two were ancillary cleanups folded in from a DIFFERENT review (#6243), not the core item-7 async
put-back conversion. On resuming this branch they are being split to their own follow-up PR, alongside
item 8, rather than shipped here. Reasons:

- (2)'s dead-code gate was written against an origin/main that is now ~700 commits behind, and
  `win32job.running()` STILL has a live caller -- `remove.js:627`, the sync win32 `loaded` act -- which is
  reached whenever a win32 restart runs through the SYNC arm (the async-steps arm at `:650` uses
  `runningSteps`, not `running()`). Proving the sync arm is truly unreachable for win32 on CURRENT main is a
  deep, ancillary investigation; getting it wrong silently breaks win32 restart liveness detection. It does
  not belong inside the item-7 PR and must be re-gated against today's code in its own commit.
- (1), the exit-128 async-taskkill test, lives in the win32stop restart path (`win32stop.js:247`), which
  item 7 does not touch -- the put-back re-registers the job (`/Query` + `/Create`), it never taskkills. It
  belongs with (2) in the follow-up, where the `running()`/restart cleanup is.

- (1) Direct test for the async taskkill exit-128 ("already gone"=success) path -- FOLLOW-UP.
- (2) Remove `win32job.running()` + the now-dead sync win32 `loaded` act (`remove.js:627`), re-gated against
  current main, as its own commit -- FOLLOW-UP.

## Contracts #6238 relied on that the answer-first restructure MUST preserve (Liu Kang m5836)

Each is stated here AND pinned by a test.

1. **The move stays running until the LAST put-back settles, not just the current restart.** Today the
   move ends (`running=null`, board freed, Update allowed) when the current restart finishes
   (`accountmove.js:236`). If async put-backs are still writing jobs after that, an Update or board
   restart can land mid-write. `busy()` (`:46`) / `moveHoldsBoard()` must stay true until every put-back
   has settled -- the stop's `driveAsync` put-back batch must keep the move busy the way `restartAsync`
   does. TEST: a slow put-back keeps an Update refused until it is done.
2. **The stop answer no longer carries the final per-agent sentences.** Today the page reads each
   agent's outcome from the stop response; with put-backs after the answer those agents are still
   `pending` there. Either the page keeps polling `GET /api/agents/account-moves/<id>` until done (CHECK
   whether it already polls -- `web/index.html` stopAccountMove `:27580`), or the answer says plainly the
   agents are being put back. NEVER let a pending row read as finished. TEST: the browser check
   `render-acct-stopmove-6214` against the new flow; a web test that a still-pending put-back row does
   not render as a finished outcome.
3. **The hand-change re-read stays atomic with the write.** A put-back must re-read the job
   (`accountmove.js:263 deps.readAccount`) just before it writes (`:271`); an `await` between the read
   and the write reopens the hand-change window inside this process. Keep the re-read SYNC immediately
   before the write steps with no yield between read and write-issue (the read is one fast `/Query`; only
   the write's 3 ops go async). TEST: a hand-change landing during the put-back batch is still detected
   (the agent is left alone, `now !== a.to.dir`).
   **3b. (Liu Kang m5838) A sync read closes the window only to write-ISSUE; the async `/Create` then runs
   while the board serves other requests, so a person's own single-agent account switch for that agent can
   land between the read and the write FINISHING and the put-back overwrites it -- the same hand change, now
   INSIDE the board.** Fix: keep each agent HELD for the whole duration of its own async put-back -- move
   `m.deps.release(a.name)` (today `:295`, right after the sync putBack) INTO the put-back's `finally`, so
   the release fires only when that agent's put-back settles, not in `stop()`. VERIFY the single-agent
   account switch route (and every other job-writing route) refuses (or waits on) a held agent; if it does
   not refuse one while a put-back is in flight, make it. TEST: a switch for an agent mid-put-back is refused
   (or waits), and the put-back never lands over a switch that succeeded.
4. **A second stop while put-backs are running changes nothing.** TEST: a second `stop()` during the
   async put-back batch is a no-op and says so (as the existing second-stop test asserts, extended to the
   put-backs-in-flight state).

## Implementation decomposition (rewriteAgentJob win32 arm read, create.js:1369-1418)

The put-back's win32 work is a 3-schtasks-op chain, NOT a trio of independent calls:
- Op 1 `/Query /XML` cachedTaskSpec: the staleness re-read (`accountmove.js:263 readAccount` ->
  `create.readJob` -> cachedTaskSpec); populates the #2717 cache. `restoreAccount`'s own `readJobVerdict`
  (`create.js:1721`) then reads from that cache (no new spawn).
- Op 2 `/Query /XML` taskEnabled (UNCACHED, `create.js:1395`): reads `<Settings><Enabled>` so the reinstall
  preserves the on/off switch (round-1/round-2 SAFETY at `:1378-1394` -- fail-closed if `!known`, refuse if
  `!registered`). Logic between op 2 and op 3 is synchronous (no yield).
- Op 3 `/Create /F` install (`win32RegisterJob` `create.js:1408` -> `:3811` -> win32job install `:452`,
  which writes a transient UTF-16+BOM xml then `run(['/Create','/F','/TN',...,'/XML',xmlAt])`, cleans up in
  a finally; `install`/`disable`/`enable` call `forgetTaskSpec` to bust the cache).

**Architecture choice:** add a DEDICATED win32 put-back step generator (yielding op2 then op3 as `{exec}`,
synchronous enabled-logic between, reusing win32StepResult + a shared parse) rather than async-ifying the
general-purpose `rewriteAgentJob` (called by many non-put-back flows -- setAccount, provider/model switch).
Keep the sync arm intact; add the parallel async path for the put-back only, same dual-path discipline as
#6183's restart (sync acts untouched, steps added). The op-1 staleness read stays SYNC right before the
write generator (contract 3), so no yield sits between the re-read and the write-issue.
TO READ before writing: `win32RegisterJob` (`create.js:3811`), win32job `taskEnabled`(:1068)/`cachedTaskSpec`
(:1037)/`readTaskXml`(:962), and `restoreAccount`(`create.js:1717`) for the account/provider state it writes
beyond the job (the put-back is "restore the old account", not only the job).

`install(spec)` read (`win32job.js:403-458`): NOT a one-exec call. Sync pre-work — `forgetTaskSpec`
(`:420`), `anchorFor`/ensureAnchored (`:427`, copies node out of the extract tree + refreshes the engine
pointer; local fs, not a spawn), `taskUser` check (`:436`), UTF-16+BOM xml write to a transient temp file
(`:444-448`) — then the `/Create /F /XML` spawn (`:452`), then `finally` unlink (`:453-454`), then return
`{ok, task}`. The board-freeze cost is ONLY the spawn, so the step form keeps all pre/post work synchronous
and yields just the `/Create` `{exec}`. **Design choice to make with care (not a rushed draft):** refactor
`install` so the sync `install` and a new `installSteps` share the pre-work (anchor + xml build + cleanup)
and differ only in sync-run vs yield of the one `/Create` — rather than duplicating install's substantial
pre-work into a second copy that can drift (the #6183 discipline was exactly "one parse, two call forms,
cannot drift"; apply the same to the write). Same for `taskEnabled` (share the readTaskXml `/Query /XML` +
`<Settings><Enabled>` parse between a sync read and a `taskEnabledSteps`).

## Investigation findings (resolve contracts 1, 2, 3b) -- the design crystallizes

Verified in the merged code:
- **Hold mechanism:** `HELD` set in `remove.js:2460`; `holdForMove`/`releaseFromMove` `:2461-2462`;
  `busyRefusal(name,{held=true})` `:2465-2474`; exported `moveRefusal` `:2591`. Wired to accountmove deps
  `hold`/`release` at `server.js:13766-13767`; held at move start `accountmove.js:178`, released in the
  forward loop finally `:222/:225` and per-agent in `stop()` `:295`.
- **Per-agent writers already refuse a HELD agent** via `moveRefusal`/`busyRefusal`: account switch
  `server.js:13725`, provider `:9139`, model `:9368`, removal `remove.js:2121`, restart `:2477`,
  trust-and-restart (via restart). So contract 3b needs NO new route guard -- just keep the agent HELD
  until its put-back settles (release in `finally`, not in `stop()`).
- **Board-level writers** (world switch `server.js:7025`, engine restart `:5782`, update `:14959`,
  rollback `:15013`) refuse via `moveHoldsBoard()` = `busy() || restartingNow()`; `busy()` = `running !==
  null` (`accountmove.js:46`). So contract 1 needs `running` to stay non-null until the batch settles.
- **Contracts 1 + 3b reduce to ONE requirement:** extend the move's lifetime -- do NOT clear `running` /
  mark `done` (`accountmove.js:235-236`, today on restart-complete) and do NOT release the HELD agents
  until the async put-back batch has settled.
- **Contract 2:** `stopAccountMove()` (`web/index.html:27580`) does NOT poll and does NOT render per-agent
  put-back outcomes -- it reads only `waitingFor` and paints a static "try again once the move has ended /
  Settings shows each account" sentence (`:27627`). `view()` (`accountmove.js:100`) already exposes per-agent
  `outcome`/`done`; GET `/api/agents/account-moves/<id>` (`server.js:13790`) returns it. So the MINIMAL
  correct behavior is: keep `view().done` false until put-backs settle (free from the lifetime extension) +
  the existing sentence + the `render-acct-stopmove-6214` browser check. A live put-back-progress poll via
  the existing GET is an OPTIONAL enhancement (Liu Kang's call). The forward poll (`moveAccountAgents()`
  `web/index.html:27682`, `while(!last.done)`) only covers a page that started the move and is still open.
- Edge (out of scope): `POST /api/agent/<name>/restore` (`remove.js:2125`) is the lone writer with no
  `busyRefusal`, but it targets already-removed agents, not move participants.

## accountmove.stop restructure design (lifecycle mapped) — the clean architecture

The move's lifetime is owned by `start()`'s fire-and-forget async IIFE (`accountmove.js:194-239`): `running`
is set sync at `:191`, the IIFE awaits the forward restarts serially, and the OUTER `finally` (`:224-236`) is
the ONE place the move ends (`m.done=true; m.deps=null; running=null`). `stop()` (`:287`, sync) sets
`m.stopped=true` (which breaks the forward loop via `:197`) and today does the put-backs synchronously, then
returns `view(m)`. `busy()` = `running !== null`; `moveHoldsBoard()` = `busy() || restartingNow()`.

**Design: move the put-backs INTO the forward IIFE's `finally`; `stop()` only sets `m.stopped` + answers.**
This gives ONE async flow owning the lifetime, so every contract falls out of mirroring the forward mechanism:
- `stop()` becomes: validate (NONE_RUNNING / already-stopped guards unchanged), `m.stopped=true`, return
  `view(m)` — ANSWER FIRST, no put-backs inline. (Contract 2: the answer now shows the not-reached agents as
  `pending`, not final; the page's existing static "try again once the move has ended" sentence covers it, and
  a later GET shows finals after the batch — keep `view().done` false until then, which the finally gives.)
- The forward IIFE's outer `finally`: for each still-`pending` agent, if `m.stopped` → do the put-back ASYNC
  (hand-change re-read SYNC via `deps.readAccount` + compare to `a.to.dir` [contract 3], then
  `await deps.putBackAsync(a.name, a.from.dir)`), each agent RELEASED in its own per-agent finally
  [contract 3b]; else (cap, not a stop) → the existing not-reached sentence. Do NOT do the belt-and-braces
  release sweep (`:225`) before the put-backs — it would drop the hold mid-write; release each after its own
  put-back. THEN `m.done=true; running=null` (unchanged position) — so `running` stays non-null until the LAST
  put-back settles [contract 1], and `moveHoldsBoard()` keeps board routes refusing for free.
- Contract 4 (second stop during the batch = no-op): the `m.stopped` guard (`:290`) already returns the
  idempotent `already:true` 200, and stays correct because `running` is non-null + `m.done` false throughout
  the batch (do NOT clear `running` or set `m.done` until the batch's finally, exactly as the forward path does).
- The in-flight agent (`m.current` when stop is pressed) is handled by the forward loop (its restart settles,
  outcome set), so it is already non-`pending` by the finally — not put back. Unchanged.

**Wiring (mirror restartAsync):**
- `remove.js`: add an EXPORTED `putBackAsync(name, dir)` that builds `ctl={abandoned:false}` + a capped timeout
  (mirror `ASYNC_RESTART_CAP_MS`/`asyncRestartCapMs()`), drives `create.restoreAccountSteps(name,dir)` via the
  private `driveAsync(gen, ctl)`, holds via the RESTARTING-style set released when the drive truly settles
  (not at cap), `Promise.race([driven, capped])`. `driveAsync` is NOT exported — add the wrapper in remove.js.
- `server.js` (deps at `~:13775`): add `putBackAsync: (n, dir) => process.platform === 'win32' ?
  removal.putBackAsync(n, dir) : Promise.resolve(create.restoreAccount(n, dir))` — win32 async, mac/linux the
  sync restoreAccount wrapped (local write, no board freeze). Keep the existing sync `putBack` dep for any
  remaining sync caller, or retire it once the finally uses only putBackAsync.
- accountmove.js: the finally's put-back uses `deps.putBackAsync` (await) + `deps.readAccount` (sync re-read) +
  `deps.release`. Refactor the current sync `putBack(m,a)` (`:251`) hand-change logic into a shared decision the
  async path reuses (re-read + compare + outcome-wording), so sync and async put-back word outcomes identically.

**Tests (all 5 contracts):** update `accountmove-stop-6214.test.js` to stub `putBackAsync` (async) + `readAccount`
and assert: (1) a slow put-back keeps `busy()`/the move alive (Update refused) until it settles; (2) the stop
answer shows not-reached agents as pending, finals appear on a later `read(id)` once settled; (3) a hand-change
during the batch leaves the agent on the person's choice; (3b) each agent released only after its put-back
settles (a mid-batch write for a held agent refused — exercised at the remove/server guard level); (4) a second
stop mid-batch is the idempotent no-op. Plus the exit-128 async taskkill test (win32stop) and the win32
step-form tests for installSteps/taskEnabledSteps/restoreAccountSteps.

## Traps

- win32StepResult shape adapter: win32 parsers read `r.out`; remove's run() returns `{stdout,stderr,code}`;
  failure carries stderr-then-stdout; `code` must survive for exit-128 handling.
- Step generators yield `{exec}`/`{sleep}` and return `{ok}` objects; wrappers must `Boolean(r&&r.ok)`.
- The mutating install step must clear PRESENCE_MEMO up-front (bypasses run()).
- accountmove suites inject `putBack`/`readAccount` deps (no real schtasks); the schtasks-as-steps
  assertions live in the `remove.*`/`win32*` suites. accountmove-stop-6214.test.js:175-177 pins the
  server wiring of readAccount/putBack as source text -- changing that wiring reds it.
- Box is contended: full-suite 6j queues ~1h. Targeted per-iteration set: win32job, win32stop,
  remove.win32-restart-3431, remove, accountmove-stop-6214, create.win32-job-read.

## Done-when

1. On Windows a stopped large move answers promptly and the board stays responsive during the put-backs
   (put-backs run via driveAsync, event loop not frozen).
2. The put-back's three schtasks ops run as async step generators reusing win32StepResult + the shared
   parsers; sync arm preserved for non-async callers.
3. Item 8 split out, noted on #6231. The two #6243-folded cleanups (exit-128 async-taskkill test;
   `running()` + the `:627` sync loaded act removal) are ALSO split to a follow-up PR -- see the "Folded from
   Raiden's #6243 review" section for why (stale gate, a still-live caller, and the taskkill path is outside
   item 7). Full suite green at head.
