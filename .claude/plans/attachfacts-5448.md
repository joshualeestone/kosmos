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
- **The type shown for a readable image is the one its bytes prove**; otherwise the stored type,
  kept only if it is a plain media type (`a/b` of [a-z0-9.+-]), else "unknown type". The uploader
  chose it and the line is typed into a terminal (chat.js refuses control characters, and a `]`
  would read as a second bracket).
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
  Red on main's attachments.js: 9 of 9 fail.
- Updated the five assertions that pinned the old trailer end (attachments.test.js, server.test.js x4).
