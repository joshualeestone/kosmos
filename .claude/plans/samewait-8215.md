# samewait-8215: the needs-you block shows each question's words, and groups members asking the same thing (kosmos#8215)

## Done when
On a project page, a member asking its own question shows the question's words in the needs-you block, and two or more
members asking the same words are said once ("These 3 are asking the same thing: ...") above their names, each keeping
its own Answer and Dismiss.

## Decisions
- **Where:** the needs-you block above the members, not the members column. Josh ruled no status text in that column
  (#3131, #3212, #3437); the block is where reasons are already said (#5688).
- **Which words:** only a question the agent reported (stateReportedBy 'agent', no failed restart). A needs-you read off
  the screen has no words of its own.
- **Same:** case and spacing ignored. Words cut at 160 characters on a code-point boundary.
- **Blocked members are not added.** A blocked agent is waiting on something that is not the person, is not counted in
  the Issue pill, and has no place on this page that is allowed text. The reported case was three Questions, which this
  covers. Weakest premise: the card names blocked too; a follow-up can add a quiet "waiting on one thing" line if wanted.
- Dismiss keys are unchanged: each member's own, so dismissing one does not hide the others.

## Tests
- web.samewait-8215.test.js (new), the three notice tests' slices take pjSaidWords.
- docs/browser-checks/render-project-needsyou-2699.js: an #8215 arm at 358px (shared line once, four visible Answers,
  no overflow, the other question on its own row). Control: fails on main's page on the #8215 arms only.
