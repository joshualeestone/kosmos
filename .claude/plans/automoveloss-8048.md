# automoveloss-8048: the automatic mover does not move agents onto an account that would lose them skills or hooks

Card: kosmos#8048 (follows item 3, PR #8064, which added engine/accountcarry.js).

## Problem
`kosmos agent move` now says what a move would lose and refuses --yes into a loss. The automatic mover (armed on both
Macs since 2026-11-05 15:26) has no such check: it would move agents onto a drifted account folder (Mortals: two skills
and two gate hooks are in ~/.claude only) without a word.

## Change
- engine/autobalance.js targetFor: skip(dir, fromDir) is also given the account the agents leave.
- engine/automove.js skipTarget(nowMs, wouldLose): a target is held when wouldLose(from, to) is true, or throws
  ("cannot tell" is never safe). Pairs held this tick are kept in state.lossHeld; the record gets one `held-loss`
  line when that set changes, never every tick. decide() then picks the next target, or holds the agents.
- server.js moveWouldLose(from, to): accountcarry.losses with the board's own home; true on ok:false or a loss.
  automoveDeps.wouldLose and the Settings read's skipTarget both use it, so the page never shows a move the mover
  would not make.

## Weakest premise
That holding is better than moving: an agent at the wall on a full account stays there if every account with room
would lose a gate. The `held-loss` line makes that visible; fixing the drift (linking Mortals' folders) is the cure.
