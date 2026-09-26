# #3994: the agent page's Files in the project Files panel's white container

Josh, #admin, 2026-09-26 11:17 CDT: "lets put the files for an agent inside a white container just like we do on projects"

## Done looks like
On the agent page, the Files block (heading, list, View All) sits in the same white rounded panel as
the project page's Files, in light and dark, at desktop and phone widths, with the list fitting inside;
served in a release, with before and after shots.

## The call
- The section wears the project panel's own class, `.pjcard` (`class="dfiles pjcard"`), so the look
  comes from one rule and cannot drift: `--k-surface`, 12px radius, 14px 16px 16px padding, and the
  per-layout border (none in the tab layout, the rule line in the consolidated one), exactly as the
  project panel has.
- Rejected: copying the styles onto `.dfiles` (the card asks for reuse, and copies drift); wrapping in a
  new element (no need, the section is already the block).
- The project page's own layout rules for its panel are all scoped under `.pj3`, so only the look comes
  across, not that page's grid. Nothing in the script queries `.pjcard`, and the tests that name it are
  scoped to `.pj3` / `.pjsplit` (grepped).
- Weakest premise: that Josh means the base look of the panel and not also its header row (the project
  panel's FILES / View All row is a grid in some layouts). The agent header is already title-left,
  View All-right, so they read the same.

## Check
`render-agent-files-3614.js`: a new arm in each theme/width (light and dark 1400, light 760, light and
dark 412): the class is on, the background is the resolved `--k-surface` and differs from the column
behind, radius 12px, padding 16px, the list does not overflow. Measured red with the class removed.
