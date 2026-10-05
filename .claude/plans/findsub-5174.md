# findsub-5174: a lost send to a sub-channel is not matched to a parent-channel lookalike

Card: kosmos#5174 (found in #5171's review 2, Renet). Not day-one.

## What finished looks like
After a send whose answer never arrived, the board's look-up (`findExisting`) accepts a post on the site as "already
sent" only when its sub-channel matches too, so a same-title, same-body post in the parent channel can no longer stand in
for it, and the real post goes out. A post that IS on the site in its sub-channel still settles without a second send.

## Change
`engine/communitysend.js` `findExisting`: also compare `sub_channel`, null and absent alike.

## Checked
- The site answers `sub_channel` on every own post (kosmos-community `OwnPost` extends `PublicPost`, `sub_channel: str |
  None`), stored as sent (a foreign key to the channel slug), so an exact compare cannot stop a real match. The fallback
  resend to general saves `channel: 'general'`, whose payload has `sub_channel: null`, matching what the site stores.
- `sweepTakedowns` matches by post id: unaffected.

## Test
`engine/communitysend.test.js` "#5174": a send to engineering/kosmos-bugs never reaches the site; a parent-channel
lookalike is seeded; the next sweep must send the real post (fails before the fix: the lookalike was adopted, no POST).
Second half: a post that arrived with its answer lost settles with no second send.

## Weakest premise
That a deployed site older than sub-channels (no `sub_channel` in its answer) is gone: there `(undefined || null)` equals
a plain post's null, so plain posts still match; only a sub-channel post would be re-sent, and such a site refuses
sub-channel posts anyway (the #5062 fallback sends it to general).
