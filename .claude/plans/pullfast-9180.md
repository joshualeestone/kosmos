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

## Review round 1 (opus, blind)
- [CRITICAL] two same-day objects of one install write one file; both stayed indexed, so when the OLDER was written last and then deleted from the store, the survivor was skipped for ever with the wrong content --> FIXED: a write to a file un-indexes every other object saved in it. Test (reproduces the reviewer's measured case); removing the line turns it red.
- [WARNING] with everything already here no read happened, so a token that lost read access passed as success; and reports already here hid a pull whose every new read was refused --> FIXED: with nothing to fetch one report is read back as a check (a refused read fails the pull, naming it); and "none pulled" fails when any read or save failed, already-here or not (malformed-only beside held reports does not). Tests both arms plus a control.
- [WARNING] the index was 0644 --> FIXED: 0600 file, 0700 folder (it lists store paths and install ids). My first try passed no mode, writeSecret threw, writeIndex swallowed it, and every skip test went red: the tests caught a silent no-index.
- [WARNING] the CLI test could not prove the seam's token reached the store --> FIXED: the stand-in store answers 401 to any other token (control: a different seam token fails the test), and NODE_PRESERVE_SYMLINKS is cleared in the child.
- [NIT] runCli usage line lacked [--all] --> FIXED. [NIT] a hand-edited report file is now kept --> ACCEPTED: --all is the documented way to fetch it again.

## Review round 2 (sonnet, blind, whole branch): no critical
- [WARNING] the read-back check failed a healthy pull on ANY error (a report deleted since the listing: 404) --> FIXED: it runs after the fetches, only when this pull read nothing at all; up to three held reports; a REFUSED read (401/403) fails the pull, any other error tries the next, and none reading is still a success with a "note:" line. Tests: next-on-404, all-blip note.
- [WARNING] two tests passed on the check's own read (an untrusted index name; the same-day pair), and no test covered a failed save beside held reports --> FIXED: the index test asserts the file came back and which read happened; a failed-save-beside-held test; a url-less-new-only test (the check must still run). isSavedName off now turns its test red (it stayed green before: the plan's earlier "every site red" claim was wrong for it).
- [WARNING] "none was pulled (2 already here)" overstated a complete folder --> FIXED: "N already here, and none of the new ones (M) could be pulled".
- [NIT] a pull killed between a report write and its index save could leave a wrong entry --> FIXED: records are parsed first, the files about to be written are un-indexed and the index SAVED before any write. Test simulates the stop (every later index save fails).
- [NIT] an existing index folder keeps its mode --> ACCEPTED: the file itself is 0600.
