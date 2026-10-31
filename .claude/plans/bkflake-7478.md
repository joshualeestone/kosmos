# bkflake-7478: the backup upload tests' "lost answer" arms no longer race two timers (kosmos#7478)

## Problem
Three arms in engine/backupupload.test.js make a PUT's answer "lost" by holding it 400 ms while the uploader times out
at 100 ms. That is a race between two wall-clock timers: on a busy Mac the 100 ms timer can fire after the held answer
arrives, so the PUT reads as answered. It flaked once in a full run (1 of 25295, #7411's validation, 10-28), at
"a lost answer that LANDED, then S3 says the grant expired".

## Decision
The fake bucket takes Infinity as a hold: that request is never answered, so the uploader's own timeout is the only
way on (close() ends the connection). The three lost-answer arms use it. Test-only; the uploader is unchanged.

Not changed: "if a worker throws, nothing keeps uploading after the result is returned" holds chunk 2's answer 300 ms on
purpose (it must arrive later to show nothing acts on it); never answering would hollow that arm out.

Rejected: a longer hold (a race that is only less likely); a fake clock (the uploader's timeout is a real socket timer).

## Tests
The file passes 98 of 98, three runs in a row. Control: answering the first PUT at once (hold 0) reds the LANDED arm
with the flake's own error (`true !== false` at r.ok), so the arm still fails when the answer is not lost.
