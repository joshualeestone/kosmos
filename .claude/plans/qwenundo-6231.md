# qwenundo-6231: #6231 item 13

From the independent review of #6238: in `engine/create.js` restoreAccount, the Qwen profile rollback after a failed job
write sits in a catch that swallows. If the job write fails AND the rollback write throws, the profile names the old
account while the job stays on the move's. "Two failures in a row, low risk; at least say so in the result rather than
only in the comment."

## Finished looks like
When both fail, the refusal restoreAccount returns says, in its own sentence, that Kosmos's note of the Qwen account names
the old account, so a restart moves the agent to the new account but a Repair would put it back on the old one. The
sentence the person reads (engine/accountmove.js, the put-back's partial line) stays true for that state.

## Done
- `engine/create.js` restoreAccount: the rollback's catch returns the job's refusal with its own `because`. It does not
  append to the job's text, which says "nothing changed" and would then be false (review 1).
- `engine/create.qwen-5977.test.js`: the job write fails for real (the job and its folder are read-only), and only the
  second profile write throws. The test asserts the record is left on the old account, the sentence, and the absence of
  "nothing changed". It skips on Windows and as root, where a read-only folder does not stop the write.

## Controls
Main's create.js (the swallow) and the first version (the appended sentence) each turn the test red.
