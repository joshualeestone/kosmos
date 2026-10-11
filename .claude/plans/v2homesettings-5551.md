# #5551: Settings option B and Home as drawn (new look only)

Branch: v2homesettings-5551. Card: joshualeestone/kosmos#5551. Drawing: kosmos-v2-three-screens-for-josh.pdf, pages 3 and 4.

## Finished looks like
With the new-look switch on: plain and quiet buttons in the agent page's and Settings' boxes are raised pills that
keep today's gold edge, on the raised fill (white in light, #3a3a3c in dark), with no shadow (option B); the Agents grid shows every card on the same soft grey, Working with
no green wash, stroke or pulse (its dots today's green in light, the bright green in dark, 3:1 or more on every card), each state a mark and a word (Issue and could-not-read keep their pills), the Question
card warm, the Issue card as today, and the count row's Issue filters on the grey control ground at rest. With the
switch off, nothing changes. render-newlook-4470.js asserts both, with look-off controls.

## Calls (recorded on the card, 10-10 22:19 and 22:27 CDT)
- Option B over A: the gold edge is the only boundary near 3:1 (2.91 vs the box in light, 3.16 vs the fill; A is 1.09).
- Issue card unchanged (Josh 08-21, red stays rare; the white pill "stark warning").
- Grid only; the list view keeps its rows until drawn.
- Weakest premise: the warm card alone stands out enough on a white page; if not, it gets the hairline back (#3692).

## Steps
1. CSS in web/index.html (the #4470 controls block and the Agents page block). Done, 42b1c8a86.
2. Browser check arms and controls in render-newlook-4470.js. Done.
3. Review 1: done (0f5563cc1): measured contrast in the comment, warm tint over the card's grey, stale comment, controls.
4. Reviews 2 to 5: done (pill probes, hover tint, Question pill class, pressed Issue filter, dot contrast).
5. Review 6: done (Issue card's Working-now dots named and checked). Review 7: converged, 2 nits fixed.
6. Full validation, design shots, PR.
