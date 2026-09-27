# #4080: the Kosmos Plus pane to Josh's design (22:22)

## Finished looks like
Settings, Kosmos Plus, connected, reads as Josh's mock (/Users/agent1/.cache/claude-handoffs/4080/josh-plus-design-2222.png):
- the Kosmos+ logo at left, then a switch (on when reachable, off pauses: PUT /api/remote on:false), then Connected;
- a rounded box "Sign in at login.kosmosplus.com." with Open;
- "Devices that can reach this computer" with the rows and no explanatory line;
- a bottom row: Remove this computer (red, #4079) at left, View account at right.

Gone: "Use Kosmos from anywhere", the machine address, the Pause/Turn off link, the "Each one asked..." line, and the "I lost my phone" essay. The second-step reset stays reachable from a quiet "Lost your phone?" dialog. A browser check covers it; it's shared page code, so Windows gets it too.

## Change
- web/index.html: new head row (logo canvas #plus-logo drawn by kplusBarDrawMark(cv, 22); #plus-switch is a .toggle
  role=switch painted by paintSwitch); #plus-chip holds #plus-chip-say + Open to PLUS_ACCOUNT_URL; the devices hint
  is removed; bottom row #plus-forget.plus-foot; #plus-lost-modal dialog (the reset, ids kept) beside #plus-gate-modal;
  the #plus-next address instruction is no longer shown.
- Checks: render-plus-panel-3829 (new #4080 arms; the #4079 arms kept), render-plus-signin-3478 (box instead of
  address); unit tests plus-tab, plus-stale, lost-phone updated to the new pane.

## Decided
- The logo is drawn from the in-app dots (the same wordmark as the not-connected pane), not Josh's 60KB SVG: the same
  design, zero bytes, and no new server route.
- The box wording follows the 22:22 mock ("Sign in at login.kosmosplus.com.", capital S), not the longer 22:09
  sentence, which wrapped; the mock is newer.
- "Lost your phone?" stays (Splinter's call): the reset can only be done from a connected computer. The dialog keeps
  "always" (Josh, 08-29) and the #3860 "or any other computer connected to this account" clause.
- The #1014 address instruction is not shown: the address is off the pane by Josh's ask; the box says where to go.
- Weakest premise: the "Sign in at..." wording reading the lowercase fragment in the mock as the intended sentence.
