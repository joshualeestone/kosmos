---
pre_challenge: true
method: challenge-loop
branch: pressid-7020
diff_hash: 5b1cf48a5f92724bb5282160f813a97b334877e3024583d5cad1c67c652ebd85
validation: passed
subdir_audit: passed
timestamp: 2026-10-24T07:38:20Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 blind reviewers (opus, opus, sonnet), each given the code, not my conclusions.
**Converged:** Yes (iteration 3: nothing real; it re-raised only two points already decided in the plan)
**Fixed:** 2 major and 3 minor findings in rounds 1 and 2 | **Deferred:** 2 noted points below | **Asked:** 0

Validation at 88a3da73e5 (rebased onto origin/main after #7027 merged at 2f5ee13b16; origin/main not ahead at proof time):
- Focused run through tools/run-tests.sh --only via queued-heavy.sh (started 02:37:34, after the rebase): server.permission-request-7020, server.permission-answer-6054, server.permcard-6727, server.phonenotice-permission-7017, server.question-menu-5406, engine/chat.question-menu-5406, web.dmchoices-5406. END rc=0: 112 tests, 112 pass, 0 fail, 0 skipped.
- iOS: ios/LogicTests/run.sh PASS 801/801; run-actions.sh PASS 97/97 (on the rebased tree).
- Type-check: no expression over 20 ms in the touched Swift files, and none of the new lines over 1 ms (control at 1 ms flags 138 others).
- Mutants, each made in place on a committed tree and restored, each turning its test red: the route check, the last-look request check, the last-look non-permission refusal, the after-key reading, the route passing the request into answerQuestionMenu, the automatic-message guard, the board page's send, answered lock and generation, the iPhone body, key and reported filter, BoardClient's wiring, and the notification's wiring.
Subdirectory CLAUDE.md audit: none under ios/, engine/ or web/.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [MAJOR] the request was checked on the route's read only; answerQuestionMenu's own last look before the key re-checked the identity, which two prompts differing only in spacing share. Fixed: the last look re-checks the request; tests direct and through the route (screen swapped on exactly the last read before the key), each with a control that the redraw gets through without it.
- [MAJOR] the lock-screen Allow/Deny press did not send the request. Fixed: NotificationAction.pressRequest passes press.request (Mona Lisa told).
- [MINOR] the without-asked test was refused by a later check either way. Fixed: asserts the request check's own sentence.
- [MINOR] an automatic message could carry a request. Fixed: refused like chose/asked.
- [MINOR] a deduplicated question row serves no card, so the press falls back to the asked-only checks. Noted: loses only the new protection.

#### Iteration 2
**Reviewer model:** opus
- [MINOR] a press that named a request could be typed at an ordinary Claude menu worded like a permission prompt. Fixed: refused; test with a control.
- [MINOR] the answered lock now includes the request, so a re-read at another width lifts it at once. Noted: a second press is still checked on the last look, so at worst the same prompt gets a second key.

#### Iteration 3
**Reviewer model:** sonnet
- Nothing real. Confirmed the newest refusal cannot refuse an honest press (a request exists only where claudePermissionPrompt matched, which also marks the menu as a permission prompt).
