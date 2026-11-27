# kosmos#9180: `kosmos feedback pull` is slow and silent

## Measured (origin/main)
`engine/feedbackpull.js` `pull` fetched every listed report one at a time, and every one again on every pull, and printed
nothing until its summary. Reached three ways: `install/kosmos feedback pull`, the Windows CLI `feedbackPull`, and the
module's own `runCli`.

## Change
1. **Skip what the folder already holds.** An index per folder, under the data root (`feedbackpull-index/<sha256 of the
   resolved folder>.json`), never in the folder (which holds reports only, and old tests list it exactly). Key: store
   path + uploadedAt + size. A report is skipped only while the file it was saved as is still in the folder, and only
   when its listing says when it was uploaded (without uploadedAt a path rewritten in place would look unchanged, so it
   is always fetched, as before). `--all` fetches everything. An unreadable index is an empty one; a name in it that
   fileName could not have made is not trusted.
2. **A few at once.** FETCH_AT_ONCE = 6 workers fetch; results are kept in list order and WRITTEN in list order, so two
   same-day blobs of one install (the collect route's write-then-delete window) resolve as the one-at-a-time loop did.
3. **Progress.** `onProgress` gets a line's facts at once when there is anything to fetch, then at most every 3 s while
   fetching; a throwing callback never fails the pull. The three callers print `progressLine` on stderr; the summary
   (stdout) now says "N already here".

## Decided, and the weakest premise
- Index outside the folder, not a `.pulled.json` inside: the folder is what people read and triage lists.
- Keyed on uploadedAt: weakest premise is that the store's uploadedAt changes whenever a path's content does. The collect
  route makes a NEW blob on a re-send (fileName's comment), so this holds for the store we have; a store without uploadedAt
  is never skipped.
- 6 at once: a small fixed number, below any rate limit we know of. Would change it: a 429 from the store.

## Tests
- `engine/feedbackpull-fast-9180.test.js` (7): skip on the second pull, re-sent / deleted / rewritten-in-place / --all
  fetched again, an untrusted or unreadable index, fetches at once with list-order writes, progress, no-uploadedAt.
- `cli.feedback-pull-fast-9180.test.js` (2): the real Mac CLI against a loopback store (the token from the module's
  setSecretsRunner seam, via a NODE_OPTIONS preload, so the operator's real secrets map is never asked: a PATH stand-in
  was tried first and lost to a real one ahead of it), and the Windows CLI through its engine seam.
- Each site perturbed alone turns its own test red (8 engine sites, 5 CLI sites, and the preload control).
