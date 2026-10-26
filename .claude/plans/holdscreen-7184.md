# holdscreen-7184: the task page shows and sets what a held task waits for (kosmos#7184, screen half of #7180)

Owner: Mona Lisa. Routed by Splinter 2026-10-26 05:44; reference from Ice Cream Kitty (#7182, 975c5e1d94).
Design call posted on #7184 (comment 6414143491) before the build.

## Done when (from the card)
1. A held task on the screen says what it waits for, in the task list's words, and says when that has happened.
2. The person can put a task on hold until another task in the project closes, or until a date and time, and can
   change or clear that.
3. Holding or re-holding from the screen keeps the stored condition unless the person changed it.
4. Design shots (light and dark, desktop and phone) are on the card before the build is reviewed.

## What it does
- engine/projects.js (joinTaskClaims, withParts): every served task carries `holdUntil`, tasks.holdUntilState's
  { words, met } or null, so the page never works out "met" (a task that is gone counts as met, the engine's rule).
- web/index.html, the task page's hold row:
  - a line, only while held with a condition: "Waiting for task 2 to close." (a link), "Waiting until Wed, Oct 28,
    9:30 AM." (the person's own clock), "Task 2 is closed, so this can come off hold.", "That time has passed, so this
    can come off hold.", "Task 2 is no longer on this project, so this can come off hold.";
  - "Wait for" (Nothing in particular / Another task to close / A date and time), the project's other open tasks or the
    browser's date-and-time picker, and Save, shown only while held. The form follows the stored condition unless the
    person has an unsaved change (the Repeats controls' rule), compared to the minute; Save sends exactly what it shows;
  - "Saving makes this hold yours, so only you can take it off." when the hold is not the person's (what the engine does);
  - "Put on hold" reads the task again first: if it is already on hold (an agent's, unseen by this page), it changes
    nothing and says "This was put on hold a moment ago, so nothing changed." (done-when 3);
  - the page's activity words gain #7182's: "Put on hold until task #N is closed", ", no longer waiting for anything",
    "What its hold waited for happened (...)". The parity test held only because no fixture carried a condition.

## Decided (reversible; reasons on #7184)
- Hold first, then say what for (no condition in the same click as Put on hold).
- Not on the task list cards in this slice; the held group already says On hold.
- The activity keeps the engine's words, so a time there reads as the stored ISO instant (the parity test holds the
  page to the engine); the waiting line above it says the time in the person's clock.

## Weakest premise
That the picker's local time is what the person means. It is sent as that instant (toISOString), so what they see is
what fires, wherever the board runs.

## Checks
- engine/holdscreen-7184.test.js: served holdUntil (unmet, met on close, a time, a time passed, a task gone, off hold);
  dropping the field turns both tests red.
- engine/taskactphrase.test.js: five new fixtures; main's page fails it (1 red), this page passes.
- docs/browser-checks/render-holduntil-7184.js (gated.txt, README row), light 1400 and dark 390: all pass; with the
  stale-page guard disabled it goes red (4), showing the agent's condition replaced and the hold made the person's.
- render-onhold-4771.js still passes. Related node tests 329/329, fixture-discipline and no-name-refs 24/24.
