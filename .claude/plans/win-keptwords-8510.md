# win-keptwords-8510: true and plain words for a kept account folder at Start at login (kosmos#8510)

**Posture:** production

## Problem
delete-leftover.startsAgainWords ends the task-only delete's sentences and Restore's with what Start at login
(register.repair) brings back. Three things on the card:
1. WARNING: the out-of-reach sentence ran only when the recorded model was still offered (`rec.modelOk`). A kept folder
   out of reach whose model is retired fell to the generic "it starts on your main account and the model it last ran,
   so choose its account and model again". register.repair decides the account and the model separately: it keeps the
   folder in the record whatever the model, and when the folder is back by then holding the same account it writes the
   task on that folder (and the model it last ran). So the sentence was false, and it never mentioned the kept folder
   or how many tries are left.
2. CONVENTION: the kept-folder sentences ran to 90 words and more, with engine wording ("its startup job is written
   again (changing its account or model does that)").
3. NIT: at count 0 the out-of-reach words said "until three Start at logins that reach that folder still cannot read".

## What repair does (read from engine/register.js and engine/create.js, then measured by the new test)
- Model: `rec.modelOk` puts back the model it was set to; otherwise the model it last ran (`modelFor`). Independent of
  the account outcome.
- Account: `accountOk` writes the recorded folder; 'unreachable' and 'unreadable' write the main account and keep the
  folder in the record (`kept`, with the count of reachable starts that could not read or confirm it; a start out of
  reach carries the count unchanged); every other outcome (changed, unusable, unverifiable, removed, missing, and
  'unreadableGaveUp', the drop) writes the main account and keeps nothing.
- Any later write of the startup job (account or model setters, provider switch, any other rewrite) drops a kept record
  (create.recordWin32Task).

## Decisions
- The three kept-folder outcomes (out of reach, could not read or confirm, the drop) lead with one shared model sentence
  chosen by `rec.modelOk`, then their account sentences. This removes the modelOk gate on the out-of-reach branch by
  construction, so a retired model can never fall through to the generic words again.
- Every kept-folder sentence is split into short sentences (each 30 words or fewer, asserted). The rewrite clause is now
  "Changing this agent's account or model makes Kosmos forget that folder, as does anything else that sets up its
  startup job again." Rejected: the card's example "Changing this agent's account or model stops that." on its own,
  because other rewrites also forget the folder and the promise must not be wider than the code; and "stops that"
  placed before the count sentence made "After that" ambiguous, so the forget sentence goes last.
- The count clause no longer says "still" and reads "at three Start at logins that reach it" at count 0, "two more" at
  1, "the next Start at login that reaches it" at 2.
- The drop sentence now says "at the next Start at login that reaches that folder", and first says it starts on the
  main account unless the account reads as the same one by then. Before, "at the next Start at login" was not true when
  that start cannot reach the folder (the repair keeps it then).
- Checked the generic sentences for the same gate pattern across every outcome x model: only out-of-reach with a
  retired model was wrong. The rest already split on modelOk inside each outcome and match the repair.

## Review round 1
- WARNING: with a retired model the words said "choose its model again" up front, then that a model change forgets the
  kept folder, without saying which to do first. The kept-folder words (out of reach, could not read or confirm, the
  drop) now open with "it starts on the model it last ran." and end with "If it used another model, choose that model
  again only after it is back on that folder, or after it has moved to another account." Once Start at login puts it
  back on the folder the record is an ordinary one, which a model change keeps (refreshedRecord, same folder); once it
  is on another account there is no folder left to lose.
- NIT: the kept words now say "If that folder then holds a different account, Kosmos forgets it." (a reaching start
  that reads another account is 'changed', which repair does not keep).
- NIT: "Otherwise, choose its account again afterwards if it should use another." is now "If you do not plan to connect
  it, choose its account again."

## Review round 2
- WARNING: "or after it has moved to another account" read as "it runs on the main account now", when the folder is
  still kept and a model change forgets it. Now: "choose it again only once it is back on that folder, is on your main
  account for good, or has its account chosen again."
- WARNING: the drop (count 2) now says "Kosmos keeps that folder until then." and the shared forget sentence, and its
  condition is "Unless the next Start at login that reaches that folder reads (confirms) the same account there".
- CONVENTION: the clauses were 122 to 169 words. Merged the repeats: "keeps that folder and tries it again" and "starts on
  your main account unless" became one "It runs on your main account until a Start at login ..." sentence; the
  different-account and count facts became one sentence; the forget sentence names the setters once. Longest now
  (out of reach, retired model) about 136 words, offered about 108. Test cap KEPT_CLAUSE_MAX_WORDS = 145.
- NIT: the kept-folder words now start a sentence of their own (". It starts on ..."), so the caller's sentence ends at
  "offers it." and every sentence the person sees in the plan and outcome is 30 words or fewer (tested end to end).
  The generic outcomes keep their "; it starts" clause (out of this card).
- NIT: "forgets it" is gone; every forget says "that folder".
- End-to-end cases added: config readable again by Start at login, folder back holding another account, folder that
  could not be read going away before Start at login.

## Review round 3 (rework)
- False premise found: after a Start at login that cannot use the folder, the agent has a startup job again on the main
  account, register.survey no longer offers Start at login, and nothing moves it back on its own. The kept record and
  its count matter only if the job is removed again and Start at login used again. So the earlier words ("runs on your
  main account until a Start at login finds that folder", "tries it again", "choose the model once it is back on that
  folder") could wait forever.
- Decided (coordinator): the words say what THIS Start at login does and what to do. Out of reach: connect it before you
  use Start at login; it starts on that folder's account only if Kosmos can reach it then and it holds the same account;
  otherwise the main account, and choose its account again once that folder is back. Could not read / confirm: the same
  shape with their own reasons. The drop adds "Kosmos could not confirm that account at two earlier Start at logins
  either." I dropped the kept-record and count sentences entirely: a true conditional ("if its startup job goes again
  later and you use Start at login, Kosmos tries that folder again, unless you changed its account or model, and only
  up to three times") is neither short nor useful to a person at this moment.
- Retired model: "If it used another model, choose it again once it is on the right account, choosing its account first
  if it is not." Choosing the account first never loses a folder the person wants, and waits on nothing.
- Every outcome now starts its own sentences (". It starts on ..."), the outcomes that keep no folder included, and the
  callers' sentences (taskOnlyBackWords, outOfSightWords) are split so each is 30 words or fewer whatever the path.
- Tests: the matrix now also asserts Start at login is not offered again after the repair; end-to-end cases run the
  real flow (task-only delete, Start at login, survey, reconnect, then account and model chosen); every sentence the
  person sees is capped at 30 words with a workers path containing spaces, and every caller form (plain, removed,
  occupied, disk, out-of-sight leads, Restore) is capped in the 8475 tests. Whole clause cap 120 words (longest 110).

## Weakest part (round 3)
The words no longer tell the person that a later removal of the startup job would try the folder again. That is true
and occasionally useful, but saying it truthfully needed three conditions; it was dropped rather than half-said.

## Tests
- New engine/delete-leftover.win32-keptwords-8510.test.js: every outcome (same folder, same main, changed, unusable,
  unverifiable, removed, missing, could not read, could not confirm, out of reach) x model offered or retired x
  unreadable count 0, 1, 2 (could not read or confirm at 2 is the drop): key facts in the words, then (Windows) the real
  repair on the same record, checking the task it wrote and the record it kept against those facts. Plus the card's
  end-to-end path through the real task-only delete: out of reach with a retired model, folder back with the same
  account, Start at login writes the task on the folder with the model it last ran.
- Existing pins of the old sentences updated: engine/create.win32-samaccount-8489.test.js,
  engine/delete-leftover.win32-accountkeep-8478.test.js. No web/ or docs/browser-checks file pins them.

## Weakest part
"as does anything else that sets up its startup job again" is still a little abstract for a non-engineer; it is there
because naming only the account and model setters would promise the folder survives a provider switch, an import or any
other rewrite, which it does not. The 30-word sentence cap is a proxy for plainness, not a reading test.

## What would change my mind
A list of every path that rewrites a task-only-deleted agent's startup job showing only the account and model setters
can run in that window: then the shorter "Changing this agent's account or model makes Kosmos forget that folder."
would be complete.
