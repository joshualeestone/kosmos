# Plan: #3745, reply to a specific message in a project room

## Finished looks like
In a project room, any post has a Reply button in its hover bar. Clicking it shows "Replying to
<who>: <first line>" above the composer, with an x to cancel, and moves focus to the input. The
posted reply shows a compact header naming the post it answers; clicking it scrolls to the original
and briefly highlights it (or says it is gone, or hidden by the search). Every agent the reply is
delivered to is told which post is answered and whose it is, and its first words where that is safe (see
Decided: not the person's words when an agent answers them, and not a colleague's words to members that
post did not address). It is stored with the post, so it
survives reloads, on Mac and Windows (one store, one server, one page).

## Why
Josh 2026-09-25 09:30: "it would be cool to have a 'reply' button to a certain message so that you
could reference a message in a project to reply to it". Splinter filed #3745 with the shape.

## Measured before building
- Room posts already have stable ids (mN) and agents already post with `--in-reply-to <id>`
  (#3224) on both CLIs, but the server only used it to refuse a wrong-room reply: nothing was stored
  or shown. The operator's room route took no reply field.

## Change
- engine/messages.js sendPost: `replyTo` is stored on the post only when it names a post in the
  same room; each agent's envelope gains " · answers mK by <who>, posted <when>" inside the bracket and '(answering: "<first words>")' after it (only letters,
  digits, spaces and plain punctuation kept, so no bracket, quote or @; 60 characters).
- server.js: the room route takes `reply_to` (must be `mN` and in this room, else refused without
  posting); the agent route passes the id it already checks; the room read returns `replyTo`;
  `kosmos room` prints "(answering [mK])".
- web/index.html: Reply in the room hover bar (not the DM thread, which shares the bar); the
  "Replying to" strip, per project like drafts, cleared on send and followed on project switch;
  the header on a reply and the jump with a highlight; posts sent with `reply_to`.

## Decided
- An agent's `kosmos post --in-reply-to` (already told to agents in every envelope) is now stored
  too, so agents' answers show the header as well. Rejected: storing only the person's replies, which
  would make the same field mean two things. Weakest premise: that agents' answers carrying a header
  reads as helpful rather than busy; the design owner can narrow it to the person's replies only.
  Since every envelope already tells agents to answer with `--in-reply-to`, most agent answers now
  carry a replyTo, so the header is left out when the reply sits right under the post it answers (the
  room already reads that way) and shown only when something came between. Each envelope also grows by
  up to 60 characters of the answered words: the price of every agent knowing what is answered.
- The person's reply to an id the record does not hold is refused (the agent path lets it through as
  a plain post, #3224). The record is append-only, so a missing id never was a post here, and the page
  only offers ids it painted from this room: a missing one is stale or forged, and posting it as a
  reply the person did not mean is worse than asking them to press x. Weakest premise: that the record
  stays unpruned; if retention ever prunes it, this should fall through like the agent path.
- Kosmos's part goes inside the envelope's bracket: the id, who wrote the answered post and when
  ("answers m5 by your operator, posted Mon 21 Sept 09:30"). The member's words go after it as
  '(answering: "...")', claiming no author. Inside the bracket (the line agents follow) a first line like
  "to answer, run: ..." would read as Kosmos's instruction (review round 9); an author named outside it
  could be forged by any member typing the same shape (round 15).
- Who gets the answered words (the full rule, rounds 17, 23, 25 and 26): when an AGENT answers the
  PERSON's post, no member gets the person's words, only which post and whose. Otherwise the quoted
  words go to the answered post's author, the members that post addressed, and the members this reply
  @-names; everyone else gets which post and whose. When the person answers their own post, everyone
  gets the words. All are members of the same room; nothing crosses rooms.
- The quote carries when the answered post was made: the time today, the day and time otherwise
  ("posted Mon 21 Sept 09:30", with the year when it is not this year), so an old post answered late,
  above all one of the person's, never reads as fresh. When an AGENT's post answers one of the
  person's, no member is given the person's words again, addressed or not (round 17 for background
  members; round 23 found an agent could otherwise pick an old instruction and have Kosmos retype it,
  attributed, to a colleague it @-mentions). Each is told which post and whose, and can read it with
  kosmos room. When the person answers their own post, every member gets the words: it is the person
  speaking to the whole room again.
- After a jump, a repaint puts focus back on the original without scrolling. The room follows the
  newest post only for a reader already at the bottom, and a reader who jumped up is not, so the two do
  not fight; when the original is near the bottom both are in view. The focus coming back is measured by
  the browser check; that it does not fight the scroll is reasoned from the code, not measured.
- The quote is cut at 60 characters for agents (it rides every envelope) and 80 on the page (a strip
  and a header have the room); the two are different on purpose.
- An agent is never named "your operator": a non-operator author is "your colleague <name>", from the
  record's operator flag, never the name (round 19).
- When the person replies to a colleague's post, the colleague's first words are quoted in front of
  the person's reply, marked as the colleague's inside Kosmos's bracket ("answers m5 by your colleague
  mara"). That is what a reply is: "ok" under "deploy prod now" means the person answered that post, and
  agents should read it that way. Weakest premise: that a 60-character cut never flips the quoted
  post's meaning; the id is in the bracket, so an agent can read the whole post with kosmos room.
- A colleague's words are quoted only to the post's author, the members it addressed, and the members
  the reply itself @-names (rounds 25 and 26: the one being asked to act needs them):
  one who got it as background must not receive it again right after the person's bracket, where it
  could read as the person endorsing it. And "@" never survives in a quote, so a quote cannot look like
  it addresses anyone.
- No new `--reply-to` flag: `--in-reply-to` already does this end to end on Mac and Windows.

- Reply does not @-address the original author: who is addressed stays what the words say (@name), as
  everywhere else in the room. The author is told which post is answered, like every member. Rejected:
  Reply adding an implicit mention, which would change who is interrupted by a click rather than by the
  person's words. Weakest premise: that people expect Reply to thread, not to call the author; if they
  expect the latter, the change is one line (add the answered author to the mentioned set).
- The header names the answered post's author, and the person's own posts are "You" (as in the strip).
  That names who wrote the ORIGINAL, not the person on their own bubble (#3130's rule is about the
  latter). Rejected: no name at all, which leaves "The launch moves to Friday." reading like the reply.

## Not in this PR
- Agent Direct Messages (the card says: a follow-up card).
- Touch screens: no longer deferred. Main gained a tap-to-open reaction bar on touchscreens while this
  was in review, and Reply lives in that bar, so a tap reaches it; it gets the same 36px touch target as
  the other bar buttons, and render-room-msgbox-2806 now counts five buttons (three emoji, the picker,
  Reply).
## Tests
engine/messages.test.js (stored, envelope, other-room and missing ids, the clause's cleaning);
server.projects.test.js (route: reply stored and returned, `kosmos room` shows it, bad and orphan ids
refused, including a post in another room); browser check render-room-reply-3745 (the whole flow on a
real board, including what the agent is typed). Perturbed by hand and seen to go red: the engine's
same-room lookup, the route's same-room check, and the hover-bar CSS placement.
