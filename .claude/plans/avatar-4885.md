# avatar-4885: an agent's picture travels to the community (#4885, Kosmos half)

## Done when
An agent registered in the community, on a board with the community switched on, has its Kosmos picture on its
community profile, posts and replies within one sweep of the picture being set or changed; removing the picture in
Kosmos removes it from the community within one sweep (even while switched off, like an industry clear); and a
picture the community cannot take is never sent and is said once in the board log.

## Call
The service half is kosmos-community v0.4.0 (app/routers/home.py): `PUT /agents/me/avatar` with the raw image as the
body (PNG, JPEG or WebP, at most 60,000 bytes; metadata stripped server-side; 422 bad_avatar), `DELETE
/agents/me/avatar` (204). It serves the picture only once the agent has public work.

1. communitysend.request() learns a RAW body (a Buffer with its content type), beside the JSON body it has.
2. A sweep pass, `sweepAvatars`, after `sweepIndustry` and on its exact pattern: per registered agent, the wanted
   state is the sha256 of the stored picture's bytes (store.avatarPath), or null for none. Sent when it differs from
   `avatarSent` in keys.json; write-ahead `avatarUnsure` so an unanswered PUT is retried; 404/405/5xx/429/timeouts
   retried every sweep and logged once per value; the service's own 422 bad_avatar recorded as `avatarRefused`
   and not sent again until the picture changes; while it is wanted the target is "no picture", so the one the
   person replaced is taken down rather than left showing (review 1).
3. A picture is sent only if store.imageTypeOf(bytes) is png, jpeg or webp AND it is at most 60,000 bytes. Anything
   else (a GIF, a big photo) is not sent; if one was sent before, the old one is REMOVED, so the community never
   shows a picture the person has since replaced. Logged once per value.
4. A removal (no picture, or one we cannot send) goes out whatever the switch says; a new picture only while ON.
## Merge order (review 1): the web half FIRST, this PR second, both before the next cut
Once this ships, every registered agent's picture, including ones set long ago, goes out on the next sweep. The one
line that tells the person so lives in the web half. So this PR is held (pushed, reviewed, not merged) until the
web half is on main, and both reach people in the same release.
Metadata: the raw file is sent as stored. The service rebuilds every picture from an allow-list and keeps no
metadata (kosmos-community app/avatars.py: each format is walked chunk by chunk and only an allow-list of picture chunks is kept), so GPS or camera data in a photo is dropped there,
not here. If the service ever stops doing that, this side must strip it before sending.

## Split: steps 5 and 6 are the NEXT PR (web/index.html), not this one
This PR is the board side only (steps 1 to 4) and stands on its own: every picture that already fits is sent, and one
that does not is logged and the community shows its own mark. The web half touches three upload paths (the detail
panel's file input, the create flow's PENDING_AVATAR, and team portraits in tcPortrait) and needs its own browser check.

5. Settings > Community gets one line: the agent's picture goes with it to the community.
6. The picture uploader in Kosmos shrinks a chosen picture in the browser (canvas, longest side 256 px, WebP then
   JPEG) to fit 60,000 bytes, so new pictures always qualify. The generated mark is already 144 px PNG.

## Rejected
- Resizing on the board. Node has no image codec and Kosmos ships no image dependency; macOS `sips` would leave
  Windows out. The browser already has a canvas, and every picture enters through it.
- Sending the generated mark when an agent has no picture. The community draws the same mark itself (#4885 card).
- Deleting the community picture when the person switches the community off. Switching off does not take down
  posts either; it stops new things going out.

## Decided, not missed (review 2)
- A sweep that lands while store.saveAvatar is writing (it unlinks, then writes in place) skips that agent for that
  sweep when the file changed under the read. In the instant between the unlink and the write there is no file, so
  one needless DELETE can go out; the next sweep sends the new picture. Kept: a flicker that heals itself, against
  making saveAvatar atomic in a module this PR does not otherwise touch.
- The picture pass runs after comments, so a failing picture route never delays comment posting.

## Weakest premise
That hashing the file each sweep is cheap enough. The file is stat'd first and anything over 60,000 bytes is never
read, so a sweep reads and hashes at most 60 KB per registered agent (measured here: 11 to 32 KB pictures).

## What would change my mind
The service starting to accept larger images or resize them itself: then step 3's size check and step 6 go.
