# mobilenav-4823: Josh's mobile web redesign (header, full-screen navy menu, slimmer Agents list)

Card: kosmos#4823 (Josh, 2026-09-30 20:54 and 20:56 CDT, mockups in
~/.cache/claude-handoffs/josh-mobile-redesign-0930/). Branched from onekosmos-4815 (#4822), which removes the
multiple-Kosmos dropdown this card also removes from the phone header.

Finished looks like: on a phone viewing the board through Kosmos+, the board matches navigation-mock.png and
agents-listview-mock.png: one navy bar the height of apple.com's mobile nav bar with the Kosmos+ mark left and a
two-line button right; no K icon, Kosmos dropdown, avatar/name or Log out button in the header; the two-line button
opens a full-screen navy menu (Agents, Projects, Tasks, Settings) with red bubbles beside Agents and Projects (99+
cap) and an X; Settings slides to a second level, Apple style (text fades as it moves), with a back chevron, every
Settings section, Switch Computers when the account has more than one computer, and a small Log out at the bottom;
the Agents page has no count tiles, no grid view, a square plus for New agent, and white rows with the big avatar,
context ring, availability dot, name, title, model and a status pill. Desktop and local windows unchanged.

Decisions (each reversible in a commit):
- WHERE IT APPLIES: phone width (max-width: 40rem, the board's existing phone breakpoint, 11 rules) AND viewed
  through Kosmos+ (kplusRemote(), the same test the navy Kosmos+ bar already uses), marked by a class on <html>.
  Rejected: phone width alone, because a narrow LOCAL window has no Kosmos+ session to log out of and no Kosmos+
  brand to show. Weakest premise: that nobody uses the board at phone width locally and wants the new menu there.
  What would change it: Josh asking for it locally; then drop the remote half of the class test.
- The menu is a new full-screen layer (#pnav), separate from the existing burger dropdown (#tabs), which stays for
  40rem-56rem and for local windows. The burger opens #pnav instead of #tabs only under the phone class.
- Items mirror the real controls so they cannot drift: Agents/Projects/Tasks click the real tab buttons (Tasks shows
  only when its tab does, i.e. after 25 tasks, #3559); bubbles mirror #nav-badge-agents/-projects via setNavBadge;
  the Settings list is read from #s-nav's visible buttons each time it opens; Log out runs the Kosmos+ bar's own
  log out; Switch Computers lists the computers computersRender already fetches and opens each the same way.
- Switch Computers sits under Settings (Splinter's call on Josh's offer; Josh can move it back to the first screen).
- Motion: copied from apple.com's own globalnav CSS (research file: scratchpad apple-nav-findings.md), with
  prefers-reduced-motion turning it off.
- Agents page at phone (class on): count tiles hidden; the grid view button hidden and a saved grid shown as the
  list without overwriting the saved choice (it comes back on a wider window); New agent is a square plus the height
  of the view controls (its accessible name stays "New agent"); the sort box takes the same height.
- Rows at phone: white ground, the grid card's larger avatar with ring and availability dot, name, smaller title,
  model, then a pill with the state word that grows to the right. No memory bar or percentage, no task line. The
  computer line is left off until #4812 can show agents from several computers (the card says so).
  This overrides #3131's "status as ground colour, no word" for the phone only, by Josh's newer ruling.

Validation: a new browser check at phone width with a remote host, light and dark, both menu levels, plus a local
phone-width arm proving nothing changed. Controls: main's page fails the header and menu arms.
