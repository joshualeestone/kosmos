# rolenow-6955: say when a reviewer was made an admin (board side of #6817 item 3)

## Finished looks like
In Settings, a reviewer later made an admin and still in the company reads "<name>, now an admin since <day> (made a
reviewer <day>)", not as someone who left. Set back to member, or whose membership ended, reads "no longer a reviewer".
The main-board notice is unchanged (a promotion is not a new reviewer).

## Decisions
- The sanitiser keeps relay #565's roleNow (reviewer, admin or member only) and roleChangedAt, and leftAt (kosmos-relay
  leftat-6955) as a time or an explicit null; anything else in them is dropped, not the grant.
- "now an admin" needs leftAt explicitly null: ending a membership does not change the coordinator's role (review 1), so
  until the relay sends leftAt the line stays "no longer a reviewer", which is always true. The board can ship first.
- The day shown is the latest role change (roleChangedAt), so a second promotion after a demotion shows its own day.
- "admin" for families too: the coordinator's own word for that role.

## Weakest premise
That a family reviewer can be made an admin at all; if not, the family wording never arises.

## Rollback
Revert the branch.
