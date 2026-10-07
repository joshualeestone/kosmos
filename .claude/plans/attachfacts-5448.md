# attachfacts-5448: an attached file reaches the agent with its facts

Card: #5448. Branch: attachfacts-5448. Owner: Baron Draxum (night shift 2026-10-06).

## Goal
The bracket the agent receives for each attached file, ` [attached file: <path>]`, also carries
the file's facts: ` [attached file: <path> (image/png, 1280x720, 312 KB)]`. Non-images: type and size.
The same trailer reaches DMs (server.js -> chat.deliverAsync) and rooms (messages.js), so one change
in `attachments.wireNote` covers both.

## Decided
- **Dimensions are read at send time from the file's first 256 KB**, not stored on record.json at
  save. One code path, and files attached before this change get dimensions too. Cost: one bounded
  sync read per attached image per send (at most 10 per message).
- **Header parsing only, by magic bytes**: PNG IHDR, GIF screen descriptor, JPEG first SOF (segment
  walk), WebP VP8 / VP8L / VP8X. HEIC and AVIF answer no dimensions (nested boxes); the agent still
  gets type and size, which is true.
- **For an image, the type shown is the one its bytes' signature matches** (PNG, GIF, JPEG, WebP),
  with dimensions when the header could be read; a real JPEG whose frame header is past 256 KB keeps
  its type without dimensions. A stored png/gif/jpeg/webp type whose bytes carry no such signature
  says "unknown type" (review 1: for those four the bytes can contradict the claim, so a
  contradicted claim is not repeated). A non-image file's stored type is NOT verified (an executable
  uploaded as application/pdf says application/pdf): proving a PDF's or a ZIP's type is beyond this
  card, and it is the same type the board already shows on the attachment card (review 4). A
  claimed png/gif/jpeg/webp type is dropped only when the bytes were read (review 6).
- **Signatures, not validation** (review 6): JPEG = FF D8 FF plus an opening marker; WebP = RIFF,
  WEBP and a VP8/VP8L/VP8X chunk. Between JPEG segments only zero padding is skipped.
- **Deferred (review 6): the header read is synchronous** on the send path, bounded at 256 KB per
  image and 10 images per message, and said at wireNote. Making it async changes three server call
  sites for a local read; reconsider if the data folder can be a network mount. Otherwise the stored
  type, kept only if it is a plain media type (`a/b` of [a-z0-9.+-]), else "unknown type". The
  uploader chose it and the line is typed into a terminal (chat.js refuses control characters, and
  a `]` would read as a second bracket).
- **Only a regular file is opened** for the header read (review 2: a FIFO open could block).
- **Size is read from disk** (stat), falling back to the record's count; said as bytes / KB / MB in
  1024s, as the 25 MB cap counts.
- **The name is not repeated**: the path already ends with it.

## Rejected
- Storing width/height on record.json at save: two paths (old records lack it) for no gain.
- Decoding images, or shelling out to sips: slow, macOS-only, and parses untrusted bytes in a renderer.
- Repeating the file name in the parenthetical: noise.

## Weakest premise
That agents read the parenthetical as facts about the file and not as part of the path. The path is
absolute and the parenthetical is separated by a space and a paren; a file whose own name ends in
" (something)" is the confusable case, and it was already ambiguous to the eye before this change.

## Tests
- `engine/attachments.facts-5448.test.js`: real 13x7 files from sips, PIL and cwebp (PNG, GIF,
  progressive and baseline JPEG, three WebP chunk kinds, HEIC), a JPEG behind 130 KB of APP1,
  controls (wrong magic, cut PNG, JPEG cut before its frame header, HEIC -> null), the trailer for an
  image, a mislabelled image, a PDF, text, HEIC, a hostile type, and two files in order.
  Every test in it fails against main's attachments.js (measured at each review round's commit).
- Updated the five assertions that pinned the old trailer end (attachments.test.js, server.test.js x4).
