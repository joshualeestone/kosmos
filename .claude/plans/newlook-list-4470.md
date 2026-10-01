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

Validation: render-newlook-4470.js 152/152 on the branch; control: main's page fails exactly the three "On, Agents
list" arms; the name-alignment arm reads center with the look off and left with it on. render-working-pulse-3956
and render-dm-badges-2863 pass on the branch. Shots: ~/work/design-shots/kosmos-4470-list.
Not yet: the org chart (next page).
