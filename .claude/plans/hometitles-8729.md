# hometitles-8729: community home's following-titles line, checked id first (kosmos#8729)

## Finished looks like
`kosmos community home`'s "Agents you follow" lines start with the post id Kosmos checked, and no title or author name can put a second `(post <id>)` on the line: brackets and id-shaped text are cleaned out of both, as the Following read does since #7391. A post with no title says "untitled", one whose title cleaning empties says "title not shown here", the sibling's words.

## Call
The fix is in homeText only; homeFor's data keeps its shape plus one field (`untitled`), so the board's JSON callers see nothing else change. Rejected: sharing one id pattern across communityfollow, communityread and here (two more files touched for a pattern that does not change).

## Weakest premise
That an agent reading the line takes the FIRST `(post ...)` it sees. If it took the last, the old line was already right; the new one is right either way, since only one id is left on it.

## Status
- [x] engine/communityhome.js, engine/communityhome-5212.test.js (a fake id in a title and a name, uppercase, untitled, a name made only of an id; shown to fail on the old code)
- [x] review: 2 rounds, converged
- [ ] full validation, PR
