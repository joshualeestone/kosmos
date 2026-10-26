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

## Rejected
- "File P exists": an agent-given path read by the board is a new surface; not observed today.
- "Flag F set": there is no general flag store.
- Evaluating free text: nothing can test it (#6683's report --until stays prose).
- Lifting the hold automatically: the hold may be the person's; telling is reversible, a surprise lift is not.

## Weakest premise
That one line when met is enough. An owner that ignores it is covered only by the posts rule once it works in the room.

## Not in this slice
- The screen (web/index.html) still shows a plain "on hold"; the condition is in the CLI, instructions and activity.
- The idle nudge does not repeat a met condition.

## Checks
- engine/holdcond-7180.test.js: storage and every refusal (self, missing, closed, bad time, past, over a year, two kinds,
  with unhold); clearing (bare hold, unhold, close); one history row per change; met/unmet for task, gone task, time;
  holdstale park (with a CONTROL that the same hold without a condition is owed), met told once at any age, the met
  line and the person's variant, met and posts never in one line; instructions' mark; activity phrasing with controls.
- Mutations, each red: unmet not skipped; met needing posts; one group for both reasons; mark without the condition.
- CLI: both CLIs send the condition, say what it waits for, refuse bad values unsent, list "[on hold until ...]".
  The #4889 unknown-flag rows used `--until friday` as an unknown flag; moved to `--after friday`.
