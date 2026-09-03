# #1949: an automatic `working` erases a standing needs_you/blocked

**Branch:** `needs-you-standing-1949`
**Card:** kosmos#1949 (filed and specified by **Splinter2**, who has no GitHub credential; credited in the PR body)
**Owner of this fix:** Mona Lisa

## The defect

`engine/selfreport.js` guarded a standing `needs_you`/`blocked` against being
overwritten (#900), but the guard refused **only** an automatic `idle`:

```js
if (entry.auto === true && state === 'idle') {   // pre-#1949
```

`install/kosmos-report-hook.sh` fires `working` (with `--auto`) on
`UserPromptSubmit` and on **every** `PreToolUse`. So an automatic `working`
was allowed to land, and a standing `needs_you`/`blocked` erased itself within
seconds of the agent running any command. Splinter2 measured ~16s; ~74 of 82
rows in his session's log were automatic. This is the worst case because the
operating doctrine tells every agent to **raise needs_you AND keep working**,
so obeying it destroyed the very signal it raised.

## The fix

Widen the refused-automatic set from `{idle}` to `{idle, working}`:

```js
if (entry.auto === true && (state === 'idle' || state === 'working')) {   // #1949
```

## The property that must NOT break

A rule that refused **every** automatic write would strand an agent `blocked`
forever. The discriminator stays `entry.auto`, **not the word** `working`:

- An **agent-written** `working` (no `auto`) still lands, so an agent that
  genuinely resumes clears its own block by reporting it itself.
- Automatic `started` (a new run) and `stopped` (session end) still land, they
  are one-time transitions, not continuous, so the hook can still emit them.
- Automatic `needs_you`/`blocked` still land (they are themselves waiting
  reports, not clears).

## Tests (`engine/selfreport.test.js`, `server.test.js`)

- **CONTROL (Splinter2's, fails against the pre-#1949 guard):** raise
  `needs_you`, fire an automatic `working`, assert the state is STILL
  `needs_you`.
- Same for `blocked` (the existing #900 "working lands over a block" test is
  updated to the new partition, a deliberate behavior change, not a
  regression).
- **PROPERTY:** an agent-written `working` still clears a standing `needs_you`.
- The existing "#900 refuses ONLY automatic idle" enumeration is rewritten to
  the `{idle, working}` partition: `{started, needs_you, blocked, stopped}`
  land automatically, `{idle, working}` are refused (both arms as controls).
- `server.test.js`'s end-to-end board test is updated the same way: an
  automatic `working` is now refused (board stays `blocked`) and a deliberate
  (agent-written) `working` is what clears it.

**Perturbation proof:** reverting the guard to `state === 'idle'` reds exactly
the three behavior-change tests and leaves the PROPERTY test green (it holds
under both guards). All tests pass with the fix in place.

## Bonus: historical silent clears (this machine's store)

`~/Library/Application Support/AgentWorkforce/selfreports/*.jsonl`, 31 sessions:

- **31 confirmed silent clears** (`by:auto` `working` landing over a standing
  `blocked`), across 8 sessions.
- `needs_you -> working/auto` = 0 in the marked window (needs_you is rare here:
  40 lines vs 441 `blocked`), but shares the identical code path.
- **293 unattributable** clears from before the `by:` field existed (#1453)
  (`blocked/needs_you -> working/?`), a large share likely the same mechanism,
  but the log cannot attribute them.
- Legit agent-written resumes correctly landed: 65 `blocked`, 16 `needs_you`.

## Adjacent, deliberately out of scope

Automatic `started` on a session restart/compaction also still lands over a
waiting state. #1949 names `idle`/`working` only, so that stays as-is; noted as
a possible follow-up rather than expanding this fix's blast radius.

A consequence worth naming (intended, not hidden): a resumed-but-not-reported
agent now shows `blocked`/`needs_you` indefinitely, since only an agent-written
report (or auto `started`/`stopped`) clears it. That is the plan's design: the
doctrine expects the agent to report its own resume.

Addresses #1949
