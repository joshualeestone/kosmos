# #4550: the agent page nav is three buttons

## Finished looks like
- The agent page's left nav has three buttons: the large Direct Message (unchanged), then Profile and
  AI Settings side by side, at every width (desktop, the narrow reflow, the phone).
- Profile shows, in order: picture, name, what they do, reports to, Instructions, Skills.
- AI Settings shows, in order: Runs on, Memory with Fresh start, this agent's terminal and the window it
  runs in, Remove this agent.
- The Instructions "(needs you)" dot lights on Profile. Talk keeps its own.
- Swarm Settings (#4433) stays the conditional extra box below the pair, for swarm agents only.
- A section reached by name (`openDetail(name, 'instr' | 'term' | 'remove' | ...)`, `detailGo`) opens its
  new group and lights the button it now lives under; the terminal capture still fires once on arrival.
- Keyboard: a click moves focus to the group's first section (Profile / Runs on); DOM order matches the
  reading order inside each group.

## How
- Markup: the `instr` and `term` buttons are removed; Profile's `aria-controls` names
  profile + instr + skills and carries the dot; AI Settings' names model + memory + term + remove.
  The `d-sec-profile` section moved ahead of `d-sec-instr`, so Profile's group reads in Josh's order.
  Every section keeps its id and data-sec.
- JS: `DETAIL_SECTION_GROUPS` = { profile: [profile, instr, skills], model: [model, memory, term, remove] }
  and `DETAIL_SECTION_PILL` maps each folded section to its button. The terminal arrival paint keys on
  the revealed group including `term`; the Skills lazy-load fires on the Profile click; the Instructions
  dot is set on Profile.
- CSS: below 56rem the pack stayed one column for the four-pack; the pair keeps two columns.
- Tour (#3755): the Instructions and Advanced tips pointed at buttons that no longer exist, so they are
  removed; the remaining tips keep Josh's words unchanged.

## Decided (weakest premise named)
- Swarm Settings stays its own conditional box below the pair, not folded into AI Settings: it is a
  swarm-only control with its own state pill (Active / Paused), and Josh's lists name neither it nor a
  place for it. Weakest: that he left it out because it belongs in AI Settings. Moving it is one group
  entry and one button.
- The Profile and AI Settings tour tips keep their current words (Josh's, #3755) even though each button
  now covers more; rewording his copy is his call.

## Rejected
- Keeping the instr/term buttons hidden: dead controls in the DOM, and the tests would keep asserting
  a layout nobody sees.

## Verification
- Unit: web.agent-nav (membership, folds, the page's own group map), server.test.js nav order,
  web.win32-board-copy (no stale Advanced pill), web.*.test.js whole (2160).
- Browser: render-agent-nav (three pills, pair side by side at desktop and 420px, groups, deep-links
  to instr and remove, reading order, capture once), plus the checks that clicked the old buttons:
  named-controls, render-personal-instr-4446, regress-a-night, render-thread,
  render-reassign-update-3050, render-projects, render-detail-header-1841, render-win32-board-copy,
  mobile-shots (agent-instructions screen).
- Review shots: mobile-shots `agent-page`, `agent-profile`, `agent-instructions` at desktop and iPhone 15,
  light and dark.
