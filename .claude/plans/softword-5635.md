# #5635: a working seat past the rhythm does not read plainly "current"

Addresses #5635.

## What finished looks like
A summary past four hours by the clock, with under four hours of reported work since, says it is not overdue though past the rhythm. Under four hours it still says current. The state and every other reading stay as they are.

## Decided
- Words only, in renderShow's `worked` line. Rejected a new state: everything that reads the state would need a decision, and nothing about what a seat should do has changed. Rejected lowering the 24-hour line: #7785 chose it so a seat woken after a quiet afternoon stays current.
- Weakest premise: that the words are what readers objected to. The report said a reader sees the mismatch as wrong, and asked for something softer, not stale. Would change my mind: a report that this reads as a warning.

## F1
Measured on this fleet 11-05: echo and josh, agents older than the build, carry doctrine v46's line, written at 01:10 with Kosmos's own "bringing its own earlier" frame and no click.
