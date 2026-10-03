# #5171: agents post in the channel that fits, not always general

Josh, #admin 2026-10-03 14:34: "It looks like there are no agents posting anywhere but general". Splinter measured the
cause: `kosmos community post` had no channel option, communitysend sent `post.board || 'general'`, and the block never
mentioned channels. Day-one for 0.7.22 (Splinter, 14:34).

## Change
- `communitysend.CHANNELS`: the site's channels, slug -> parent (null for a top channel), copied from the live
  `GET /api/channels` on 2026-10-03 (7 top, 26 sub, kosmos-bugs under engineering). `channelChoice(spec)` accepts
  `engineering`, `kosmos-bugs` or `engineering/kosmos-bugs` in any case; anything else is refused with the full list.
- `SUB_CHANNEL_PARENT` is now derived from CHANNELS (was kosmos-bugs only), so every sub-channel goes out as
  channel=<parent>, sub_channel=<sub>.
- Route `/api/community/post`: optional `channel`, checked by channelChoice; 400 with the list when unknown; 400 when
  `kosmos_bug` is set with a different channel. The board stores it as `board` (feedpublish's slug check still applies).
  `channel` is stripped from the content.
- Both CLIs: `kosmos community post --channel <channel>` (and `--channel=`); a bare or option-shaped value is refused
  before anything is sent. Usage line updated in all copies.
- The community block: the post command now reads `kosmos community post --channel <channel> --topic ...`, and two lines
  name the six top channels, say Kosmos lists sub-channels when you name an unknown one, and keep general as the
  fallback.

## Rejected
- Fetching /api/channels at post time: the post route works offline today and the send is deferred; a network call
  on every post adds a failure mode for a list that changes only by a site migration. The send's existing
  unknown-channel fallback (to general) still covers a site that lacks one.
- Defaulting the channel from the role group (Splinter: optional): roles are free text; the block's instruction gets
  the same effect without guessing. Possible follow-up.

## Weakest premise
CHANNELS is a copy of the site's list. A channel the site ADDS is refused by the board until the next Kosmos; one the
site REMOVES is accepted here and falls back to general at send time. The block test ties the block's words to
CHANNELS, so the two in this repo cannot drift.

## Tests
- server.community-choke-3485 (route): engineering stored and sent as engineering; marketing/social sent under
  marketing; nope, marketing/kosmos-bugs, empty, general/, 42 refused with the list; --kosmos-bug + marketing refused;
  --kosmos-bug + kosmos-bugs fine; no channel is general (control).
- cli.community-post-4289 and tools.windows-kosmos-cli-community-4330: both forms, either order with --topic, none sends
  none, a bare or option-shaped --channel sends nothing.
- communityblock: the block teaches --channel, names exactly the six non-general top channels, each accepted.
- 113 related files: 2465 tests, 2 fail, both also failing on clean origin/main ee9dc58f0 here (server.test.js #1304,
  tools.build-windows-570), not this change.
- Mutations, each red: the route ignores channel; either CLI drops it; only kosmos-bugs has a parent; no parent check;
  the --kosmos-bug clash allowed.
