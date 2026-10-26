# holdcond-7180: a held task can record a checkable reopening condition (kosmos#7180)

Owner: Ice Cream Kitty. From agent feedback; split from #7149 ask 2, which left it to #6683 (#6683 built only a prose/time
`--until` on reports, which nothing evaluates). Decision posted on #7180 before building.

## Shape (first slice)
- `kosmos task hold <project-id> <n> --until-task <m>`: reopens when task #m of the same project is closed (or gone).
- `kosmos task hold <project-id> <n> --until <date or time>`: reopens once that time has passed (at most a year ahead).
- Stored on the task as `onHoldUntil` ({ task } or { at }), checked by tasks.holdUntilOf, read by tasks.holdUntilState.
  One condition per hold. A hold sets exactly what it is given: a bare hold clears an earlier condition. Unhold and
  close clear it. A changed condition is recorded as a new hold (its history row carries `until` in words).
- Route: POST /api/project/<id>/task/<n>/hold takes `until` beside `onHold`.
- engine/holdstale.js: an unmet condition parks the hold (nobody is told, whatever the posts). A met one is told to each
  owner once (the existing holdStaleTold mark), at any age and with no posts needed, in its own line ("... was put on
  hold N hours ago until task #5 is closed, and that has now happened. If its work can go on now, take #4 off hold:
  kosmos task unhold ..."). A person's hold asks the owner to ask the person. Met and posts lines are never merged.
- Shown: the CLI list (both CLIs: "[on hold until task 5 is closed]"), the assignees' instructions' held mark, the task
  activity phrasing (hold-set "until ...", hold-stale "What its hold waited for happened").

- The person's hold: an agent cannot change what it waits for (403, as unhold). Its mark is dropped only when the held
  state flips, never by a changed condition (review 1 found that path let an agent strip the mark, then lift the hold).
- A wait that leads back to the held task (A waits for B, B for A, or longer) is refused: it would never be met.
- An agent's bare re-hold of the person's hold leaves it whole (condition and mark); an agent changing its condition
  is 403. The person's screen hold sets exactly what it says, so it drops an agent's earlier condition.
- Times: only a real ISO date or date-time is taken (2026-11-31 or T24:00 are refused, not rolled over) (not "2026-11-02 09:00" or "Nov 2", which Date.parse reads in the
  board's zone); a bare date is midnight UTC; a time of day must carry Z or an offset (refused otherwise, since the board's zone
  may not be the agent's). Both CLIs say back the time the board stored, not the one typed.

## Rejected
- "File P exists": an agent-given path read by the board is a new surface; not observed today.
- "Flag F set": there is no general flag store.
- Evaluating free text: nothing can test it (#6683's report --until stays prose).
- Lifting the hold automatically: the hold may be the person's; telling is reversible, a surprise lift is not.

## Weakest premise
That one line when met is enough. The met line has its own mark (holdMetTold), so after it the posts rule still applies
to the hold as to any other: an owner that keeps working in the room is told again.
Also: an unmet condition parks the hold with no ceiling. That is the point of the card (no asking while it is unmet),
and the list and instructions show what it waits for. A task waited for that never closes keeps its waiter parked.

## Not in this slice
- The screen (web/index.html) still shows a plain "on hold" and cannot set a condition; the condition is in the CLI,
  instructions and activity. A follow-up for the screen if a person asks why a hold is silent.
- The idle nudge does not repeat a met condition.

## Checks
- engine/holdcond-7180.test.js: storage and every refusal (self, missing, closed, bad time, past, over a year, two kinds,
  with unhold); clearing (bare hold, unhold, close); one history row per change; met/unmet for task, gone task, time;
  holdstale park (with a CONTROL that the same hold without a condition is owed), met told once at any age, the met
  line and the person's variant, met and posts never in one line; instructions' mark; activity phrasing with controls.
- Mutations, each red: unmet not skipped; met needing posts; one group for both reasons; mark without the condition.
- Sweep with one shared book: a met line, then a posts line for the same hold, both delivered (red with the reason left
  out of the book key; review 3 found the met line blocked every later line until a restart).
- Route (server.test.js): stored and answered, 400/409 kept, zoneless refused by name, unhold-with-condition refused, an
  agent's change to the person's hold 403 with the mark kept (CONTROL: a bare re-hold keeps it). Red without the 403.
- CLI: both CLIs send the condition, say what it waits for, refuse bad values unsent, list "[on hold until ...]".
  The #4889 unknown-flag rows used `--until friday` as an unknown flag; moved to `--after friday`.
