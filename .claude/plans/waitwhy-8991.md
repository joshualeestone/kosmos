# waitwhy-8991: an agent's card says in plain words why it is waiting on the person (kosmos#8991, part 1)

**Posture:** production

**Finished looks like:** an agent waiting on the person says why, in plain words, where #8979's restart line is said:
the pill's hover and its screen reader text (never a line on the tile, Josh #6716). Part 2 of the card (restarts) is
#8979, merged. Splinter narrowed this card to part 1 on 2026-11-24.

## Measured first (the card is a snapshot)
The card names three reasons: a usage limit, a sign-in, a person. Two were already said on origin/main 87918b0c75 (before
this branch):
- a usage limit: pill "Rate Limit" (Josh #6398), hover "Out of usage until <time>." or "Looks like a usage limit ...";
- a sign-in: pill "Sign-in Issue" (Josh #6716), hover "Its Claude sign-in isn't working".
- a person: pill "Question", "Question held", "Needs permission" or "Issue", and NO sentence: stateReason returned ''
  for every needs_you except #4006's failed restart. That is the gap this branch closes.

## Change
- web/index.html stateReason: after #4006's failed-restart arm, a needs_you agent gets one fixed sentence, chosen in
  stateCopyOf's order so the pill word and the sentence agree:
  - held question: "It has a question for you and is holding it until you are back. Open it to answer."
  - question: "It has asked you a question and is waiting for your answer. Open it to answer."
  - permission prompt: "It is waiting for your permission to go on. Open it to answer."
  - anything else: "It is waiting for you. Open it to see what it needs."
  Never the agent's own `because` (#986, #3043, #3271). Earlier arms still lead: #8719 untied window, #5154 crash loop,
  #4006 failed restart.
- engine/waitwhy-8991.test.js: each sentence; pill word and sentence agree (stateCopyOf lifted); the agent's words
  never show; the sentences that say more still lead; no other state borrows these words; the tile stays empty.
- docs/browser-checks/render-waitwhy-8991.js (+ gated.txt, README row): the real card() in Chromium and WebKit at
  1100 and 390 px: hover and hidden text per kind, the agent's words absent, nothing drawn on the tile; idle, working and usage-limited controls.
- web/index.html taskLine: returns '' for needs_you, so the agent's page line (#d-task) stays empty as well as hidden,
  and the older pins that taskLine(needs_you) is '' (web.pane-title-status #209, web.said-line #6118, server.test.js's
  detail badge) hold unchanged. The pill reads stateReason through pillSay, not taskLine. (First cut rewrote two of those
  pins; the first final validation then failed the third, server.test.js, and the fix moved here instead.)

## Where it shows, and where not
- Pill hover and screen reader text on the card and the list row (pillSay -> stateReason).
- Not on the tile (taskLine with card: true returns '').
- Not on the agent's own page: taskLine returns '' for needs_you, so #d-task stays empty and hidden (server.test.js's
  #209 pin; the first final validation caught that it was hidden but filled).

## Rejected
- The agent's own `because` in the sentence: Josh's #986/#3043/#3271 rulings keep the agent's words off these surfaces.
- Engine `because` strings for a scraped needs_you (some are fixed engine words): mixing sources would let a future
  engine string reach the card unreviewed. One fixed sentence per kind instead.
- Changing the pill words ("Issue", "Rate Limit", "Sign-in Issue"): they are Josh's rulings (#2808, #6398, #6716).
- "Not started yet" (an idle agent that never took a turn): its pill already says it plainly, and whether it waits on
  a person or on a delivery is not known from that field.
- Editing #8979's browser check: Angel's #8988 is in flight beside it; a separate check avoids a conflict.

## Weakest premise
That "It is waiting for you" is true for every needs_you that is not a question or a permission prompt. needs_you means
the board read the agent as stopped on the person (a drawn prompt, a menu, a consent dialog, a report); if a future
classifier sets needs_you for something the person cannot answer, this sentence would mislead.

## Tests
- node --test engine/waitwhy-8991.test.js: 4/4. Mutation (block removed): 2 fail.
- render-waitwhy-8991.js headless: 72 PASS. Mutation: 32 FAIL.
- Every web*.test.js from the worktree root: 3857/3857. Every browser-checks*.test.js: pass.
