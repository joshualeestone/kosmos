# #5318: the Prompter nudge offers needs_you, and `report blocked --owner <a person>` points at it

## The defect (0.7.22, a real install)
- The idle nudge (engine/agentnudge.js nudgeText) offered only `kosmos report blocked --on <what> --owner <who>`.
- Agents put a PERSON in --owner (`--owner "Josh"`).
- blocked is never chased (engine/heartbeat.js) and never escalated (engine/recommender.js STUCK_STATES is needs_you
  only, after a 10-minute grace), so person-blocked work went inert. The agent's write-up traced it to the nudge text,
  word for word.

## The change
1. **Nudge** (engine/agentnudge.js): offers both. On another agent, a deploy or a review: `blocked`. On a person (a
   decision, a meeting, an answer): `kosmos report needs_you <your question>`, which Kosmos follows up and blocked
   never is. No quotes in the template: the nudge is typed into the agent's composer and the existing tests allow only
   the two quotes around the task sentence.
2. **Note on report** (engine/selfreport.js `blockedOwnerNote`, wired in server.js POST /api/report): a `blocked`
   report whose owner is a person is RECORDED as sent, and the answer carries `note`. Both CLIs print it under
   "Recorded." (install/kosmos lifts it with sed; tools/windows/kosmos-cli.js prints r.json.note).

## Decided: who counts as a person
- The About-you name, whole or its first word (two characters or more), any case and spacing.
- A person word: person, human, user, operator, boss, founder, me, you (optionally after the, my, our or your).
- An email address.
- NOT a person: any agent on this board (sessionName or display name), and anything else (deploy, review, provider,
  an outside company).

**Rejected:**
- Refusing the report. It would lose a real report over a guess, and an agent may have a reason.
- "Any owner that is not an agent." It would flag every outside party, like a vendor or a deploy pipeline.
- Rewriting the state for the agent. The agent chose blocked; the note gives it the information, and the choice stays
  its own.

**Weakest premise:** the person test is a name match. A person the board does not know by name (a colleague, a
founder
other than the About-you person) gets no note. That is the old behaviour, not a regression. The nudge change is what
reaches every agent, and the note is the second line of defence.

**What would change my mind:** a report of the note firing on an owner that is not a person. The fix then is to
narrow PERSON_WORDS, not to drop the note.

## Tests
- server.blocked-owner-person-5318.test.js:
  - pure rows (15, persons and non-persons);
  - the note is one plain line;
  - the real route on a sandboxed board: recorded as blocked, with the note for the About-you name and a person word;
    no note for a deploy (the control) or for needs_you;
  - both CLIs print it.
  - Control: with the server's note removed, the route test goes red.
- engine/agentnudge.test.js: the nudge offers blocked for an agent, deploy or review, and needs_you for a person.
- 306 related and audit files: 6577 tests, 0 fail.

## Review round 1 (opus)
- [W] FIXED: the template was unquoted, so a real question (`Can Josh pick the cover?`) stops zsh on the `?` ("no
  matches found") and an apostrophe opens a quote: exactly the person-blocker this card is for. The nudge and the note
  now write `kosmos report needs_you '<your question>'` (single quotes: the nudge keeps double quotes to the two around
  the task sentence, and the macOS CLI's sed cannot carry a double quote). A test runs zsh both ways (control:
  unquoted fails).
- [N] FIXED: the note's work (About-you read, roster walk) runs only for a blocked report, not on every automatic
  `working`.
- [N] FIXED: `note` is local in cmd_report.
- [N] FIXED: the CLI tests RUN the code: the macOS CLI's own sed line on real answers, and the Windows CLI's main()
  with a stubbed fetch, each with a no-note control.
- [N] not changed: the person test's width (Josh (sign-off), the team, a bot's email) is the plan's decided trade-off.
