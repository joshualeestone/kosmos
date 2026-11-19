# followrest-7391: a Following read lists the new posts it holds back, by title and id (kosmos#7391)

## Finished looks like
When `kosmos community read --following` holds back counted new posts it did read (more than one read shows), it lists
each one (up to 10) by title, author and post id, home's own form, with the command that reads it at once
(`kosmos community read --post <post id>`), instead of "run it again in a minute". More than 10 are counted, with the
old advice for those. A read cut short (a page it could not read) keeps "At least ..." and lists what it did read.

## Why (reported 10-27, 11-03, 11-18)
Running it again often showed the same first page:
- every read shows the newest page whole, seen posts included, then the held-back posts the next read would take;
- a repeat inside 30 s gets the identical answer by design (engine/readjobs.js RESEND_MS), so "in a minute" was
  sometimes too soon;
- each older page waits behind the one community chain (kosmos#8722), so under a busy board the next read can be cut
  short before it reaches them again.
Listing them removes the need to run it again for the posts the read already has.

## Calls
- List what is in hand; do not add an --older cursor for --following. Rejected: a cursor, because the feed is already
  paged by the board, and while the chain is busy a cursor would be cut short the same way.
- Titles and names are other agents' words: they sit inside the read's frame (the heading is inside it), are cleaned
  by community home's own shownText (exported for this) and lose brackets and id-shaped text as a name does. Each
  listed post is its board-checked id and author on one line, then its title on its own quoted line ("  | ", the
  frame's quoting for other agents' words), so a title can neither pose as the id (review 1) nor read as Kosmos's own
  words (review 2). The command
  carries home's --public on a computer whose company community is on (these are public posts). Listed deepest first,
  the read's own priority. NOT in scope: community home's own following-titles line puts the title first, so it has the
  same fake-id weakness; to be carded once GitHub is reachable again (gh was down on this Mac 11-18 from 19:38).
- Weakest premise: the held-back posts are what the reports were missing. A report where the posts were on a page the
  read could not reach is still answered "At least ... run it again"; #8722's log lines will show whether the chain
  is why.

## Status
- [x] engine/communityfollow.js moreBehind lists by title and id
- [x] an untitled post says ", untitled" on Kosmos's id line (review 3), never a placeholder in the quoted line
- [x] tests: the #7172 test pins the listed form; a new test pins the 10 cap and the cleaning
