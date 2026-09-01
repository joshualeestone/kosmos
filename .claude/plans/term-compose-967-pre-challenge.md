---
pre_challenge: true
method: challenge-loop
branch: term-compose-967
diff_hash: 823a5da780bdef56aeb37d76d5fac51b3ebf6b37e141e74d57b8b886b671eace
validation: passed
subdir_audit: passed
timestamp: 2026-09-01T17:17:29Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes (iteration 8 returned no BLOCKER/WARNING/CONVENTION beyond the deferred plan-file note)
**Total findings:** 1 BLOCKER, 6 WARNINGs, several CONVENTIONs/NITs
**Fixed:** the BLOCKER and all 6 WARNINGs | **Deferred:** the plan-file CONVENTION + a handful of NITs (below)

> Note on the diff_hash: the shared main checkout's local `main` ref is stale
> (behind origin/main) and dirty with unrelated deletions, so the hook's
> `git diff main...HEAD` (three-dot) spans intermediate already-merged work. The
> hash below matches what the hook computes. The ACTUAL feature diff (vs
> origin/main, after rebasing onto it) is exactly two files: `web/index.html`
> (+164) and `web.term-compose-967.test.js` (+225). Every blind reviewer isolated
> that feature diff explicitly.

### The feature
kosmos#967: a respond-in-context message box (`sendTerm`) below the live terminal
pane on the Terminal tab, reusing the Talk composer's endpoint
(POST /api/agent/<name>/thread) -- one delivery mechanism, two entry points. It
mirrors `sendTalk`'s hard-won contract.

### Per-Iteration Breakdown

#### Iteration 1
- [BLOCKER] web/index.html -- the terminal composer was neither cleared on agent
  switch nor parked per-agent, so a reply typed for agent A was delivered to
  agent B (CURRENT.sessionName had moved). The receipt lingered under the wrong
  agent too, and the receipt writes lacked the flightMoved guard. --> FIXED
  (ab22f729): TERM_DRAFTS per-agent parking + restore in paintTalk + openDetail
  switching-clear of box and receipt + flightMoved() on every write + placedWords
  for the #402 silent-when-worked receipt.
- [CONVENTION] no plan file --> DEFERRED (card routed directly; spec in the #967
  issue and commit history).

#### Iteration 2
- [WARNING] the finally re-enabled the Send button unconditionally --> FIXED
  (7b3561b0): gated, then (iter 3) replaced with a paintTalk re-derivation.

#### Iteration 3
- [WARNING] force-enabling the button diverged from sendTalk under a same-agent-
  offline-mid-flight case --> FIXED (482cb4ba): finally now re-derives via
  `await paintTalk(sentName, name)` when the flight has not moved, exactly as
  sendTalk does.

#### Iteration 4
- [WARNING] a comment falsely claimed a cross-composer one-send-at-a-time
  guarantee --> FIXED (821ca0ec): comment corrected to the truth (each composer
  independently re-entrant-guarded; concurrent Talk+Terminal accepted as
  harmless).
- [NIT] no focus restoration after a button-click send --> FIXED (accessibility
  parity: focus captured, moved to the box for the flight, restored to Send at
  finally).
- [NIT] the "fully mirrors sendTalk" framing overstated the deliberate unconfirmed
  divergence --> the doc comment now states it honestly.

#### Iteration 5
- [NIT] the placed-clear `=== text` re-check was untested --> FIXED (a2ff639b):
  a typed-on-top test that reds if the re-check is removed. Both deliberate
  divergences independently confirmed sound by the reviewer.

#### Iteration 6
- [WARNING] the detail poll re-enabled the Send button mid-flight (the poll-skip
  only checks TALK_SENDING) --> FIXED (fce896dc): rather than skip the poll
  (which would freeze the live pane the Terminal tab exists to show), TERM_FLIGHT
  records the in-flight agent and paintTalk holds the button by name. The pane
  keeps painting; the button no longer flickers.
- [NIT] mid-flight refocus --> FIXED. NITs pjSentence normalization / placeholder
  spelling / TERM_DRAFTS-deletion test --> DEFERRED (below).

#### Iteration 7
- [NIT] the `|| flying` term made the button read disabled during a concurrent
  Talk send while Enter still worked (a screen reader would hear "disabled") -->
  FIXED (ff7c0820): dropped `|| flying` from the Terminal gate so button and Enter
  agree; `flying` still gates the Talk button unchanged.

#### Iteration 8 (full template, converged)
- No blockers or warnings. Only the dup plan-file CONVENTION and two harness-limit
  NITs. **Converged.**

### Deferred NITs (non-blocking)
- Generic "Still sending your last message" on a cross-agent re-entrancy, where
  sendTalk names the other agent. Copy-clarity nicety; a follow-up candidate.
- pjSentence normalization of server because/error copy (the could_not/non-ok
  arms would need restructuring to avoid double punctuation; server text is
  authored). Copy nicety.
- The `&hellip;`-vs-literal `…` placeholder spelling (renders identically).
- paintTalk/openDetail behaviors pinned by source string-match, not driven
  behaviourally (paintTalk is not lifted in the harness). Documented in-file.

### Strengths (across iterations)
- Cross-agent misdelivery is genuinely closed: parked per agent, cleared on
  switch, restored gated on presence, every write flightMoved-guarded.
- Full sendTalk parity on the load-bearing guards; the two remaining divergences
  are deliberate, documented, and correct.
- Security clean: all agent/server text via textContent, endpoint uses
  encodeURIComponent, no innerHTML. No em dashes in user copy.
- Tests are outcome-based and red on a removed guard (flight-moved, typed-on-top,
  re-entrancy double-POST, every delivery state, silent-vs-consequential placed).
