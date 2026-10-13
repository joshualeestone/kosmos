---
pre_challenge: true
method: challenge-loop
branch: dupname-5957
diff_hash: 1757990547d5202c8262c29707b8270819124fbebb7289e50af78c72bbf9858a
validation: Mortals full validation CLEAN at 729c10635 (2026-10-13T00:11:11Z; node 19601 tests, 19358 pass, 0 fail, 0 cancelled, 243 skipped; shell 230/230). Mortals hash 6cb6ccb08b55 is the SAME diff at core.abbrev=9; locally git abbreviates at 10, giving this hash (measured: git -c core.abbrev=9 diff cd34bd423 HEAD | shasum hashes to 6cb6ccb08b55, abbrev 10 to 1757990547d5; see #6002).
subdir_audit: passed
timestamp: 2026-10-13T00:11:30Z
iterations: 14
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 14 blind reviews.
**Converged:** Yes, at iteration 14: no new findings, so no code commit follows iteration 13's fixes (only the browser-check surface trailers, which change no code).
**Hand-written:** this proof is written from the branch's own ledger: the commit messages "address challenge-loop iteration N findings" and the plan's "As built" and review-iteration sections. Which model ran each review is not recorded on the branch, so it is not stated here.

## Findings and dispositions, by iteration

Also committed: #5957: fleet entries are { handle, shown }, not roster-card shaped.

#### Iteration 1
- The agent page's Save shows the server's refusal (it printed 'that did not save').
- The fleet leaves out removed agents (createdKeys includes them for Restore).
- create skips an entry under its own handle, so the removed / half-made / running refusals keep their sentences.
- connect checks with no except: the job and session checks already refused this handle.
- Tests: a stopped created agent holds its name, a removed one does not; both connect paths refuse.

#### Iteration 2
- The profile route checks only a CHANGED name, so an agent that already shares one can still save a role.
- Plan: why create checks the display name only, the accepted check-then-write window, the non-Latin gap.

#### Iteration 3
- The profile route's catch-all answers in a sentence (the page now shows its error; no errno or temp path).
- The instructions follow checks only when the record would change, as the profile route does.
- connect reads the fleet once for both names; the removed filter's width is explained.

#### Iteration 4
- The profile route's catch-all logs the real cause (the page gets the sentence, the log gets the reason).
- Test: re-connecting a stopped Kosmos-made agent's folder gets the job refusal, not the name one.

#### Iteration 5
- The fleet is nameCheckFleet(), wired by ONE line after the preview sweep in start(): the block at the top broke
  #5247's snapshotWorlds-first and #5254's sweep-near-start structure tests.
- Windows: stopped agents come from the session record (its roster lists only live sessions); Josh's case was there.
- The created list is read strictly (status.createdKeysStrict), so a failure refuses instead of reading as none.
- The re-connect test needs no host branch (windows-tests-1777).
- Plan: corrected as-built claims.

#### Iteration 6
- nameCheckFleet's doc says only our own agents' rows hold names (isNamedOurs).
- Deferred: a 'too large' sentence on the profile route. Measured: readBody destroys the request past 6 MB and the
  client gets ECONNRESET, never a reply, so any sentence there is unreachable (pre-existing, not this change).

#### Iteration 7
- connect: a clash with the name in the folder's own instructions says so and what to change (typing another name
  cannot fix it there).
- instructions Save: nameKept says the agent will still call itself by the line's name until it changes.
- refusalFor logs why a check could not run.
- render-rename-say.js presses both Saves: the profile refusal sentence and the instructions nameKept line.

#### Iteration 8
- Test: the no-instructions connect path (registerOnly) also gives a stopped Kosmos-made agent's handle the job refusal.
- Deferred with evidence: the profile catch hides no sentence (no throw in the route; 75 nearby files green);
  readIdentity reads the record before the file, so a kept line cannot show over the record on the board.

#### Iteration 9
- except is compared by the store key, so /api/agent/Gemini/... excepts the gemini agent (any accepted spelling).
- nameCheckFleet's doc and the plan say exactly what fails closed (an unreadable roster or created list) and what
  does not (a tmux with no server is a true empty roster; Windows' session record fails open).
- Plan lists the profile route's catch-all change.

#### Iteration 10
- Windows: the session record is read strictly (win32sessions.readStrict), so a record that is there but unreadable
  refuses the name check instead of reading as no stopped agents; absent stays empty.
- agentnames: one store require per check.

Also committed: render-rename-say: the instructions load is answered with a fixture.

#### Iteration 11
- nameCheckFleet reads status.paneRoster (one listing, no captures, no snapshot side effects) instead of safeRoster,
  names each agent with readIdentity, and filters removed agents from both lists. Test: an unreadable listing refuses.
- Plan: the Windows session record covers agents whose session has started; a never-started Windows agent is a
  stated gap.

Also committed: render-rename-say: edit the instructions before pressing Save (it is enabled by an edit).

Also committed: render-rename-say: the status poll reports the fixture's instructions as editable.

Also committed: render-rename-say: the fixture load says the file exists and is editable.

Also committed: TEMP diagnostic in render-rename-say (removed next commit).

Also committed: render-rename-say: the status poll's editable flag too (measured), diagnostic removed.

#### Iteration 12
- 'Taken' is decided by takenKey (letters and digits of every script), not the @-mention key: 王12 and 李12 were one
  name ('12') and an all-CJK name was never compared. Latin names get the same answer as before.

#### Iteration 13
- createdroster.make() takes strict: a job folder that is there and cannot be read throws for the name check
  (other callers unchanged); tested through the real source, not a stubbed throw.
- The profile route's 'unchanged' compares with the name the board shows (readIdentity), so a line-named agent can
  resend it beside a role edit.
- win32sessions.readStrict sits after read() and its doc.
- Deferred (measured): excepting a connect's own handle lets 'Ge Mini' through onto Gemini's key.

#### Iteration 14
No new findings. Converged.
