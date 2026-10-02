# avatarweb-4885: the page half of an agent's picture travelling to the community (#4885)

The board half is branch avatar-4885 (sweepAvatars in engine/communitysend.js). It is opened as a DRAFT and marked
ready only after THIS branch is on main, because once it ships every registered agent's picture goes out, and this
branch carries the line that tells the person so.

## Done when
Settings > Community tells the person that each agent's picture goes with it, and what stays up while switched off;
every picture Kosmos stores is one the community can take (PNG, JPEG or WebP, at most 60,000 bytes, upright); and a
picture Kosmos can no longer take down is said in Settings.

## Call
1. Copy, in the Community box: the switch's description ends "Each agent's picture goes with it."; the off note adds
   "and a picture stays until you remove it from the agent."
2. fitPicture(blob) in web/index.html: a PNG or WebP within the cap is kept exactly; anything else (a big photo, a
   GIF, every JPEG) is redrawn on a canvas, longest side at most 512 px, as WebP, or JPEG where the browser cannot
   write WebP (WebKit, the Mac app's engine), stepping down in size and quality until it fits. Never throws; a
   picture it cannot redraw is kept as it was (the board then does not send it and the community shows its mark).
3. Applied at all three places a picture is stored: the agent page's file input, the create flow's pending picture,
   and a team member's portrait or mark (tcPortrait). A unit test counts the PUT sites so a fourth cannot skip it.
4. GET /api/community-industry (which Settings reads when it opens) carries picturesStuck, from
   communitysend.pictureUnreachable() when the send layer has it (0 before the board half lands); Settings shows one
   line when it is above 0.

## Rejected
- Resizing on the board: node has no image codec and Kosmos ships no image dependency.
- Redrawing every picture: a small PNG or WebP the person chose is kept byte for byte. JPEGs are the exception,
  because a phone photo's rotation tag is refused by the community and a redraw applies it.
- A line on the agent's page when its removal could not reach the community: the board knows which agents, but the
  person removes pictures from several places; one line in Settings, beside the industry line that does the same.

## Weakest premise
That 512 px is enough for every place Kosmos shows a picture. Agent pictures render at most a few hundred CSS pixels
wide; a person who wants a sharper picture can choose a PNG or WebP under 60,000 bytes, which is kept as is.

## Verified
- docs/browser-checks/render-picture-fit-4885.js, Chromium and WebKit, all good (F1 to F5); a no-op fitPicture makes
  F1 and F2 red. Wired in tools/browser-checks.sh and the README (browser-checks-indexed and -wired tests pass).
- web.community-picture-4885.test.js; all web.*.test.js 2,284/2,284 with the industry route test and both wiring
  tests; every inline script block passes node --check.
