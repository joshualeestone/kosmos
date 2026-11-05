# movecheck-8048: say what a move would lose, and a sanctioned `kosmos agent move`

Card: kosmos#8048 item 3. Design and measurements are on the card (comment "Item 3 ... measured first").

## Problem
A move writes the agent's account and restarts it; the agent then runs with the TARGET folder's skills/ and
settings.json. Nothing carries them. On Mortals the account folders are drifted copies (two skills and two gate
hooks in ~/.claude only), so a move can drop them silently. And no fleet agent has a sanctioned way to move another:
the only path is a person clicking in Settings.

## Slices
1. engine/accountcarry.js: losses(fromDir, toDir) -> skills by name and hooks by script basename that the source has
   and the target lacks; an unreadable folder is { ok: false } ("cannot tell"), never "nothing lost". (this commit)
2. A board read: the move's plan for one agent and one account (what it would lose), for Settings, the verb and the
   automatic mover to share.
3. `kosmos agent move "<name>" "<account>" [--yes]`, modelled on `kosmos agent remove`: read the plan, confirm on a
   terminal or refuse without one (unless --yes), post to the existing move route, read the outcome back.
4. After wallrescue-8048 merges: the automatic mover skips a target that would lose skills or hooks, and records why.

## Not in scope
Fixing the drift on Mortals (linking the account folders to ~/.claude): a box setup change, after the 0.7.92 hold.

## Weakest premise
That skill folder names and hook script basenames are the right identity. A same-named skill with different
contents reads as kept.
