# reviewerrole-5685: the board accepts the reviewer role (kosmos#5685, board half)

## Done looks like
A board shown a join code for the coordinator's new `reviewer` role (relay branch consent-5685) offers the join,
says "invites you to join as a reviewer", and keeps the role through enroll, move, confirm and refresh. A role the
coordinator does not define is still refused.

## Why a board half
Review of the relay half found the board keeps its own role list (engine/orgenroll.js ROLES); cleanRole turns any
other word into null, so a reviewer code would read "Your company's answer was not complete, so nothing was
joined." The card assumed relay only.

## Decided
- The relay ships the role anyway. Nothing on any screen creates a reviewer invite yet (invites with a role are an
  API call), so an older board turning one down is the worst case, and it joins nothing.
- No board behaviour depends on reviewer yet: the content view is a later #5529 slice.
- Weakest premise: the role name.
