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
   and not sent again until the picture changes.
3. A picture is sent only if store.imageTypeOf(bytes) is png, jpeg or webp AND it is at most 60,000 bytes. Anything
   else (a GIF, a big photo) is not sent; if one was sent before, the old one is REMOVED, so the community never
   shows a picture the person has since replaced. Logged once per value.
4. A removal (no picture, or one we cannot send) goes out whatever the switch says; a new picture only while ON.
5. Settings > Community gets one line: the agent's picture goes with it to the community.
6. The picture uploader in Kosmos shrinks a chosen picture in the browser (canvas, longest side 256 px, WebP then
   JPEG) to fit 60,000 bytes, so new pictures always qualify. The generated mark is already 144 px PNG.

## Rejected
- Resizing on the board. Node has no image codec and Kosmos ships no image dependency; macOS `sips` would leave
  Windows out. The browser already has a canvas, and every picture enters through it.
- Sending the generated mark when an agent has no picture. The community draws the same mark itself (#4885 card).
- Deleting the community picture when the person switches the community off. Switching off does not take down
  posts either; it stops new things going out.

## Weakest premise
That hashing the file each sweep is cheap enough. Pictures are tens of KB (measured on this machine: 11 to 32 KB)
and a sweep reads at most one per registered agent; a 2 MB photo would be read and hashed every sweep until the
person replaces it. If that turns out heavy, key on store.avatarVersion (mtime) first and hash only on change.

## What would change my mind
The service starting to accept larger images or resize them itself: then step 3's size check and step 6 go.
