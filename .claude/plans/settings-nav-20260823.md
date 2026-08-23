# settings-nav: Settings gets Mona Lisa's left nav

**2026-08-23.** The second of Josh's two subpages (09:14). The mock is
`~/work/chaoskosmos-site/design/settings.html`. Same structure as the agent
page, deliberately (the mock's own words: "this page exists to show that the
two use one structure"), so this branch reuses `.dbody`, `.snav`, `.dsec` and
the section-switch shape from agent-page-nav rather than drawing a second one.

## What finished looks like

- Settings is a sticky left nav reading `You · Claude accounts · Connections ·
  Agents talking · This Mac · Updates · Advanced`, one section on screen at a
  time, `aria-current="true"` on the pill that is on. Landing is You.
- Every box that shipped is inside a section, ids intact, and every control
  in it still works: picture, accounts, the limit toggle and tier, app
  location and Show me where it is, keep-awake, update check and the two
  update switches, Engineering mode, Delete history.
- The mock's You section has a name field; ours did not (the name was set in
  first run and nowhere else). It is added: read from `/api/you`, saved through
  the existing PUT with the other two fields carried whole, the engine's
  `told` verdicts summarised in one sentence. Disabled with an honest sentence
  when there is no record yet.
- Two headings take the mock's words: "Your task board" becomes
  "Connections" (the box's content is unchanged: nothing connects yet, and it
  says so); "Agent conversations" becomes "Agents talking to each other".
- `paintSettings` and the poll never choose the section.
- Below 56rem the nav is a wrapping row above the content.
- Both themes checked in a real browser; screenshots in the PR and channel.

## The mapping (eight boxes into seven sections)

| section | boxes |
|---|---|
| you | You (picture, and now the name) |
| accounts | Your Claude accounts |
| connect | Connections (was Your task board) |
| talking | Agents talking to each other (was Agent conversations) |
| mac | Opening Kosmos, Keeping agents running |
| updates | Updates (with the two switches) |
| advanced | Engineering mode, Delete your history |

## What waits (each its own card)

Add another account through the browser (the mock's biggest flag: the
terminal sentence); the duplicate-account catch; the accounts dot for an
expired sign-in; the Connections rows for monday.com and ClickUp once anything
connects; #283's naming if it disagrees with the table above.

## Checks

- `yarn test` with `web.settings-nav.test.js` pinning membership, order,
  landing, the two headings, the painter and poll never choosing a section,
  and the name save carrying the record whole.
- `docs/browser-checks/render-settings-nav.js`: both themes and 420px, a
  control (six sections at zero before any click), the four switches measured
  from inside their sections, the name round trip against the sandboxed
  record.
- Every browser check that opens Settings re-anchored on the sections
  (named-controls, contrast, regress-a-night, render-switch-states,
  render-full-width, render-projects), swept by grep before the review loop
  rather than found one per round.
- Review loop bounded at two rounds before the loop starts.
