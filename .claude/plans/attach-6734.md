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
- Two more readers of a whole file followed the cap without saying so (found in review, not in the first pass):
  `filepreview.tooBig` compared against `attachments.MAX_BYTES` (decision 9), and the office-file text conversion
  (`attachtext.render`) read whatever was stored (decision 7). Both now have their own 25 MB limit.
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
    both end in pipeline's cleanup, which closes the descriptor and destroys the response, so the client sees a cut
    connection, never a whole file (decision 15 does the same for a file that shrank). Used by the download and by the
    preview.
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
   so a longer one widens what a slow client can hold open on every route. Instead the page says so; the sentences
   that ship are in decision 13 (this decision's first wording was replaced there). A smaller file's network failure
   keeps "We could not reach Kosmos to add that file." (web.attach-slow-6734.test.js runs the page's own attachUpload
   with a failing fetch and with a 408, at both sizes.)
7. **Office files are not converted above 25 MB** (review 1). The text rendering (#6098) reads the whole file into
   its worker, and Buffer memory is outside the worker's heap limit, so at a 100 MB cap two PDFs at once could hold
   about 200 MB. `attachtext.MAX_RENDER_BYTES` (25 MB, the cap the conversion was built under) gates it, before any
   read: a larger file gets a rendering that says "Kosmos converts files up to 25 MB to text; this one is larger, so
   it is attached as it is.", and the macOS PDF fallback is skipped for it too. Test: a sparse 25 MB + 1 file gets that
   note with no fallback, and a small file (control) goes to the converter; red with the gate removed.
8. **Stored files are 0600 on every path**, `save()` included (review 1 NIT; it was the umask default), and so is each
   attachment's record.json (review 12; test checks both).

9. **The Files preview keeps its own 25 MB limit** (review 2). `filepreview.tooBig` used `attachments.MAX_BYTES`, so
   raising the cap would have let the full-page preview of an agent's or a project's file read 100 MB whole (a PDF
   twice). It is now `filepreview.MAX_PREVIEW_BYTES`, 25 MB. Test: a 25 MB + 1 file is "too big to show here", one at
   exactly 25 MB is not (control); red with the old comparison.
10. **Orphans from a stopped board are swept** (review 2). A crash mid-upload leaves a folder with a part file, or a
   renamed file whose record.json was never written. `attachments.sweepOrphans()` runs at board start and hourly
   beside the preview cache sweep: it removes only a folder named like an attachment id, two levels under the store
   root, with no record.json and nothing touched for an hour. Test: two old orphans removed; a fresh one, a real
   attachment and a folder not named like an id kept; red with either the record check or the age check removed.
11. **Reads stop at what was measured** (review 2). `replyfile.readOwn` copies at most one byte past the size its
   descriptor reported (as before #6734), not up to the cap; a download streams exactly the measured size
   (`start`/`end`). Tests make fstat under-report (what a file that grew looks like): the reply copy writes at most
   size + 1 bytes, and two downloads over one keep-alive connection both arrive whole. Without the bound the second
   response on that connection fails to parse (measured), so the bound protects the next request, not just this one.
12. **Smaller:** a failed stat before conversion converts nothing (it used to read as size 0); a HEAD answer or an empty
   file ends the response before closing the descriptor, inside a try.

13. **A timed-out upload is named as one** (review 3). Node answers its request timeout with 408 rather than dropping
   the connection (measured on Node 26.8.1, a slow PUT against a short `requestTimeout`), so the fetch resolves and the
   catch from decision 6 never runs for that case. A 408 now reads "We could not finish adding <name>: it took too long
   to arrive. Try again on a faster connection." (review 6: no figure, since a 408 could come from a timeout on the
   way that the page cannot tell apart) A large file whose connection
   fails outright now reads "If your connection is slow, a file this large can take longer than Kosmos waits for
   one.", a condition, since the page cannot tell that from Kosmos not being reached (review 8: no figure either,
   since any timeout on the way can change it). Tests: 408 at two
   sizes, a 502 control, both catch sizes; red with the 408 branch removed.
14. **A download opens without blocking** (review 3), so a FIFO put in a stored file's place is refused (404) at once
   instead of stalling the board until a writer appears. Test on macOS and Linux; with a blocking open the test
   process hangs (measured: killed by a 20 s alarm). A failed stat before conversion now says "Kosmos could not read
   this file to convert it." rather than calling it too large.

15. **A download of a file that shrank is cut** (review 4): `sendFileStream` destroys the response when its read
   stream ends before the measured size, instead of ending it short, which left a keep-alive client waiting for the
   missing bytes (measured: with the check removed the test's client is still waiting at 3 s). `writeHead` moved inside
   the `try`, so a throw there closes the descriptor.
16. **A reply copy that cannot be written says so** (review 4): "Kosmos could not store a copy of that file", not
   "that file could not be read". Test: a read-only output descriptor, with a writable one as the control.
17. **Only `slot()` makes id-named folders under the store** (review 4 asked; measured with git grep): its three
   callers (`save`, `saveFilled`, `saveStream`) each write record.json or abandon the folder, and replyfile only reads
   the store. So the orphan sweep cannot meet a folder some other feature keeps without a record. The preview's temp
   folder (`preview-<pid>-<time>`) is not id-named and sits inside a record's folder.

18. **An image over 25 MB has no thumbnail** (review 5). An image's preview is the image itself, so at a 100 MB cap a
   message card scrolled into view could pull 100 MB (on a phone, over cellular, then decoded in memory).
   `rowField` gives such an image no preview URL, so its card is the plain file card and Download still gives the
   file; the preview route refuses it too. A PDF keeps its thumbnail (a small rendered page). Test: 25 MB + 1 has none,
   exactly 25 MB keeps it, a 100 MB PDF keeps it; red with the limit removed.
19. **The reply-file refusal says "larger than 100 MB"** (review 5): its rounded size read "100 MB" just past the cap.
   `textHead` opens without blocking and reads only an ordinary file, like the download.

### Through Kosmos+ the relay cut uploads at two minutes (found while checking the five-minute figure)
The tunnel waits 120 s for the board's response head (`BOARD_RESPONSE_HEAD_TIMEOUT`, crates/tunnel/src/proxy.rs),
and the clock started when the request did, with the upload body streaming inside that wait. The board answers only
once the whole file has arrived, so a phone upload that took more than two minutes got a 502 from the tunnel
("We could not add that file (status 502)."), whatever the board allows: 100 MB needed about 850 KB/s up.
Fixed in kosmos-relay (branch headclock-6734): the 120 s now counts, in full, from the end of the request body, and
the body itself may take up to 6 minutes (just past the board's five, which is Node's default request timeout: the
board sets none, measured with git grep at kosmos origin/main). It ships with the
tunnel, so until a build carrying it is installed, phone uploads over two minutes still fail. Not measured on a
phone yet: the remaining manual step covers it.

20. **Review 8:** the orphan sweep's safety condition is stated at the function and guarded by a test that fails if any
   file other than attachments.js reaches into the store (by `attachments.ROOT` or by building the path), or if
   replyfile starts writing there (red with either spelling appended to another engine file). An upload whose part
   file cannot be written (a full disk, injected through the write stream's own `fs` option) is refused with "that
   file could not be kept" and leaves nothing (red with another sentence, and with the folder not removed). A client
   sending `Expect: 100-continue` with an over-cap length gets Node's automatic 100 Continue and then the refusal, so
   it may send its body before the connection closes: bandwidth only, nothing stored, and the page never sends one.

21. **Review 9:** an upload that fails with a system error (a rename or record write on a full disk, say) is refused
   with "we could not keep that file", not the raw error, which carries a path with the user's name and would reach
   their phone too. The store's own refusals are sentences with no `code` and pass through unchanged.

22. **Review 10:** a large file's network failure reads "We could not reach Kosmos to finish adding <name>. If your
   connection is slow, a file this large can take longer than Kosmos waits for one.", naming both causes, since the
   page cannot tell Kosmos being unreachable from the wait running out. (Review 11: "to add", not "to finish adding",
   which was untrue when nothing had started.)
23. **Review 11:** `safeName` stripped leading dots before trimming, so " .upload.part" kept its dot and was stored
   under the part file's own name (an attachment that answered 200 and could never be read). Leading spaces and dots
   are now stripped together (tests: " .upload.part", " .env", " . .x"; red with the old order). The orphan sweep's
   record check fails closed: only a record that is certainly absent (ENOENT) makes an orphan, so a dangling
   record.json link keeps its folder (test with backdated times, so age cannot be what keeps it; red with the old
   `existsSync`). The sweep test cleans its controls in a `finally`.

### Considered and not changed (review 10)
- **The orphan sweep's residual cases:** a writer reaching the store by a spelling the guard does not scan (a shell
  script, say), or an older build. Older builds also wrote record.json last, so a folder without one was already an
  orphan. Attachments sit outside what backups copy, so a restore never writes there. Would change it: any feature
  that stores files under the attachment store without going through attachments.js.
- **Windows coverage and the memory tests' sensitivity to load:** as recorded above (the Windows section; the memory
  bounds have controls that show the instrument sees a 64 MB Buffer).

### Considered and not changed (review 6)
- **No Range support on downloads**: a 100 MB download cut at 90% restarts from zero, and the tunnel retires its
  connection hourly, which cuts a download in flight. Resuming is a feature, not a defect in this change; filed as its
  own card, #6805. Weakest premise: that a cut 100 MB download is rare enough on a phone to ship before it.
- **A board-side refusal while a large upload is still arriving** (a bad name, a write error) can reach the page as a
  reset, which then shows the conditional slow-connection sentence. The page refuses over-cap files before sending,
  and the sentence says "if", so it is not asserted as the cause.

### Considered and not changed (review 3)
- `attachments.preview(rec)` still reads a file whole. Only tests call it (engine/attachments.test.js); every route uses
  `previewFile` and streams. Kept for those tests; a new route caller would be a review finding.

### Considered and not changed (review 2)
- **The reply-file copy is synchronous** (decision 5 stands). Yielding between chunks would reopen the window the
  descriptor identity checks closed. Bounded by the 200 MB daily total per agent. Weakest premise: "well under a
  second" was measured on a local SSD; a slow network disk would stall the board for the copy. Would change it: a
  report of the board stalling while an agent attaches a file.
- **A declared over-cap body larger than the test's 16 bytes** may see a reset before the 400 on a real socket. The
  page refuses an over-cap file before sending, so only the CLI or another client meets it, and the refusal still
  holds (nothing is stored). Not tested with a large body.
- **The five-minute figure in the slow-upload sentence**: no longer in any sentence (decisions 13 and 20 removed it),
  so nothing here depends on the relay's timing.

## Windows (review 1)

The new test cannot run on Windows (it reads `/dev/fd`), and it is not in `tools/windows-tests.js`. That is a coverage
gap, stated here; this branch changes no Windows-side code or test selection, so nothing was handed to Homer. Measured from the code instead: every write
stream is closed before its rename or removal (Windows will not rename an open file). A download now holds the file
open for its whole length; the only paths that delete an attachment's folder are `abandon` (a failed upload's own
folder, before anyone can download it), `replyfile.discard` (a reply copy that was never kept, so never offered),
and the preview's temp folder; and `sweepOrphans` (decision 10), which removes only folders with no record.json,
which are never served and so never held open by a download. All are best effort (`try`/`catch`), so none can fail a
request on EBUSY.

## The chunked over-cap answer (review 1)

The test used to accept a reset in place of the 400. It now requires the 400 with `TOO_LARGE`: 6 of 6 runs got it at
a load average of about 10. If a client ever sees a reset instead, the page's own size check has already refused the
file before sending it.

## Tests (server.attachment-stream-6734.test.js, 26 tests, and web.attach-slow-6734.test.js, 2 tests; green at each review commit, and the full suite at the final head is in the proof file)

- the cap is 100 MB and is said as "100 MB";
- a 6 MB download is byte-identical (sha256) with its Content-Length; HEAD has the length and no body; no
  descriptor left;
- a 64 MB download held by a paused client costs the board under 24 MB of buffers (control: the instrument sees a
  64 MB Buffer), and `readFileSync` is never called on the file;
- a download abandoned after its first chunk releases its descriptor (control: the descriptor is seen open
  mid-download), and the board keeps serving;
- a read that fails mid-file (an injected EIO) cuts the response, releases the descriptor, and the board keeps
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

## Regression sweep result (2026-10-21 01:30 to 01:34 CDT, at 24ee64b031, main 0 commits ahead; SUPERSEDED by the review fixes since: the full suite on Mortals at the final head replaces it, recorded in the proof file)

278 test files, built at run time from the name list, the repo-scanning tests and the fixed-window pins, with the
branch's four touched test files asserted present. Run through queued-heavy. `tests 5390, pass 5374, fail 0,
cancelled 0, skipped 16`, node exit 0. The branch's own tests appear in the output by name.
