# avatarweb-4885: the page half of an agent's picture travelling to the community (#4885)

The board half is branch avatar-4885 (sweepAvatars in engine/communitysend.js). It is opened as a DRAFT and marked
ready only after THIS branch is on main, because once it ships every registered agent's picture goes out, and this
branch carries the line that tells the person so.

## Done when
Settings > Community tells the person that each agent's picture goes with it, and what stays up while switched off;
every picture the person chooses is stored as one the community can take (a still PNG, JPEG or WebP, at most 60,000
bytes, 16 to 2,048 px a side, upright) whenever the browser can redraw it; and a
picture Kosmos can no longer take down is said in Settings.

## Call
1. Copy, in the Community box: the switch's description reads "Their public profiles show each agent's picture, and the
   kind of business you pick below, if you pick one."; the off note adds
   "and a picture stays until you remove it from the agent."
2. fitPicture(blob) in web/index.html: a still PNG within the cap with each side from 16 to 2,048 px (the
   community's limits, app/avatars.py) is kept exactly; anything else (a big photo, a GIF, an animated picture, a tiny
   or huge one, every JPEG) is redrawn on a canvas, longest side at most 512 px, short side padded to at least 16 px,
   as WebP, then PNG (both keep transparency), then JPEG on white, stepping down until it fits. WebKit, the Mac app's
   engine, cannot write WebP, so it gets PNG or JPEG (review 1: a JPEG without the white fill turned a transparent
   picture's background black). The decoded picture is released at once. Never throws; a picture it cannot redraw is
   kept as it was (the board then does not send it and the community shows its mark).
3. Applied at all three places a picture is stored: the agent page's file input, the create flow's pending picture,
   and a team member's portrait or mark (tcPortrait). A unit test counts the PUT sites written in that one form, a
   tripwire for a fourth, not a proof that none can skip it.
4. GET /api/community-industry (which Settings reads when it opens) carries picturesStuck, from
   communitysend.pictureUnreachable() when the send layer has it (0 before the board half lands); Settings shows one
   line when it is above 0.

## Rejected
- Resizing on the board: node has no image codec and Kosmos ships no image dependency.
- Redrawing every picture: a small PNG or WebP the person chose is kept byte for byte. JPEGs are the exception,
  because a phone photo's rotation tag is refused by the community and a redraw applies it.
- A line on the agent's page when its removal could not reach the community: the board knows which agents, but the
  person removes pictures from several places; one line in Settings, beside the industry line that does the same.

## Decided, not missed (review 1)
- A picture of pure noise with transparency cannot be kept transparent within 60,000 bytes in WebKit (no WebP); it
  comes back on white. A real logo or illustration compresses and stays transparent (F6b).
- (review 2) What is kept as chosen is decided by the bytes (pictureStill), never the file's name or type: a PNG
  with no acTL/fcTL/fdAT chunk anywhere, or a WebP with no ANIM/ANMF chunk and the VP8X animation flag clear, as the
  community reads them. Tested on crafted bytes in node (an animation chunk past 4 KB included) and in the browser
  (F9, a JPEG whose file says PNG).
- Only the fallback mark in uploadPendingAvatar's failure branch, and the setup assistant's guide picture (saved by
  the board), skip fitPicture: both are small stills made by Kosmos. The default generated marks go through it.
- (review 2) A very large photo is decoded whole before it is shrunk; if the browser cannot hold it, fitPicture
  returns it as it was, the same result as before this change. Decoding at a reduced size would have to keep the
  rotation tag's effect, which createImageBitmap's resize options do not promise everywhere.
- (review 2) While the board half is still a draft, Settings says pictures go with the agents and they do not yet.
  Both merge before the next cut, the board half promptly after this one; a release carrying only this half would
  need the board half added or this line held.
- (review 2) A failed Settings read hides the stuck-picture line until the next good read, as the industry line does.

- (review 3) Pictures saved before this change never passed through fitPicture, so a big photo or GIF already on an
  agent cannot go. Rejected: re-fitting them silently (it would replace the person's stored pictures with smaller
  ones without asking). Instead Settings counts them (picturesUnsendable, from the board half's pictureUnsendable())
  and says to choose each again on the agent's page, which fits it.
- (review 3) A picture with transparency tries every size as WebP or PNG before any JPEG on white (F6c; WebKit, with
  the old size-first order, returned a grey-on-white JPEG). A PNG with an eXIf chunk is redrawn, since the community
  drops eXIf and with it any rotation note.
- (review 3) Every agent picture saved is now at most 512 px (and every JPEG re-encoded), so Kosmos's own display
  gets the fitted picture too, not only the community. A PNG or WebP under the cap is kept exactly.
- (review 3) Still unchecked against the community's WebP parser: a chunk running past the RIFF end, a VP8X canvas
  that differs from the frame, or two image chunks. A WebP like that is kept as chosen and then refused by the
  community, and the board shows the mark.
- (review 3) "Saved." on the agent page does not say when a picture could not be fitted; the Settings count does.

- (review 4) Settings re-reads the counts each time its Automation section opens (they change as pictures are chosen
  again), not only at page load. The agent page says when a chosen picture could not be fitted and is too big to share.
- (review 4) A PNG is kept as chosen only if it has picture data (IDAT) and its last chunk is whole. Transparency is
  looked for at up to 512 px, not 64, so a thin transparent edge is not averaged away.
- (review 4) Measured against the community's own parser (kosmos-community app/avatars.py from origin/main, run on the
  bytes fitPicture returned): a noisy photo, a big JPEG, a small JPEG, a big transparent logo and a thin banner, in
  Chromium and in WebKit, ten outputs, all ACCEPTED; a GIF as control was REFUSED. Not part of the check (CI has no
  copy of the service), so a later encoder change in either engine would not be caught there.

- (review 5) Only a still PNG is kept as chosen; every WebP is redrawn, so the community's WebP checks (a chunk past
  the RIFF end, a canvas that differs from the frame, two image chunks) only ever meet this browser's own encoder,
  measured accepted. That also makes "choose it again" in the Settings line true for a picture the community refused.
- (review 5) fitPicture vouches (PICTURE_FITS) for what it keeps or redraws; the agent page says so whenever it could
  not fit a picture (a HEIC on Windows, an SVG, a picture too big to redraw), not only when it is over the cap.
- (review 5) Next, not in this PR: the Settings line counts pictures but does not name the agents. The board half
  knows them; naming them means reopening its converged review, so it is the next small change.
- (review 5) Kosmos's own display gets the fitted picture too: an animated GIF becomes its first frame on the agent's
  page, and a big picture is at most 512 px.

- (review 6) Measured in both engines: a PNG turned by its eXIf (Orientation 6) comes back upright (F10). A PNG is kept
  as chosen only with IHDR first and 13 bytes long, as the community requires. server.community-picture-4885.test.js
  pins the two counts on the route: 0 without the picture pass, null when it throws, the count otherwise, on GET and
  on PUT.

- (review 7) An engine that rejects createImageBitmap's imageOrientation option is retried without it (current
  engines turn by default), so an older WKWebView does not silently stop every picture being fitted. The agent page's
  message is true whatever the cause: "Kosmos could not fit this picture for the community, so it will not show there."

## Weakest premise
That 512 px is enough for every place Kosmos shows a picture. Agent pictures render at most a few hundred CSS pixels
wide; a person who wants a sharper picture can choose a PNG or WebP under 60,000 bytes, which is kept as is.

## Verified
- docs/browser-checks/render-picture-fit-4885.js, Chromium and WebKit, all good (F1 to F10, F6b, F6c); the size-first
  order makes WebKit F6c red; a no-op fitPicture makes
  F1 and F2 red; removing the white fill makes WebKit F6 red (corner [0,0,0,255]); removing the padding makes F8 red. Wired in tools/browser-checks.sh and the README (browser-checks-indexed and -wired tests pass).
- web.community-picture-4885.test.js; all web.*.test.js 2,284/2,284 with the industry route test and both wiring
  tests; every inline script block passes node --check.
