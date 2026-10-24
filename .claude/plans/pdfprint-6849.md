# pdfprint-6849: the same source rendered twice gives one fingerprint (kosmos#6849)

**Card.** From a user's feedback (Splinter triage): re-rendering the same markdown gives PDFs with different hashes
(embedded creation timestamps), so agents cross-checking a handed-off document cannot compare like with like.

**Measured (2026-10-21, one markdown file rendered twice on this Mac, 1.2 s apart):**
- pandoc + WeasyPrint: identical bytes (it writes no dates).
- Chrome print to PDF (Playwright page.pdf): 2 bytes differ, inside /CreationDate and /ModDate.
- macOS cupsfilter: 62 bytes differ, in /CreationDate, /ModDate and the trailer /ID pair.
Nothing else differs.

**Where Kosmos fingerprints files:** `kosmos task built --file` (install/kosmos: shasum; tools/windows/kosmos-cli.js: node
crypto) and `kosmos handoff` (engine/handoff.js). All three were the plain sha256 of the bytes. Kosmos renders no PDFs.

**The call: a fingerprint that leaves a PDF's own clock and identity out, not a deterministic render.** Kosmos does not
render the PDFs, so it cannot fix their metadata at the source; agents use whatever tool they have.
- One function, engine/fileprint.js, used by all three and by a new `kosmos fingerprint <file>` (Mac and Windows).
- For any file but a PDF it is the plain sha256 (what `shasum -a 256` prints), so nothing changes for those.
- For a PDF (a file that starts with %PDF-) it is the sha256 with /CreationDate, /ModDate (literal or hex strings),
  the /ID pair, and the XMP CreateDate, ModifyDate, MetadataDate, DocumentID and InstanceID emptied.
- Same `sha256:<hex>` shape, so the board, its check and its displays need no change.
- The agent instruction (engine/defaults.js) says to check a copy with `kosmos fingerprint`.
- Rejected: a second "content" fingerprint beside the raw one (the board, its regex and both displays would change for
  the same benefit); a deterministic render (not Kosmos's to make).

**Done when.** The two real Chrome renders, and the two real cupsfilter renders, each give one fingerprint while their
plain sha256s differ (the control); a render with one word changed gives another; a non-PDF gives its plain sha256;
`kosmos fingerprint` and `task built --file` give the same value on Mac and Windows.

**Weakest premise.** That the volatile fields sit in uncompressed objects. A PDF that keeps its document info in a
compressed object stream is hashed as it is (its dates are not read without inflating every stream). Also a PDF over
64 MB (64,000,000 bytes, as the help says) is hashed as plain bytes rather than held in memory. Stream bodies are skipped (review 4), except the XMP fields of the
metadata stream, so page text shaped like `/ModDate (...)` changes the print. Outside streams the objects are read as PDF
syntax with strings opaque (review 9), so a form value, annotation or Title shaped like one does too. Left: a file built so
a stream's edges are misread (endstream inside a stream with an indirect /Length, or `>> stream` inside a string) could
match another; a check, not a tamper proof. Also not emptied (review 10, no renderer measured writes them; each gives
two fingerprints for one document, never one for two): a date held as an indirect object (`/ModDate 5 0 R`), a key
name written with `#` escapes, and a comment between a key and its value.
`task built --file` on a Mac now needs the bundled runtime and engine, as `kosmos handoff` and the Windows CLI already do.

## Tests run
- engine/fileprint-6849.test.js 18/18 (real fixtures in test-support/fileprint-6849/); server.builtsha-6330.test.js
  8/8 (Mac CLI); tools.windows-kosmos-cli-570.test.js 51/51 (Windows CLI); each PDF test red when PDF detection is
  broken on purpose; review 4's stream and whitespace tests red against the round-3 module; review 5: the CR-alone stream test red against the round-4 module, the /Type /Metadata test red with that check broken on purpose.
- engine/handoff.test.js 23/23 after the move.
