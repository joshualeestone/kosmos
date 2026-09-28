---
pre_challenge: true
method: challenge-loop
branch: communitynotice-4288
diff_hash: 864323f91c6893c966ae1e07577cf9c16a96e7dbfaeb22a94d81d85761fe5db5
validation: red-outside-this-branch
subdir_audit: passed
timestamp: 2026-09-28T13:03:41Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5: no BLOCKER or WARNING, two NITs; one pinned, one noted)
**Total findings:** 13 (1 BLOCKER, 6 WARNINGs, 0 CONVENTIONs, 6 NITs)
**Fixed:** 10 | **Deferred:** 1 (filed as #4328) | **Asked (awaiting user):** 0 | **NIT noted, not acted on:** 1 | **Measured, not a defect:** 1

Found by my own work, not a reviewer, before review 1:
- web.consolidated-980 pins the body's direct children (38 rows), so the notice is made when it opens and
  removed when it closes, as What's New is.
- web.whatsnew-3955 pins the bare `whatsNewCheck();` line, so the two checks run separately and wait on
  each other through `cnHeld` / `wnCovered` rather than a promise chain.
- A local browser-check flake traced to `#boot-cover` (z 70) staying up until first run's live check
  answers. That was also a product gap (the notice could open and record itself seen under the cover),
  fixed with a BOOT arm.
- After the rebase onto main (part A merged as 849273fa), validation was red on browser-checks-selectors
  (#758): the check asked for `#planted-cover` / `#planted-upd`, ids the page never has because the check
  plants those covers itself. They carry a `data-planted` attribute now. The same run's other red was
  #3827's remote timing test, which passed alone (101/101).

**Final gate, stated as it is:** validation on 8a606b24e (hash 864323f91c68, clean worktree) was 11031 pass, 4 fail,
val_exit=1, audit_exit=0. None of the four is this branch's:
- two in `server.connections-refresh-1649.test.js` also fail on untouched main 2f8649405 when run alone
  (filed as #4338, board-start tests at 13 to 15 s at load 11);
- one in `server.dmfiles-refresh-3614.test.js` passed 3/3 alone;
- #3827's remote test passed 101/101 alone.
This branch's own tests all pass: every `web.*.test.js` (2076 with the engine tests), the server community
routes, and `engine/communityswitch.test.js`. CI is the clean gate for this PR. engine/communityswitch.test.js 14/14; the browser check render-community-switch-4288
is all good on a sandboxed board.

**What the branch does (#4288 part B):** the one-time notice from Mona Lisa's design, "Your agents can join
the Kosmos community", with Got it and Change in Settings. `migrate()` runs once at board start: an
existing install gets the notice pending, a fresh one is told in first run instead (the weakest premise:
that install-screen checkbox is Mona's unbuilt fast-follow). The notice waits for What's New, first run,
the tour, the update overlay, the boot cover and any other dialog, reads the setting again after any wait,
records itself as seen when it opens, focuses its box, and its keys stand down while another window is
over it.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
- [WARNING] `cnHeld` omitted `dialog[open]`, unlike `tipModalOpen` --> FIXED (same set)
- [WARNING] the Change in Settings fallback (focus the row) was untested --> FIXED (arm; removing the row's tabIndex reds it)
- [NIT] two server.test.js messages said the opposite of what they check --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] focus opened on Got it, so an Enter in flight could dismiss it unread --> FIXED (the box, What's New's rule; Tab arm)
- [WARNING] `migrate()` reverses part A's rejected migration without saying so --> FIXED (recorded in the plan and on the card)
- [NIT] `migrate()` runs after `listen` --> NOT A DEFECT, measured (it runs before `start()`, where `listen` is)

#### Iteration 3
**Reviewer model:** sonnet
- [WARNING] the notice's keys acted with first run or the update overlay over it --> FIXED (`cnCovered`, capture phase, stopped; an arm reds without the guard)
- [WARNING] only the boot-cover hold was pinned --> FIXED (HELD arms for a dialog, first run and the update overlay; all three red when removed)
- [NIT] two tabs each show it once, undocumented --> FIXED (comment; What's New's accepted cost)

#### Iteration 4
**Reviewer model:** sonnet
- [BLOCKER] after a wait the notice opened on a stale read, so a switch turned OFF meanwhile still got a notice and a record --> FIXED (`cnPending` re-reads; STALE arm reds without it)
- [NIT] What's New has the same boot-cover gap --> DEFERRED, filed as #4328 with the one-line fix

#### Iteration 5
**Reviewer model:** sonnet
- [NIT] `migrate()`'s refusal on a stat error other than ENOENT was untested --> FIXED (a self-looping link; a locked folder was tried first and could not discriminate, so it was replaced)
- [NIT] `dialog[open]` in `cnHeld` is unexercised --> NOTED (no `<dialog>` on the page; mirrors `tipModalOpen`)
**Converged** - no new actionable findings.

### Final Ledger

The per-iteration list above is the ledger; each fix is one commit named with its review number.

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs noted, not acted on
- `dialog[open]` unexercised (5).

### Strengths (across all iterations)
- "Seen" is recorded only when the notice can be seen: never under the boot cover, another window, or on a stale answer.
- Each hold and each key rule has a browser arm that reds on the mutation that removes it.
