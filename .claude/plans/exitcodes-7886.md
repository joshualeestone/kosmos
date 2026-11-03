# exitcodes-7886: say what an exit status means; the missed-posts line stops reading as a failure (kosmos#7886 items 1, 4)

Finished means: `kosmos help` on the Mac and on Windows says, in the same words, what exit statuses 0, 1, 2 and 3 mean,
and the room's catch-up line no longer says posts "did not reach you" when they were never meant to.

## Item 1: room post exits 3 on success
The report: a post that went through but could not confirm every member prints "do not re-post" and exits 3, and a
script reads 3 as a failure, inviting the re-post. Ask: exit 0 with the warning, or a distinct documented code.

Decided: keep 3, document it. 3 is already the CLI's code for "not a plain yes or no" (22 `exit 3` sites in
install/kosmos, and the Windows CLI's `maybe()` returns 3). It is the right code for an outcome that says do not send it
again. Rejected: exit 0, which would break the convention for the one command where "do not re-post"
matters most. The help sentence does not say "3 means it happened": `kosmos update` returns 3 for a refusal, so it says
read what was printed before sending again, which is true at every site.

Weakest premise: that agents and scripts read `kosmos help`. The outcome's own words already say "Do not re-post"; the
help is for the script writer.

## Item 4: "did not reach you"
`engine/messages.js` counts posts in the window that were not addressed to the reader, or that were quiet for them, and
said "N earlier posts this hour did not reach you", which reads as a delivery failure. Now "you have not seen N earlier
posts from this hour", true of both kinds. Rejected: "not addressed to you", false for a quiet post that was addressed.

## Tests
- cli.exit-status-help-7886.test.js: the sentence in both CLIs' help, word for word; the unconfirmed post branch still
  exits 3 (red when mutated to exit 0).
- messages.test.js and roomloop-7246.test.js: the catch-up assertions use the new words (4 red with the old words).

## Not in this branch
Items 2, 3, 5, 6, 7, 8, 9 of #7886 stay on the card for whoever takes them.
