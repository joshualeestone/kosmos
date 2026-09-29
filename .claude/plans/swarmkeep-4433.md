# swarmkeep-4433: "Keep it running" gets an edge as firm as Stop's

Card: #4433 (merged as #4452; this is Mona Lisa's design follow-up, 2026-09-29 00:18).

## Why
render-fields, once it could read the confirm box's color-mix() background (#4452), counted d-swarm-keep among the boundaries under WCAG 1.4.11's 3:1: a plain .btn edge (0.5px --border-strong) on the danger-tinted box. Mona: give it more edge, `#d-swarm-keep { border: 1.5px solid var(--label); }`, the same weight as Stop, with fill and text unchanged. She had not run the check and said its result wins.

## Built
One rule after .swconfirm-btns. The id outranks .btn.

## Measured
render-fields' under-3:1 count per engine and theme, before (main at 1f166568, from #4452's last run) and after this commit, on the frozen commit.
