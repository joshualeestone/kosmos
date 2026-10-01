# newlook-list-4470: the Agents list view in the new look (behind the switch)

Card: kosmos#4470 (one page at a time). Follows #4791 (the Agents cards).

Finished looks like: with the new look on, the Agents list rows take the cards' language: 16px corners, a plain
row with no border (its grey or working-green ground separates it), the needs-you red edge and the could-not-read
dash kept, a border under the pointer, and a wrapped name aligned left. With the look off, nothing changes.

Decisions:
- 16px: between the project page's task rows (10px) and the cards (24px); a row is about 58px tall.
- Hover shows today's border (not a ground change): the ground is the state and must not change on hover.
- The name's button (.namego) centred wrapped text by default; left-aligned in the new look only. Today's look has
  the same defect and is not changed here (behind the switch).
Weakest premise: no drawing exists for the list view; built in the approved project page's language, as #4791 was.

- The could-not-read dash takes --border-strong in the new look (rows and cards): the remapped rule grey measured
  about 1.04:1 on its ground in light, so it was kept in name only (review round 3). Now 1.75:1 light, 2.28:1 dark.

Validation: render-newlook-4470.js 164/164 on the branch. Controls: (1) main's page fails the "On, Agents list" arm
that reads the border, corners and name alignment (the other list arms guard against future rules and pass on main
too); (2) without the dash rule the visible-dash arm fails in all three passes (1.04 and 1.14:1); (3) the mutation
`#alist .lrow:not(:hover) { border-color: transparent }` fails the stroke arm. The name-alignment arm reads center
(off, asserted) vs left (on). render-working-pulse-3956 and render-dm-badges-2863 pass on the branch.
Shots: ~/work/design-shots/kosmos-4470-list.
Not yet: the org chart (next page).
