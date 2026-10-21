# kosmos#6734: attachments are streamed both ways, and the cap is 100 MB

A person's upload and an agent's `kosmos reply --file` can now carry a file up to 100 MB. The board never holds
the file in memory: an upload is written to disk as it arrives, and a download is sent from disk.

## Still live on main (measured at 2448d08597)

- `attachments.MAX_BYTES` was 25 MB (engine/attachments.js:46), enforced when a file is stored.
- `GET /api/attachment/<id>` read the whole file with `fs.readFileSync` and sent it in one `res.end` (server.js
  near 19060). The image preview (`/preview`) did the same through `attachments.preview`.
- `PUT /api/<scope>/<owner>/attachment` collected the body with `readBody` (an array of chunks, then
  `Buffer.concat`, so twice the file at the end) and only then wrote it.
- `rowField` read a text attachment WHOLE (`readFileSync(...).slice(0, 2000)`) to build its 2,000-character snippet,
  on the upload's answer and on every message that carries it.
- `replyfile.readOwn` allocated the whole file (up to the cap plus one byte) and `attachments.save` wrote it.
- The page checked `25 * 1024 * 1024` itself (web/index.html, `attachUpload`), not tied to the route.
- 25 MB was also written into the agent's instructions (engine/dmfiles.js), the CLI help (install/kosmos), the
  reply-file refusal (engine/replyfile.js), the store's own refusal, and three tests.

## What changed

- engine/attachments.js
  - `MAX_BYTES` = 100 MB; `MAX_WORDS` ("100 MB") and `TOO_LARGE` (the refusal sentence) derived from it.
  - Storing goes through one slot: a fresh id folder, the bytes written to `.upload.part` (a name `safeName` can never
    produce), renamed into place when whole, then `record.json`. `read` finds an attachment by its record, so a part
    file is never an attachment.
  - `saveStream(scope, owner, meta, readable)`: counts bytes as they arrive and refuses the moment the count passes
    the cap; a refusal, a client that goes away, or a write error removes the folder after the part file's
    descriptor closes. It leaves the request paused, not destroyed, so the route can still answer.
  - `saveFilled(scope, owner, meta, fill)`: the same slot for a synchronous writer (the reply-file copy).
  - `save(...)` keeps its signature and goes through the slot.
  - `textHead`: the text snippet is read from the first 8,000 bytes only.
  - `previewFile(rec)`: the preview as a file to send; `preview(rec)` is kept (it reads that file) for its callers.
- server.js
  - `sendFileStream(req, res, file, unread, headers)`: open once, `fstat` once (so Content-Length is the size of the
    very file sent), headers first, then `pipeline(createReadStream({fd}), res)`. A client abort and a read error
    both end in pipeline's cleanup, which closes the descriptor; a read error after the headers ends the response
    short (the client sees a cut download, never a whole one). Used by the download and by the preview.
  - The upload route: every existing auth, path and owner check is unchanged and still runs first. A declared
    `content-length` over the cap is refused before any body is read; otherwise `saveStream`. A refusal is the
    existing shape, 400 `{ error }`; when the body has not all arrived, the answer carries `connection: close` and
    the socket is cut a second later if the client holds it open (`refuseUpload`).
- engine/replyfile.js: `readOwn(real, st, given, out)` keeps every identity check, then copies the file into the
  part file a megabyte at a time (one byte past the cap still refused as "changed"); `attach` uses `saveFilled`.
  The size refusal names `attachments.MAX_WORDS`.
- web/index.html: `ATTACH_MAX_BYTES` (100 MB), and the over-cap sentence computes its figure from it.
- engine/dmfiles.js, install/kosmos: "up to 100 MB".

## Decisions

1. **The cap is 100 MB for both directions** (team lead's call, from the relay measurements kept privately: the relay
   streams with no byte cap, and 100 MB arrives well inside its limits when the board starts its answer promptly,
   which streaming now guarantees).
2. **The page keeps its own constant, held equal by a test**, instead of reading the cap from the board as the card's
   plan said. Reading it needs a new field on some payload the page already polls, and a fetch change carries its own
   guards (web.api-routes-3957). A test that evaluates the page constant against `attachments.MAX_BYTES` gives the
   same guarantee (they cannot drift without a red) at a smaller surface. Weakest premise: a future second copy of
   the figure in the page that the test does not look for. What would change it: the page needing the cap anywhere
   other than `attachUpload`.
3. **The daily reply-file allowance stays 200 MB** (engine/replyfile.js `DAILY_BYTES`). It is a brake on a looping
   agent, not a size of one file; it now allows two files at the cap rather than eight. Raising it with the cap would
   let a loop send 800 MB a day. Easy to change if Josh wants more.
4. **The boundary test uploads exactly MAX_BYTES, not MAX_BYTES - 1.** Both are accepted, but only the exact cap
   catches an off-by-one (`>=`); M6 below proves it does.
5. **The reply-file copy is still synchronous.** It now holds one megabyte, not the whole file, but copying 100 MB
   blocks the event loop for the length of a local disk copy (well under a second on this hardware). Making it async
   would reopen the time-of-check window the #6726 review rounds narrowed (the descriptor identity checks); not worth
   it for an agent-side path that is limited to 200 MB a day.
6. **Upload time.** Node's default request timeout (300 s) is unchanged. 100 MB at 1 MB/s takes 100 s; a slower
   uplink than about 350 KB/s cannot finish a 100 MB upload. Not changed here: Node has no per-route request timeout,
   so a longer one widens what a slow client can hold open on every route. Instead the page says so: a failed upload
   of a file over 25 MB (`ATTACH_SLOW_BYTES`) reads "We could not finish adding <name>. Kosmos waits up to five minutes
   for a file, and a large one on a slow connection can take longer: try a faster connection." A smaller one keeps
   "We could not reach Kosmos to add that file." (web.attach-slow-6734.test.js runs the page's own attachUpload with a
   failing fetch, both sizes; red with the size check removed.)
7. **Office files are not converted above 25 MB** (review 1). The text rendering (#6098) reads the whole file into
   its worker, and Buffer memory is outside the worker's heap limit, so at a 100 MB cap two PDFs at once could hold
   about 200 MB. `attachtext.MAX_RENDER_BYTES` (25 MB, the cap the conversion was built under) gates it, before any
   read: a larger file gets a rendering that says "Kosmos converts files up to 25 MB to text; this one is larger, so
   it is attached as it is.", and the macOS PDF fallback is skipped for it too. Test: a sparse 25 MB + 1 file gets that
   note with no fallback, and a small file (control) goes to the converter; red with the gate removed.
8. **Stored files are 0600 on every path**, `save()` included (review 1 NIT; it was the umask default).

## Windows (review 1)

The new test cannot run on Windows (it reads `/dev/fd`), and it is not in `tools/windows-tests.js`; Windows-side test
selection is Homer's lane, so this is noted rather than changed here. Measured from the code instead: every write
stream is closed before its rename or removal (Windows will not rename an open file). A download now holds the file
open for its whole length; the only paths that delete an attachment's folder are `abandon` (a failed upload's own
folder, before anyone can download it), `replyfile.discard` (a reply copy that was never kept, so never offered),
and the preview's temp folder. All three are best effort (`try`/`catch`), so none can fail a request on EBUSY.

## The chunked over-cap answer (review 1)

The test used to accept a reset in place of the 400. It now requires the 400 with `TOO_LARGE`: 6 of 6 runs got it at
a load average of about 10. If a client ever sees a reset instead, the page's own size check has already refused the
file before sending it.

## Tests (server.attachment-stream-6734.test.js, 14 tests, and web.attach-slow-6734.test.js, 1 test, all green)

- the cap is 100 MB and is said as "100 MB";
- a 6 MB download is byte-identical (sha256) with its Content-Length; HEAD has the length and no body; no
  descriptor left;
- a 64 MB download held by a paused client costs the board under 24 MB of buffers (control: the instrument sees a
  64 MB Buffer), and `readFileSync` is never called on the file;
- a download abandoned after its first chunk releases its descriptor (control: the descriptor is seen open
  mid-download), and the board keeps serving;
- a read that fails mid-file (an injected EIO) ends the response short, releases the descriptor, and the board keeps
  serving the whole file afterwards;
- an image preview is streamed, byte-identical, never read whole;
- an upload of exactly MAX_BYTES is kept byte-identical, the board's buffers peak under 48 MB while it arrives, and
  no part file is left;
- a declared length over the cap is refused with `TOO_LARGE` while only 16 bytes were sent, with no folder made;
- a chunked (undeclared) body of MAX_BYTES + 1 is refused and leaves no folder and no part file;
- an upload cut off after 2 MB of a declared 20 MB leaves nothing behind, and the next upload works;
- a 3 MB text file's snippet is its first 2,000 characters (multi-byte text), without reading it whole;
- the page constant, the agent's instructions and the CLI help name the route's cap.

Updated pins: engine/attachments.test.js (/larger than 100 MB/), server.reply-file-6726.test.js (the refusal names
100 MB), web.links-everywhere.test.js (the page checks `file.size > ATTACH_MAX_BYTES`).

## Mutation arms (each applied by exact string, the file run, then restored and checked byte-identical by sha256)

| arm | mutation | red |
|---|---|---|
| M1 | download back to `res.end(fs.readFileSync(file))` | memory, abandoned-fd, read-error, preview (4) |
| M2 | download `.pipe(res)` with no cleanup | memory, abandoned-fd, read-error, preview, at-cap, cut-off (6; the failed read hangs) |
| M3 | no cap check while streaming | chunked over-cap (1) |
| M4 | no folder removal on a failed upload | chunked over-cap, cut-off (2) |
| M5 | no declared-length check | declared over-cap, chunked over-cap, cut-off (3) |
| M6 | `size >= MAX_BYTES` | exactly-at-cap (1) |
| M7 | upload back to `readBody` then `save` | exactly-at-cap, on its memory bound (1) |
| M8 | page constant 25 MB | page/instructions/CLI agree (1) |
| M9 | snippet reads the whole file | text snippet (1) |
| M10 | preview back to `readFileSync` | preview (1) |
| M11 | no `close` listener on the upload | none: green |
| M12 | no `error` listener on the upload | none: green |
| M13 | neither listener | cut-off (1) |

M11 and M12 are each green because the other catches a cut-off upload alone (M13 proves the pair is needed). Both are
kept as two independent guards; whether every kind of cut emits both was not measured (only the one in the test, on
Node 26.8.1), so neither is relied on alone.

## Regression sweep

Every test file that names the touched code (`attachments`, `MAX_BYTES`, `reply-file`/`replyfile`/`reply --file`,
`api/attachment`, `dmfiles`, `attachUpload`, `ATTACH_MAX`, `install/kosmos`, `previewFile`/`saveStream`/
`saveFilled`), plus every repo-scanning test (`readdirSync(__dirname...)`, `ls-files`) and every fixed-window source
pin, built at run time with the new test file tracked: see the result recorded below.

## Remaining manual check (needs a person and a phone; not faked)

Card step 2. On a board running this build, signed in to Kosmos+ on an iPhone:

1. On the computer, make two files of random bytes and note their checksums:
   `head -c 41943040 /dev/urandom > ~/Desktop/k40.bin`, `head -c 104857600 /dev/urandom > ~/Desktop/k100.bin`,
   then `shasum -a 256 ~/Desktop/k40.bin ~/Desktop/k100.bin`.
2. In a conversation with an agent, attach `k40.bin` with the + and Send, then the same with `k100.bin` (exactly
   100 MB, which is the cap and must be accepted).
3. On the phone, away from the home Wi-Fi (cellular), open that conversation through Kosmos+ and tap each file's
   Download. Note how long each takes and whether it finishes.
4. Save each to Files on the phone and check its size there is exactly 41,943,040 and 104,857,600 bytes. If a
   checksum can be taken (AirDrop it back to the computer and run `shasum -a 256`), it must match step 1.
5. Start the 100 MB download again and cancel it half way. On the computer, check the board holds no descriptor on
   the file: `lsof -p <board pid> | grep k100.bin` prints nothing.
6. From the phone, attach a large video (over 25 MB, under 100 MB) to a message, and check it arrives on the
   computer with its size, and that the agent's pane line names the file.

Record the times, sizes and network on the card. Pass: both downloads finish with exact sizes, the cancelled one
leaves no descriptor, the phone upload arrives whole.

## Regression sweep result (2026-10-21 01:30 to 01:34 CDT, at 24ee64b031, main 0 commits ahead)

278 test files, built at run time from the name list, the repo-scanning tests and the fixed-window pins, with the
branch's four touched test files asserted present. Run through queued-heavy. `tests 5390, pass 5374, fail 0,
cancelled 0, skipped 16`, node exit 0. The branch's own tests appear in the output by name.
