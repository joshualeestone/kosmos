# shothooks-7421: the chat header keeps a long name, and the design-shot hooks Mona Lisa's last shots needed (kosmos#7034, #7421)

## Finished looks like

- A long agent name in the chat header ends in an ellipsis instead of vanishing, on the smallest phone (iPhone SE) and on others, in portrait and landscape. The trailing capsule (star, search, info) keeps its size.
- Debug-only design-shot hooks: KOSMOS_SAMPLE_STARS (with KOSMOS_SAMPLE_AGENTS=1) gives the sample a known star list so the header star shows; KOSMOS_SAMPLE_SORTMENU=1 opens the Agents sort menu. Nothing reaches a Release build.

## Found by

Mona Lisa's 14-character long-name check (shot run 3): on the SE, with the star added in build 11, iOS dropped the whole title.

## Decided

- The title is capped at the chat's measured width minus the room the trailing buttons take: 300 pt with the star (three buttons), 250 without. Measured on simulators: the SE shows "Maximi...", the iPhone 17 "Maximilia...". Mona Lisa approved both.
- Rejected: reading UIScreen's width (ignores landscape margins, and a rotation can be read before the interface turns). Rejected: an orientation observer.
- Weakest premise: 300 and 250 are measured against today's three and two buttons; adding a fourth would need a new number. At accessibility text sizes a short name is shortened on the SE (still shown, never dropped).

## Reviews

1. No blocker. Sample stars needed the sample agents too; the cap ignored a missing star; rotation did not redraw; two hook nits. All taken.
2. No blocker. The orientation notification could race the interface turn, and UIScreen's width ignores landscape margins: replaced by a measured width.
3. No blocker. Nits only (a one-frame seed in landscape; UIScreen deprecation predates this). Converged.
