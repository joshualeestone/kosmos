# sortreset-7684: the Agents list opens on Last talked to, starred on top, on phones that saved a sort before

Card: kosmos#7684 (Josh 10-31: open on Last talked to with starred on top).

## Why
Both defaults are already "talked" (Board.agentSortDefault), and starred agents come first in every order
(Board.agentOrder). But a phone that saved a sort before keeps it: the older saved "board" maps to Needs you first
(Board.agentSort(saved:)), so those phones never see the default.

## Finished looks like
- Once, on the first launch of a build with this (KosmosApp.init), the saved sort (`kosmos.agentSort`) is forgotten and a
  marker (`kosmos.agentSortReset7684`) is set, so the Agents list opens on Last talked to with starred agents on top. A
  sort chosen after that is kept.
- The key is one constant (Board.agentSortKey), read by AgentsView's @AppStorage and the reset.
- LogicTests: an old "board" is forgotten; a later choice is kept (runs once); a phone with nothing saved is only marked.

## Decided
- Forget every pre-change saved sort, not only "board": Josh's ask is the default for everyone, and every phone with a
  saved sort is a beta tester's. Rejected: mapping "board" to talked (a deliberate Needs you first saved since would be
  lost later anyway, and other saved values would still hide the default).
- Weakest premise: that nobody relies on a sort they saved before this build. Choosing it again keeps it.
