# quietdm-noise (kosmos#6479)

From a noise pass over the 0.7.56 board (Splinter 2026-10-18 08:20, Josh's theme "we are junking up our nice clean
interface"). On an agent's Direct Message, while the agent is working, the thread ends with "Nothing back yet." directly
above "<name> is working…": two lines saying one thing.

## Done means
With an owed message and the agent working, only "<name> is working…" is visible. With the agent idle, "Nothing back
yet." shows as today. A sign-in failure in the same slot does not hide it.

## Change
- web/index.html, dmOwesLine: the "Nothing back yet." paragraph gains the class `dmquiet` (the other two thread
  lines, "We could not read…" and "It finished without replying here…", do not).
- paintBusy marks the slot it fills: `data-state="working"` or `"auth_failed"`, removed when the slot hides.
- One CSS rule: `#d-sec-talk:has(#d-busy[data-state="working"]:not([hidden])) .dmquiet { display: none; }`.

## Decided
- **CSS keyed on the slot's own state, not a second "is it working?" test in the thread code.** paintBusy already owns
  that decision (including the #2660 stale-sample rule); the thread renders asynchronously and would need its own copy.
  The rule follows the slot exactly, on every paint.
- **Kept, not removed.** "Nothing back yet." is the one signal that an agent went quiet (Josh kept it; #4340), so it
  stays for the idle case it exists for.
- Rejected: removing the line, or rewording either line (Josh's copy).

## Weakest premise
That `:has()` works in every engine the board runs in. The page already relies on `:has()` for layout (e.g. the
consolidated view and the board bar), so a browser without it is already broken elsewhere; here it would simply keep
showing both lines, as today.

## Tests
render-dm-owes-4340.js: WORKING (drawn but hidden; busy line visible) and AUTH FAILED (visible) arms, each shown red
under a mutation (rule removed; data-state forced to working). web.dm-unsent-4612.test.js expects the new class.
