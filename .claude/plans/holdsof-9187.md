# kosmos#9187: the re-read detector misses a hold that waits, or waits on the person

## Measured (origin/main)
`engine/projects.js` `holdsOf` read a task line's hold with `/ \[on hold: [^\]]*\]$/`. blockBody's `held()` also prints
`[on hold until <what it waits for>: ...]` (#7180) and `[on hold, waiting on your person: ...]` (#7788). Neither
matched, so `rulesChangedIn` returned false when such a hold was set on, or lifted from, a task an agent holds: no
re-read was owed. A plain hold, the control, was owed.

## Change
`holdsOf` matches every form held() prints: ` [on hold` then `:`, `,` or ` until `, to the line's closing `]`.

## Decided, and the weakest premise
- One pattern for the three openings, not a list of held()'s exact sentences: held() rewords often, and the shapes
  `[on hold` + `:`/`,`/` until` are what all its marks share. Weakest premise: that held() keeps those openings; a
  new form opening differently would be missed again. What would change my mind: a fourth form.
- A change in WHAT a hold waits for (another task, another time) now also owes the re-read, since the mark changes.
  That is right: the agent's copy would say the wrong thing.
- A task's own words ending in "[on hold until ...]" would now also be read as a hold; #9179 (quoting such titles)
  closes that, and is in review.

## Tests
`engine/projects.holdsof-9187.test.js`: each form (plain as the control, until, waiting on the person) set and lifted
owes a re-read; a sync that changes nothing owes none. Red on main for the two new forms; dropping either half of the
pattern turns its test red. Neighbours (hold, re-read, pause tests) 381/381.
