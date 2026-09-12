# #2456: an automatic needs_you must not clobber a deliberate wait, and must clear itself

**Branch:** `needsyou-auto-clear-2456` · **Card:** kosmos#2456 (the 0.6.54 permission-prompt
sub-defect Sub-Zero measured; distinct from the already-merged #2465 scrape-FP and #2493
cannot-find-fallback fixes on the same card).

## The defect (measured by Sub-Zero on 0.6.54, 11-agent cohort)

The dominant source of the board's one red state was the PermissionRequest hook writing
`needs_you "asking permission to use Bash: ..."` (`kosmos-report-hook.js` reportFor, `auto:true`).
Two harms:

1. **Clobber.** That auto `needs_you` overwrote an agent's *deliberate* `needs_you`, replacing the
   real question in `because` with the text of a shell command. The board's only red state then
   named something no person needed to act on, and the real ask was gone from the card.
2. **No-clear.** The permission `needs_you` never cleared. After the prompt was answered, the
   auto `working`/`idle` that followed was refused over it, so it stuck across a dozen further
   commands.

## Root, verified in code

Both come from ONE rule: `selfreport.js` `record()`'s #900/#1949 guard (was line 181) refused an
automatic `idle`/`working` over ANY standing `WAITING_ON_A_PERSON` state, without checking who
wrote that standing wait. The guard's own heading says it protects a *DELIBERATE* wait (line 154),
but the code protected every wait, including the auto permission one. And there was no guard at all
against an auto `needs_you` overwriting a deliberate wait.

## The fix (one place, keyed on `standing.by`)

`record()` already stores `by` = `auto` | `agent` | `operator` (#1453), and `read()` returns it.
Hoist `needs_you` into the guard and refuse only over a *deliberate* wait:

```
const standingIsDeliberateWait = standing.found === true
  && WAITING_ON_A_PERSON.includes(standing.state)
  && standing.by !== 'auto';
```

- **No-clear fixed:** the permission `needs_you` is `by:'auto'`, so it is NOT a deliberate wait; the
  following auto `working`/`idle` now lands and clears it.
- **Clobber fixed:** an auto `needs_you` is refused over a deliberate wait, so the agent's real
  question survives.
- **#900/#1949 preserved exactly:** a deliberate `needs_you`/`blocked` (by agent/operator) is still
  protected from auto `idle`/`working`; every existing guard test uses an agent-authored standing
  wait.
- **Legacy safety:** a pre-#1453 line has `by:null` (unknown provenance) and stays protected, exactly
  as the pre-fix code protected it. Only an explicit `by:'auto'` is treated as clearable.

## What I rejected

- **Sub-Zero's option (a), a distinct transient board state.** It adds a 7th word to a closed
  six-word list (`selfreport.js:12`), touching board rendering and requiring a browser verify, for no
  gain over the `by` discriminator.
- **Fixing it in `kosmos-report-hook.js` (the client).** The client can't cheaply know the standing
  state, and the reconcile rule belongs at the authority (`record()`) beside #900/#1949; a client
  copy would be a second derivation that drifts.
- **Doing only one half.** (c)-alone (clear) would leave the deliberate question already destroyed and
  then clear to `working`, so the agent looks working with an unanswered question. (b)-alone (no
  clobber) leaves a standalone permission prompt sticky. Both halves are needed and compose on the one
  discriminator.

## Scope boundary (deliberate)

Auto `blocked` (a StopFailure provider error) is left landing over a standing wait, as today. It is a
genuine machine-detected block, infrequent and one-time, not the high-frequency permission noise #2456
measured, and it re-derives. Narrowing my change to exactly what was measured.

## Weakest premise

That at least one automatic lifecycle event fires after the permission resolves, to clear the auto
`needs_you`. It holds: the Stop hook writes auto `idle` at every turn end (now lands over an auto
wait), and the next turn's UserPromptSubmit/PreToolUse writes auto `working`; session end alone
guarantees it. If somehow no auto event ever followed, the state would persist, but that cannot occur.

## Tests

New `engine/selfreport.autoclear-2456.test.js` (9 tests): auto working clears an auto needs_you; auto
idle clears an auto needs_you; auto needs_you does NOT clobber a deliberate needs_you (real question
survives) or a deliberate blocked; a newer auto needs_you replaces a stale one; a permission prompt
with nothing waiting still shows; #1949 preserved (auto working still refused over a deliberate
needs_you); an agent working still clears its own needs_you; a legacy null-`by` wait stays protected.
Red-capable proven by perturbation: reverting the guard to old behavior fails exactly the 4 defect
arms while the controls stay green.

Existing `engine/selfreport.test.js` #1949 test updated: the `needs_you` case moved from the "still
land" group to the refused group, with a #2456 rationale showing the stranding risk is not
reintroduced (started/stopped/blocked auto still land; an agent's own report still lands).

Verification: `bash tools/run-tests.sh` (full suite, not the validation subset).

## Not in this change (stays on #2456, parked needs-browser)

The live-board retest of the already-merged #2493 fallback fix on a build cut. That is a headed
verification, distinct from this engine fix.
