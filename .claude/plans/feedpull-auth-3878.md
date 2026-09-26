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

## Review iteration 1
- `tokenMayGoTo` is exported and table-tested.
  - Accepted: https Vercel Blob hosts in any case, and the API origin.
  - Refused: plain http, a lookalike prefix (`evilblob.`), a lookalike suffix (`.com.evil.com`), a userinfo trick, a trailing dot, the bare parent domain, a foreign host, a non-URL.
  - The check is Vercel-host scoped, not store scoped, and the comment says so.
- A partial pull stays ok but returns `unreadable` and `lastGetError`, and both CLIs print "N of them could not be read (last error: ...)".
- The wrong-store hint follows only a 401 or 403. A 404 (a blob deleted between the list and the GET) does not blame the token.

## Review iteration 2
- `summaryLines(r)` is the ONE wording of a pull's success summary. runCli, the Mac `kosmos feedback pull` (install/kosmos) and the Windows command all print it. A test fails if either CLI words it itself.
- The wrong-store hint is sticky: any 401/403 in the run keeps it, even if a later read failed another way.

## Tests
engine/feedbackpull.test.js:
- the real transport's report GETs carry the token;
- a foreign-host report URL gets no token;
- all-unreadable gives ok:false, with a partial-pull control.

Nine mutations run red (also: a non-sticky hint, the Mac CLI's own copy of the summary): no auth header; token sent to any host; the silent success; the start anchor; the end anchor; https-only; token blamed on every error.

## Weakest premise
That the blob host pattern stays `*.blob.vercel-storage.com`. If Vercel changes it, the token is withheld and pull fails loudly (ok:false naming the error), never silently.
