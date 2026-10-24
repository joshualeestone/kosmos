---
pre_challenge: true
method: challenge-loop
branch: notifallow-7017
diff_hash: 6e1376da7cc7039618779971092fb8e175eee2e34ddb99fc2410e436fc7c6e7d
validation: passed
subdir_audit: passed
timestamp: 2026-10-24T07:12:30Z
iterations: 8
converged: false
stopped: at the 8-round cap; rounds 6 to 8 found no BLOCKER; every WARNING through round 8 fixed
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (the cap). **Converged:** No: stopped at the cap. Rounds 6, 7 and 8 found 0 BLOCKERs; every BLOCKER
and WARNING in all eight rounds is fixed, with a control that fails when its guard is removed.
**Stated residual:** a deny-list cannot name every tool's password flag, so a short password from a tool not listed can
still reach the notification text. Mitigated: iOS shows previews only when unlocked by default, Allow asks to unlock,
and the board shows the same text.

Validation, at 542d3ce97e:
- Full validation (validation-log, stack=typescript, hash 6e1376da7cc7): PASSED, 23,647 tests, 0 failures, EXIT=0.
  (The run before it, at d61a0b1734, failed 1: the #6487 catalog drift test caught the new permission body; the page
  and the test were updated in 542d3ce97e.)
- iOS: run.sh 705/705, run-actions.sh 96/96, run-settings.sh 41/41; simulator Debug build of the app and the extension
  with -warn-long-expression-type-checking=100 SUCCEEDED.

## Iteration 1
- [BLOCKER] the lock-screen body was the hook's "needs your permission to use Bash": Allow approved a command the
  person never saw. Fixed: the notice carries `shown`, the request in the board card's words.
- [BLOCKER] the buttons read whatever prompt was up, untied to the notice's report. Fixed: only the agent's current
  automatic permission wait (isAutoPermissionWait, rep.at === the notice's time).
- [WARNING] one identity cap on both sides. [WARNING] an undecodable permission cost the words too; now only the
  buttons. [WARNING] an unreadable chat said "it changed".

## Iteration 2
- [WARNING] a command shown by its first line and cut at 400: a continued line or heredoc read as harmless. Fixed:
  the whole request or no buttons.
- [WARNING] a file's text or a tool's arguments could become the headline. Fixed.
- [WARNING] a sure press was silent. Fixed: "Allowed for <agent>."

## Iteration 3
- [BLOCKER] a file request showed only its name. Fixed then (name and whole text), superseded in iteration 5.
- [WARNING] every 409 read as "changed". Fixed: the board's own reason. [WARNING] bidi and zero-width characters.
  [WARNING] secret-shaped commands.

## Iteration 4
- [WARNING] a blank line kept the file's line numbers as text (the gutter regex). [WARNING] a control that could not
  fail. [WARNING] an unreachable cap's test. Fixed; the extension clears push-borne Allow/Deny.

## Iteration 5
- [BLOCKER] a line Claude Code wraps itself lost a leading number as a "gutter" (chmod -R 777 read as chmod -R).
  Decision: no file gets lock-screen buttons; the gutter is read only when it numbers every line 1, 2, 3.
- [WARNING] password flags (curl -u, mysql -p, sshpass).

## Iteration 6
- [WARNING] PGPASSWORD=, MYSQL_PWD=, -uX:Y, redis-cli -a, docker login -p. [WARNING] a qualified title. Fixed.
- [NIT] message style now carries content.body; edits keep the earlier gutter reading.

## Iteration 7
- [WARNING] a bearer token with no known prefix, a cookie header, --token. Fixed with a wider list and a token
  backstop over the whole shown text. [NIT] asked null says cannot-answer-from-here.

## Iteration 8
- [WARNING] eleven short passwords from common tools. Fixed with a general password-named-flag rule and the shapes.
- [WARNING] the backstop refused everyday commands. Fixed: split at - . _; an ordinary-commands test asserts they
  still get buttons.
- No BLOCKER. Loop stopped at the cap.
