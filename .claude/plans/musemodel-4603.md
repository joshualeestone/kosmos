# musemodel-4603: whoami names a Muse agent's model during the first turn of its life

Card: #4603 (10-05 user diagnostic, item R7). On 0.7.22 `kosmos whoami` still cannot name the Meta seat's model,
though #4980 (0.7.17) keeps the model Muse names.

## Cause (read from source)
engine/musefront.js forgets the kept model at start (startup -> forgetModel, review 1's rule) and keeps it again only
after a turn ENDS (`if (r && r.model) keepModel(...)`). Muse has no planned model to fall back on. So during the first
turn after any start, the board has no model and whoami cannot name one. A stopped or timed-out turn also dropped the
model (runTurn's fail() answered model: null).

## Change
- engine/muserun.js: `modelWatcher(onModel)` reads stdout chunks as they arrive, whole lines only, UTF-8 safe, a line
  past 64 KB dropped (bounded memory), never throws. runMuse feeds it via `opts.onOut`; runTurn calls `input.onModel`
  and remembers the model, so fail() (stopped, timed out) still carries it.
- engine/musefront.js: passes `onModel: (m) => keepModel(workspace, m)`, so the model is on disk while the turn runs.
  keepModel's existing guards (absolute path, safe id, no links, write only on change) are unchanged.

## Tests
muserun.test.js: watcher across byte-by-byte and UTF-8 splits, non-model lines, throwing callback, unfinished line;
over-long line dropped; real-spawn turn fires onModel before it ends and a stopped turn keeps the model.
musefront.test.js: the model is on disk while the turn is held; the call contract includes onModel.
Each fix site perturbed: every one turns a test red.

## Review 1
- A stopped turn's late stdout no longer reaches onModel once the turn has settled (a new life's forgetModel could
  otherwise be undone). onOut is called inside a try, so a throwing consumer cannot reach the stream's data handler.
- The board reads the kept model on its tick (status.js readMuseSession), so whoami names it from the first tick after
  the stream names it, not instantly.

## Done when
On a served build, a Muse agent's `kosmos whoami` names its model during the first turn after it starts. The tests prove
the file is on disk mid-turn; they do not prove the served whoami line.

## Review 2
- The settled check and a late chunk are ordered because both run on the one Node thread: the stop resolves the turn
  synchronously, and a later 'data' event runs after it. Not stated in code, recorded here.
- The late-output test calls stop right after runTurn; it relies on runTurn starting runMuse before its first await.
- Plan file name: `<branch>.md`, as every other plan in this repo's .claude/plans/ is named (deferred: repo practice).

## Weakest premises
1. That the seat ran whoami in the first turn of its front's life. If it was a later turn, this is not the cause.
2. That real Muse writes `run.model.configured` to its stdout pipe early in the turn. If it buffers its JSONL until it
   exits, the model still arrives only at the end and this changes nothing. The research captures on #3939 show the
   event as sequence 3 of ~90, but they do not show WHEN it reached the pipe. Check on the served build together with
   the done-condition above.
