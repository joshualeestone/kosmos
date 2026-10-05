# avatarfit-5302: fit agent pictures saved before #4885 (#5302)

Card: kosmos#5302 (bug). Owner: Angel. Built to Baron's recommendation on the card (10:35): fit in the page, not the engine.

## Finished looks like
An agent picture saved before #4885 (too big for the community's 60,000-byte cap, or a type it cannot take) is fitted
the next time the page reads the community setting (at page load, and when Settings' Automation section opens), saved back, and goes to the community; the Settings warning clears
itself. A picture that cannot be fitted is left as it is and the warning keeps telling the person to choose another.

## Changes
1. engine/communitysend.js: pictureToFit() lists the agents whose saved picture is too big or the wrong type, judged on
   the file as it is NOW (avatarWanted re-reads a changed file), so a just-fitted picture stops counting before the next
   sweep; pictureUnsendable() counts from it (plus the community's own refusals, as before).
2. server.js: GET/PUT /api/community-industry also carry picturesToFit (at most 100; [] without the function; null on a
   throw).
3. web/index.html: refitOldPictures(names), called from industryPaint: once per agent per page load, GET the picture
   (no-store), fitPicture it, and PUT it back only when fitPicture fitted it (PICTURE_FITS); one re-read of the setting
   after any save.

## Decided
- In the page, not the engine (Node has no image codec, no image dependency; #4885 rejected engine resizing).
- Overwrite the stored picture (what choosing it again does), but KEEP THE ORIGINAL first (review 1: otherwise the
  person's only copy is lost at page load with no click): store.keepAvatarOriginal copies it to avatar-originals/ (one per version and
  size, see Review 2/3), and the PUT carries the version it read, refused (409) if the picture changed since.
- Not the community's own refusals (avatarRefused): fitting would not change those.
- No new browser check: the canvas work is fitPicture (render-picture-fit-4885.js); the flow is node-tested with
  stand-ins. Override trailer on the branch; the full browser-checks run is still required before merge.
- No design shots: no visual change; the Settings sentence is unchanged (it stays true for a picture that will not fit).

## Weakest premise
The agent key in the send layer's keys file is a name the /api/agent/<name>/avatar routes resolve (both go through
store.avatarLookup / avatarPath with the same name); an agent whose community key differs from its board name would be
listed but its GET would 404, and it is skipped (tried once per load).

## Validation
web.* (2520), engine/communityavatar.test.js, server.community-picture-4885.test.js, the #2762 pin (23 -> 25), the file
guards; both browser-check gates; full browser-checks on the final head (queued).

## Review 1 (fixed)
Original kept before the overwrite; version-gated refit PUT (no race with the chooser); no re-read over an industry save in
flight. Decided NITs: a paint during a running refit drops its list until the next paint; pictureToFit is called twice per
read (small, flagged agents only).

## Review 2 (fixed / decided)
The gate lives in store.saveRefitAvatar (version check, keep the original, then save; runtime-tested: stale version and a
failed keep write nothing). One original per version (`<key>.<mtime><ext>`), copied to a temp name and renamed; removeAvatar
clears an agent's originals. Weakest premise: the version is the rounded mtime, so two saves in one millisecond share it
(the keep then finds that version already kept, which held the same bytes when it was kept).

## Review 3 (fixed / decided)
Nothing is fitted while Community is off (pictureToFit returns []); a version-0 refit is refused; originals are named by
version AND size; one unreadable name no longer blanks the whole list. Decided: the refit route itself has no HTTP test
(its gate is store.saveRefitAvatar, runtime-tested; a request test needs a running agent card, the route is pinned by
source); originals of a picture later replaced through the chooser stay until the agent's picture is removed.

## Review 4 (fixed / decided)
The Settings count (pictureUnsendable) ignores the Community switch, as before; only the refit list respects it.
Decided: agent removal (engine/remove.js) does not delete an agent's picture today, so its kept originals follow the same
lifetime (removeAvatar clears both); a hard kill mid-copy can leave a dot-named temp file in avatar-originals/.
