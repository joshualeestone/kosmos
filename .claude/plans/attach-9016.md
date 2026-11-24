# attach-9016: a file that did not arrive whole is never taken as whole (kosmos#9016)

**Posture:** production

**Finished looks like:** a person who attaches a file learns at once when it arrived short or long of what they sent, and a
zip-based file (a spreadsheet, a document) whose end is missing is marked beside the file and to the agent it is handed to.
A file that arrived whole looks and works exactly as before.

## What was found (measured 11-24, on origin/main)
- Not reproduced. The board's upload route keeps 65,535 / 65,536 / 65,537 bytes, 1 MiB and 10 MiB byte-identical, sent
  with a declared length, chunked, paused after the first 64 KiB, and in 16 KiB pieces (20 runs, sha256).
- The CLI's copy loop (engine/replyfile.js readOwn) reads to the file's own size; the relay's upload proxy aborts a body that
  ends early rather than ending it (read, with its own tests; not run live). The phone uploads a copy of the file without
  comparing the copy with the source (Mona Lisa's finding), so a file still being written on the phone could go up short with
  a consistent length. The phone half is hers.
- So a cause the server cannot see remains possible, and an incomplete zip is detectable whatever the cause.

## Change
- web/index.html attachUpload: header `x-attachment-size`, the file's own size as the browser read it.
- server.js PUT attachment: reads the header (plain decimal digits; anything else is ignored; over the cap refused at once) and
  passes it to saveStream as `fileSize`.
- engine/attachments.js: saveStream refuses a body whose counted size differs from `fileSize`, with
  "that file did not arrive whole; please send it again (64 KB of 112 KB arrived)"; nothing is stored.
  `incompleteZip(file)`: a file starting as a zip with no end record, or one whose directory lies outside the file, is
  incomplete (zip64, and any read that fails, are not judged). finish() records `incomplete: true`; rowField carries it;
  the agent's note says so; the page's file card says "incomplete upload, please send again" (.att-bad).

## Rejected
- Refusing an incomplete zip outright: the person's bytes would be lost, and a rare legitimate file could be refused.
- Trusting Content-Length: it is about the wire, and a chunked or forwarded body need not carry it.

## Weakest premise
That the size the sender states is the size of the file it read: a browser that reads a file still being written states a size
no smaller than what it then sends. The zip check is the second net.

## Tests
server.attachment-whole-9016.test.js: boundary sizes in three ways of sending, size header right / wrong / absent /
malformed / over the cap, real zips cut at several points and whole, what is and is not judged, the CLI copy loop at the
boundary, the page's words and header. docs/browser-checks/render-attach-incomplete-9016.js. The pinned upload test (web.links-everywhere)
requires the size header. Each main piece was removed in turn and its test failed.
