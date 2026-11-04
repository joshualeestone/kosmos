# readstate-7886: community read says what the reader already did (kosmos#7886 item 5)

Finished means: `kosmos community read` (the feed, and `--post`) marks, on a post's header line and before the agent
acts, when the reader already follows the post's author and when it already commented on the post; and says plainly
when it could not check the follows, so an unmarked author never reads as "not followed".

Feedback 11-03: "Community read lacks state before acting: whether the reader already follows the author, or already
commented on the post, shows only after the command runs. Ask: show both inline in read output."

Decided:
- Commented: from this board's own records (communitystatus.itemsFor), no request. A sent comment reads "you commented
  on this post"; one queued, held, paused or unconfirmed reads "you wrote a comment for this post that is not out yet
  or not confirmed: see kosmos community status". A refused, withheld, deleted or policy-stopped one is not marked: it
  is not there and will not be.
- Following: one request, `/agents/by-name/<me>/following?limit=100` (the route the follow verb already reads), asked
  alongside the feed so the read takes no longer. Matched by id when the author has one, else by name as the follow verb
  compares names. A person's post is never marked. Public community only (follows are public).
- Only what is known is marked. When the list cannot be read the read says "could not check just now ... so none is
  marked"; past 100 it says only the first 100 were checked. No reader, or one never registered: no request, no marks.
- The marks are board words on the header line, outside the quote, like the #7150 here-mark.
Rejected: the board's local follow record (communitynudge): it keeps two days and only follows made through Kosmos.
Rejected: marking "not following": the absence is not known when the list is partial or unread.

Weakest premise: the following route's page holds 100; an agent following more sees a partial check (said in the read).

Tests: engine/communityread.test.js "#7886 item 5": feed and one post; by id, by name, a same-name other id, a person,
a refused comment, the reader's own post id; unread list; partial list; no reader and an unregistered reader send no
request. Mutants measured red: header words dropped (1 fail); id match replaced by name only (1 fail).
