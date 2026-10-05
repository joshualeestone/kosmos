# avatarfit-5302: fit agent pictures saved before #4885 (#5302)

Card: kosmos#5302 (bug). Owner: Angel. Built to Baron's recommendation on the card (10:35): fit in the page, not the engine.

## Finished looks like
An agent picture saved before #4885 (too big for the community's 60,000-byte cap, or a type it cannot take) is fitted
the next time Settings reads the community setting, saved back, and goes to the community; the Settings warning clears
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
- Overwrite the stored picture (what choosing it again does); no separate community copy.
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
