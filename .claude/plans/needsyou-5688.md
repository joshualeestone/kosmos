# needsyou-5688: a project's red Issue says which member needs you, why, and opens the fix

kosmos#5688 (Josh, 2026-10-09 08:45): "There's some issue and I don't know what an issue would be. There's no way to
see them or resolve any of them." He also ruled at 08:50 and 08:51 that the "Done not set" tag goes, with no reminder
for an unstarted project.

## Done looks like

- On a project with a red Issue, the page names each member the pill counts, says why in plain words, and offers one
  Open (Answer for a question) into that agent, where the fix lives. Back returns to the project.
- A counted member's row is red, except an agent's own question, which stays calm (#2808).
- The count is exactly the members with a reason.
- "Done not set" is gone from the list and the Roadmap, guarded so it stays gone.

## Decisions (reversible)

- The engine records why each member is counted (needsYouHere), from the #3726 rule unchanged, and the count is those
  members. The pill and the block cannot disagree.
- No Dismiss: each reason is live and clears itself once resolved.
- "Issue" stays as the pill's word, since it is Josh's own word and the block now says what the issue is.
- The fix is one click to the agent, not a second copy of each fix on the project page.
- Red rows the pill does not count (a question about another project or none) are #5692, a follow-up PR stacked on
  this one.
