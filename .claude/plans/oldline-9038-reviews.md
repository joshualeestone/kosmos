# oldline-9038: review record (kosmos#9038)

| Round | Reviewer | Commit | Findings | What was done |
|---|---|---|---|---|
| 1 | opus, blind | 2683480c73 | 1 B, 1 MAJOR, 3 MINOR, 1 NIT | all fixed |
| 2 | opus, blind | 6278f45d3b | 0 B, 3 MAJOR, 4 MINOR, 2 NIT | redesigned |
| 3 | opus, blind | e82d349149 | 0 B, 0 MAJOR, 4 MINOR, 4 NIT | minors fixed, nits fixed or declared |
| 4 | opus, blind | 66be62288d | 0 B, 1 MAJOR, 1 MINOR, 2 NIT | major and minor fixed, nits declared |
| 5 | opus, blind | 351b103ac3 | 0 B, 0 MAJOR, 2 MINOR, 5 NIT | fixed but the last nit |

Round 1: the blocker was keeping what was seen after the line left the screen: a restart or a new turn printed the same text and a
revoked account read calm. Also: the login date could belong to a login the agent does not use.

Round 2: three ways the screen's text still let a new refusal look old, or ended the feature after one unread capture. The text is
no longer the evidence: the refusal's own time in the session's transcript, against the last read of the earlier login date.

Round 3: variables that move the login's Keychain name, a clock set back, work done on ticks that cannot use it, and the real pane
reader never run by a test.

Round 4: round 3's clock guard never ran in production (the cache stops reads until the clock catches up) and its test went round
that cache. It now runs on every tick, with a test through real ticks.

Round 5: the list of other credentials is now a shape, so one not named is a doubt; tests for an error in the tick, another pane, a
failed read and the exact moment. Kept: the two small maps are not swept of removed agents (one entry each).

After round 5: the first full validation (38f31cc368, 07:12 CST 11-25) was red on one gate, check-frozen-roots: it read past a line
above the new function and took its lookup of the home folder for a constant's. The lookup moved into oldsigninline; no behaviour
changed. Its node suite had passed (31,231 tests, 0 failed).
