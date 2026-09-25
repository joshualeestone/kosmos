# #3660 fallback, the bubble half (Josh 2026-09-25 07:22)

Renet's board half is merged (#3762): GET /api/setup-guide on a guide that cannot answer returns
{ ok, name, hosted: true, hostedWhy: 'own_model_failing', problem, runner }; 'unchecked' means keep the state; with no
connector the plain { ok, name }; a recovered guide makes the hosted route refuse with own_model.

## Finished looks like
- A guide whose own model is failing: the chat says so in one line with the fix, and its questions are answered by
  Kosmos's backup (the hosted route), not sent to the guide's thread.
- Before each message the bubble asks the board again (Josh: on the next message, not continuously). Answering
  again: the line goes, "Your own AI is answering again.", and questions go to the guide.
- A backup refusal of own_model in the fallback says the same, keeps the words in the box, and ends nothing.
- 'unchecked' changes nothing. A 501 in the fallback turns the backup off for the session, back to the guide's chat.

## The words
- The line is the card's (Splinter's transcription of Josh's design): "Your <Provider> account isn't answering right
  now, so I'm helping on Kosmos's backup." The provider names are engine/accountproblem.js's (#3723).
- The fix, by problem: rate_limited uses #3723's words, "Add credits with <Provider>, or wait until the limit
  resets."; auth_failed follows #3723's "choose Sign in again", as "Its <Provider> sign-in has stopped working: open
  the guide's page and choose Sign in again."; connection_lost has no #3723 sentence, so: "<Provider> cannot be
  reached just now; it picks up again by itself once it can." (my call, the plainest true statement).
- "Your own AI is answering again." is Renet's phrase from the card.

## Decided
- In the fallback the chat shows the backup's conversation (the one the hosted assistant keeps in this window), since
  that is who is answering; the guide's thread returns when it answers again. Rejected: mixing the two in one thread
  (two sources, one list, and the guide never saw the backup's answers).
- The guide's picture stays on the bubble in the fallback; the line says who is helping.

## Weakest premise
The fleet fixture cannot make a card read out of credits, so H27 gives the board's own_model_failing answer in the
check (the board half is tested on its side, #3762). H29's flip back reads the real board.

## Verification
render-assistant-hosted-3660 H27-H29, 104 pass.
