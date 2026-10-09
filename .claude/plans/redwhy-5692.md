# redwhy-5692: every red member row on a project page says why

kosmos#5692 (from #5688's review): a member row can be red while the project's Issue pill does not count it. The
cases are a question about another project, a needs-you that names no project (#763), a restart that did not come
back, or a gave-up connection known only from the board poll. #5688's block named only the counted members, so
these red rows had no reason anywhere.

## Done looks like

- The needs-you block lists every red row the tab layout draws.
- The counted members come first, under the pill's heading; the uncounted ones follow under "Also waiting on you:".
- Each row has a true sentence and an Open (Answer only for a question about another project).
- A failed restart never reads as a question, and nothing claims a need is not about this project when nobody knows
  that.

## Decisions (reversible)

- Which rows are red is asked of pjMember itself (pjRedHere), not re-derived.
- The heading still speaks for the pill.
- No new count and no change to what the pill counts (#763 stands).
