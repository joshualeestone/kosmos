# fourtabs-7266: #7266 slice A, four tabs like the desktop

Card: kosmos#7266 (Josh 10-26; plan comment 6429906013, slice A). Slices C (switcher-7266c) and B (profile-7266b)
are stacked on this branch.

## Finished looks like

The iPhone app shows four tabs like the desktop board (Agents, Projects, Tasks, Settings), with Today removed. Agents
and Projects each carry a + that opens the board's own new-agent or new-project form, over the tabs, through the
board's door. The tab icons are the user-tie (Agents) and briefcase (Projects), drawn at tab size, with the icon's
credit linked from Settings. All three slices are design-approved by Mona Lisa.

## Steps

1. ShellLogic: four tabs (Tasks always shown now that Today is gone), the icon asset names, the create door names, and
   a tracker press that carries a door.
2. Board page (web/index.html): the door takes new-agent and new-project and opens the board's forms; an unknown name
   opens neither. render-apptabs-6846.js and web.app-tab-6846.test.js cover it.
3. Views: the + on Agents and Projects (separate toolbar items on Projects), the Agents footer copy, the TabAgent
   asset with an explicit size.
4. Verify: LogicTests, the web test and the browser check, a simulator build and shots, blind review, proof, PR.

## Decided

- A refused create falls back to Projects or the board's create page. A create refused under a box or an inert bar
  answers 'covered', which means no answer, so the press waits rather than reloading the page under the box.
  'absent' means the board has no door (an older board) and falls back. Only the newest press falls back.
- Weakest premise: a create left waiting while covered has nothing of its own to wake it; it relies on the box's close
  button and every tab change sending a native press (review 4 checked that they do).

## Review

Rounds 1 to 3 found and fixed real defects (see the commit subjects). Round 4 found nothing in this slice.
