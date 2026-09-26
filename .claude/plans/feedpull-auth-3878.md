# kosmos#3878 (reader half): `kosmos feedback pull` reads the private feedback store

chaoskosmos-site branch `feedback-private-3878` moves the daily reports into a PRIVATE
Vercel Blob store. A private blob URL answers 403 without the store's token. Today
`engine/feedbackpull.js` GETs each report URL unauthenticated, so after the
migration it would pull nothing, and it would still report `ok: true`.

## Change
- `defaultGet(url, tok)` sends `authorization: Bearer <tok>`, the header @vercel/blob's own `get()` sends (checked in the 2.8 source).
  - The token goes only to `https://*.blob.vercel-storage.com` or the configured blob API origin. The URL comes from the listing, and a listing that names any other host must not receive the credential.
  - The header is harmless on public blobs, so this ships BEFORE the migration.
- `pull` counts unreadable GETs separately from malformed records. If the store listed reports but none could be read, it answers `ok: false` with the error and a pointer to the likely cause (the token filed for the wrong store). A partial pull is still ok.

## Order (with the site PR)
1. This merges.
2. The site merges and deploys with the next release.
3. Run the migration.
4. Refile secrets target `vercel-blob-feedback` with the FEEDBACK store's token.

## Tests
engine/feedbackpull.test.js:
- the real transport's report GETs carry the token;
- a foreign-host report URL gets no token;
- all-unreadable gives ok:false, with a partial-pull control.

Three mutations run red.

## Weakest premise
That the blob host pattern stays `*.blob.vercel-storage.com`. If Vercel changes it, the token is withheld and pull fails loudly (ok:false naming the error), never silently.
