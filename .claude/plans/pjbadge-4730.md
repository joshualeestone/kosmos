# pjbadge-4730: simpler Projects views (#4730) and the Agents page's Working tile (#4736)

Cards: kosmos#4730 and kosmos#4736, both Josh 2026-09-30 (09:06 and 10:05, #admin).

## #4730, verbatim
"if there's nothing running or we can't tell, let's just not display a badge here. Let's only display a badge if
something is actually running. ... '5 agents, 1 we cannot see' ... Let's just not list if we can't see an agent. We
don't need that information here. ... on the list view version, let's make alternating rows have a light background
so that it's easier to read across ... Excel style ... a really really light color"

## #4736, verbatim
"if there are 0 working, lets not show the tile"

## Done looks like
- Projects grid and list: a badge only for Issue, Working or Restarting; none for nothing running, an unseen member
  or an unreadable roster; no "we cannot see" line anywhere on those views.
- Projects list: every second VISIBLE row shaded, still alternating after a fold, never in the grid; the row under
  the pointer still stands out.
- Agents page: the Working tile hidden whenever its number is 0, "0+" included; a failed poll's "?" still shows.
- Checked in a browser, light and dark, by a check that fails on main's page; served in a build Josh can open.

## Decided (reversible, on the cards)
- Issue keeps a badge: it is a running agent that needs him, the one badge that asks him to act.
- An unreadable roster shows no badge and no note on the Projects views (his rule, literally). A note was built and
  then removed in review: it was itself a new "we cannot see" line and showed only in the list view. The Agents
  page reports a failed read.
- The stripe is set in the fold walk (applyConsFold), not by :nth-child, which would count folded rows.
- A 3.5% ink wash, measured on the ground at 1.02 to 1.25 (visible, light), darker in light and lighter in dark.
- #4736 is folded into this branch: same direction, same file, one validation turn instead of two.
- Out of scope (not asked): the project's own page and the Agents page keep their unseen markers; dead .pj-who CSS
  stays (a test pins one rule).

## Weakest premise
That hiding state under an unreadable roster (and the Working tile at "0+") is what he wants in the rare case it
hides real work. It is his rule as stated; each is a one-line revert.
