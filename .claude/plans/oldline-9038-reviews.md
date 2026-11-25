# oldline-9038: review record (kosmos#9038)

| Round | Reviewer | Commit | Findings | What was done |
|---|---|---|---|---|
| 1 | opus, blind | 2683480c73 | 1 B, 1 MAJOR, 3 MINOR, 1 NIT | all fixed |
| 2 | opus, blind | 6278f45d3b | 0 B, 3 MAJOR, 4 MINOR, 2 NIT | redesigned |
| 3 | opus, blind | e82d349149 | 0 B, 0 MAJOR, 4 MINOR, 4 NIT | minors fixed, nits fixed or declared |
| 4 | opus, blind | 66be62288d | 0 B, 1 MAJOR, 1 MINOR, 2 NIT | major and minor fixed, nits declared |

Round 1: the blocker was keeping what was seen after the line left the screen: a restart or a new turn printed the same text and a
revoked account read calm. Also: the login date could belong to a login the agent does not use.

Round 2: three ways the screen's text still let a new refusal look old, or ended the feature after one unread capture. The text is
no longer the evidence: the refusal's own time in the session's transcript, against the last read of the earlier login date.

Round 3: variables that move the login's Keychain name, a clock set back, work done on ticks that cannot use it, and the real pane
reader never run by a test.

Round 4: round 3's clock guard never ran in production (the cache stops reads until the clock catches up) and its test went round
that cache. It now runs on every tick, with a test through real ticks.
