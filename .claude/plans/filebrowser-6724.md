# filebrowser-6724: browse an agent's Files from another computer

Card: kosmos#6724 (Josh, #admin 2026-10-20 08:58). Viewing a board remotely, "Open in Finder" opens a window on the
far Mac. Asked: hide those actions when viewed remotely; an in-app, read-only browser for the agent's folder
(folders and files, size and date, preview of images, PDFs and text, download a file and a folder as a zip); the same
limits as the Files list (the agent's own folder, no paths outside it, no link escapes), with a test per escape.

## What exists (measured from the code, 2026-10-20)
- `GET /api/agent/:name/files` lists the agent's Files folder (`dmfiles.filesDir`), FLAT (`listFiles`, `maxDepth: 0`).
- preview, download and reveal-file go through `listedFileVerb` -> `filepreview.resolve` ->
  `projects.resolveListedFile(listed)`: shape gate, an lstat walk (no link, no hidden or skipped folder, depth),
  realpath inside the realpath'd folder, resolved path equal to the walked path, the read handle checked with
  `sameOpenedFile` (O_NOFOLLOW, O_NONBLOCK). Files itself being a link is refused by the route.
- Preview covers images and a PDF's first page; text is not previewed. Nothing in the repo writes a zip.
- The page knows it is remote by its own hostname (`kplusRemote()`); over Kosmos+ the Finder buttons stay on screen
  and say "That folder is on the computer Kosmos runs on..." when clicked.

## Decisions
1. **Which folder:** the agent's Files folder, the one its Files list already shows, now with its subfolders. NOT the
   agent's whole working folder (instructions, memory, worktrees). Rejected: the whole folder, because it holds the
   agent's instructions and working state, which the card does not ask to expose over the remote link.
   Weakest premise: that "the agent's folder" in the card means Files. If Josh wants more, widening the root is a
   small follow-up; narrowing one already exposed is not.
2. **Browsing:** `GET /api/agent/:name/files/browse?dir=<rel>` answers one level: `dirs` and `files`, the files named
   by their path relative to Files (the names preview, download and open already take). The folder is resolved by a
   new `projects.resolveListedDir`, the folder twin of `resolveListedFile`: the same shape gate, the same lstat walk
   (every segment a real folder, never a link, never a hidden or skipped one), realpath equal to the walked path and
   inside the folder. Depth cap `AGENT_BROWSE_DEPTH = 8` below Files. At most 1000 entries per folder (`truncated`).
3. **Preview and download reach subfolders:** the agent route's `maxDepth` goes from 0 to `AGENT_BROWSE_DEPTH`, so any
   file the browser shows can be previewed and downloaded, and nothing it does not show. The narrow-panel list stays
   flat (its own test still holds). The test that pinned "a file below the top level is refused" for the agent is
   changed on purpose, with this reason.
4. **Text preview:** `filepreview.preview` answers a text file (attachments' `kindOf` text extensions) with its first
   256 KiB as `text/plain; charset=utf-8`, from the same checked handle, under the same sandbox CSP and nosniff. A file
   with a NUL byte in that head is not text and is refused. `x-kosmos-preview-cut: 1` says it was cut. Shared with
   project lists (one preview module).
5. **Folder as zip:** `GET /api/agent/:name/files/download-folder?dir=<rel>` streams a zip of that folder (all of Files
   when `dir` is empty). The walk applies the browser's rules (no links, no hidden or skipped names, the depth cap).
   Every file is gated again at read time by `resolveListedFile(listed)` and its handle checked with
   `sameOpenedFile`. Entries are STORED (no compression), so the length is known before the first byte:
   `content-length` is sent, and a file whose size changed mid-download ends the connection rather than sending a
   wrong zip. Caps: 2000 files, 1 GiB in all (no ZIP64 needed). Over a cap is a refusal with the reason, before any
   byte. `?check=1` answers 204 or the refusal, like the file download. UTF-8 names (flag bit 11).
   Rejected: deflate (needs the compressed size up front, or data descriptors, which some unzippers mishandle for
   stored entries; agents' Files are mostly PDFs and images, which do not compress).
6. **Remote:** every button that opens a folder window on the board's computer carries `data-remote-hide`, and
   `html[data-kplus-remote]` (set at load when `kplusRemote()`) hides them. The handlers keep their sentence as a
   backstop. Buttons: `#d-files-finder`, `#docs-finder`, `#pjs-reveal`, `#pjs-chats-reveal`, `#tk-chats-reveal`,
   `#set-reveal`, `#upd-open-folder`.
7. **The Files screen becomes the browser:** a path line (Files / sub / ...), folders first, then files with size and
   date; a folder row opens it; a file row previews (image, PDF, text), else opens on the computer (local) or
   downloads (remote), as today. "Download folder" in the head downloads the folder being shown as a zip.
8. **Read-only.** No upload, rename or delete (upload is a separate card).

## Tests (a test per escape)
`server.filebrowser-6724.test.js`, against a sandboxed board like `server.file-download-5165.test.js`:
browse and zip each refuse `..`, `a/../..`, an absolute path, a backslash, an empty segment, a dot folder, a link to a
folder outside, a link to a folder inside, a skipped folder (`node_modules`), its other case on macOS, a file named as
a folder, past the depth cap, and a Files that is a link; a link inside a listed folder is not listed, previewed,
downloaded or zipped; cross-site reads are refused; the board token is required. The zip is read back by Python's zipfile and
`unzip -t` (the repo's own reader, `engine/win32zip.js`, refuses the UTF-8 name flag by design) and must hold exactly
the listed files' bytes.
`web.filebrowser-6724.test.js`: each Finder button carries `data-remote-hide`, the CSS rule exists, the page sets
the attribute only when remote.

## Built, and how it was checked (2026-10-20)
- server.filebrowser-6724.test.js: 66 cases, every escape refused by browse and by the zip; the zip read back by
  Python's zipfile and `unzip -t`, byte for byte.
- Mutants (each applied, asserted to apply, then restored):
  - the folder gate's lstat link check removed: red (the "lstat walk ALONE" case, which stubs realpath to the walked
    path, the race it exists for); its resolved-path check removed: red (the case that stubs lstat to a real folder,
    plus the other-case folders on APFS);
  - the zip's open-handle identity check removed: red (a HARD link to a secret swapped in after the gate: a regular
    file inside Files, which O_NOFOLLOW and the path checks both pass);
  - the text preview's NUL check removed: red; the page's stamp kept on a failure: red.
- Not independently observable, decided: the zip's read-time gate (resolveListedFile) and the stale-folder guard in the
  page. Every leak the read-time gate stops, the handle identity check also stops (a different inode), and every
  stale answer the folder guard stops, the page's epoch also stops (each move starts a new paint). Both stay as second
  guards; a mutant of either alone stays green, and that is why.
- First mutant pass counted `^not ok`, which node's spec reporter never prints when piped: every "0 fails" from it was
  vacuous and was redone counting the `ℹ fail` line.
- Pins moved on purpose: the agent's preview and download depth (server.files-preview-4997, server.preview-sweep-5254),
  the Finder buttons' exact markup (web.win32-board-copy, web.win32-update-offer), the flat Files screen's "And N more
  ... Open in Finder" line, now the browser's own overflow line (web.agent-files-3614, web.win32-board-copy), and a
  text file opening the preview (web.files-preview-4997).

## Review
- Iteration 1 (opus): no escape found (traversal, links, hard-link swaps, case and Unicode, Windows names and streams,
  the walk-versus-read race), and the zip sends nothing it should not. Findings, all addressed:
  - WARNING, fixed: a name with a backslash (legal on macOS) was listed but refused by preview, download and the zip
    writer, and one such name sank the whole folder zip with an unnamed 413. The listing now applies the resolvers'
    name rules, so the list, the preview, the download and the zip agree. Tested; mutant red.
  - NIT, fixed: a Files that is a file (or unreadable) answered 404, which the page reads as "no folder of its own".
    It answers 409 with its reason now; 404 stays for no such agent. Tested; mutant red.
  - NIT, fixed: opendir follows a link, so a folder swapped for one between the gate and the read could list an
    outside folder's names. The folder's identity is read before and after the read, and a changed one is refused.
    Tested by swapping it inside opendir; mutant red.
  - NIT, decided and kept: a file that grows or changes during a folder download ends the connection partway. Rejected:
    sending the first bytes of a grown file, which makes a zip that looks whole and is not. The cost is that a person
    downloading a folder an agent is writing into sees the browser's own "failed" and tries again. Weakest premise: that
    folders are rarely downloaded while an agent is writing into them.
  - NIT, fixed: a client that stops reading held its response and an open file forever. The sender (now `zipPut`) ends
    a download that takes nothing for 120 s. Tested on the sender with a response that never drains (over loopback the
    kernel's buffers took a whole test-sized zip from a paused client, so an end-to-end test could not see the stall);
    the test has its own timeout, so the mutant shows as a timed-out (cancelled) test instead of a hang.
  - Also fixed in the test: its requests now use a fresh connection each (`agent: false`). Under load, a fixture that
    wrote 2001 files outlasted the board's 5 s keep-alive, and the next request on the pooled socket failed (status 0).
- Iteration 2 (sonnet): no escape found; the zip was also checked with `zipinfo -v` and `ditto -x -k` (Archive
  Utility's engine). Findings, all addressed:
  - WARNING, fixed: the Files screen rewrote the same failure into its status line every 5 s (a screen reader says
    it again), and could wipe a Download folder refusal just written there. The same failure is now left as it is.
  - NIT, fixed: a focus pending from a failed move could land later on another screen; it is cleared on a failure and
    when switching agents. The heading takes focus (`tabindex="-1"`) when nothing else is left to take it.
  - NIT, fixed: the screen followed a folder only when the glance list's own read succeeded; it now reads first and on
    its own. The cost, accepted: while the screen shows, a browse read every 5 s (one lstat per shown entry, at most
    1,000, on the board's thread).
  - NIT, fixed: the text preview's page side had no test; it is `pvTextInto` now, tested on a stub. The zip tests skip
    `unzip` where it is missing (Windows) instead of failing. The plan's line about win32zip was wrong and is corrected.
  - NIT, fixed: a name that is not UTF-8 on Linux reaches Node with U+FFFD and could be listed but not opened (the
    backslash class again); such names are left out. Cost: a real name containing U+FFFD is left out too.
  - NIT, fixed: the 1,000 cap counted hidden and skipped names, so they could crowd out the real ones. It counts shown
    entries now (with a 20,000-entry read budget), and the page quotes the server's limit.
  - NIT, decided: folder zips are capped at 2 streaming at once (a 429 with the reason past that), because each can read
    up to 1 GB twice. NOT added: a step-up for the zip. The single-file download needs none, and both read the same
    files with the same session; a step-up on reads is a separate decision for every download, not this card's.
    Weakest premise: that a stolen remote session reading a folder at a time is no worse than one reading file by file.
- Mutants for iteration 2's fixes, all red: the cap counting raw entries, U+FFFD names kept, no zip limit, no failure
  de-duplication, focus kept after a failed move.
- Iteration 3 (opus): no escape found. Findings, all addressed:
  - WARNING, fixed (measured by the reviewer): the page's ?check=1 look was counted against the very download it sits
    beside, so it could say "try again" while that zip downloaded. The look no longer reads the live count: it says
    busy only when that folder's own download was REFUSED as busy in the last 10 s (an accepted one clears the record),
    and waits 500 ms for the download to be decided when every place is taken and nothing is recorded yet. Weakest
    premise: that the page's download request reaches the board within 500 ms of its look.
  - NIT, fixed: the limit test passed even with no counting; it now holds a zip open (80 MB, past what a paused client's
    socket buffers take), sees a second refused, the running download's own look answer 204, and the place freed.
  - NIT, fixed: the zip walk had no read budget (hidden names count now, 100,000 names), and a real download past the
    limit is refused before any walk.
  - NIT, fixed: a list stopped by its read budget said "more than 1,000 items"; it says Kosmos stopped looking
    partway (`scanCut`), as the project list does.
- Mutants for iteration 3's fixes, all red: the counter never counting, the look reading the live count, no walk
  budget, scanCut not sent, the page ignoring it.
- Iteration 4 (sonnet): no escape found. Findings, all addressed:
  - WARNING, fixed: the mirror of iteration 3's. A refusal still on record made the look say busy after a place had
    freed (when the look arrived before the download that would take it). A record speaks now only while every place
    is still taken (`zipBusyNow`). Tested: refused, place freed, look answers 204 (the record would have said busy for
    10 s); mutant red.
  - NIT, fixed: the refusal map's keys come from the request, so it has a hard size of 100 as well as the 10 s sweep.
  - NIT, fixed: a text preview cut inside a UTF-8 character ended in a replacement mark; the partial bytes are dropped.
    Tested with a euro sign across the cut (CONTROL: a cut between characters keeps every byte); mutant red.
- Iteration 5 (opus): no escape found; the UTF-8 trim was checked at every cut point of 3- and 4-byte characters.
  One NIT, fixed: over Kosmos+ two hints stayed on screen under the conversation-folder buttons they describe. They
  carry data-remote-hide now, as each already carried data-linux-hide with its button. Tested (every Linux-hidden line
  right after a remote-hidden button is remote-hidden too); mutant red.
- Iteration 6 (sonnet): no escape on the server. Findings:
  - WARNING, fixed: a regression in the PAGE that this branch made. The new text branch of the preview took any text
    record whose `preview` began "/api/" as an address and fetched it with the viewer's session. An attachment's
    `preview` is the file's own first words (untrusted), so a text file beginning "/api/accounts" would have made the
    viewer's browser fetch that path and show the answer. The stage's choice is a pure function now (`pvStageKind`):
    a text file is read from the board only through an explicit `textUrl`, which only filesPvOpen sets and which must
    name a Files preview route; an attachment's words keep their old handling (a snippet, or the file card). Tested
    with the hostile attachment and a hostile textUrl; the mutant that takes the words as an address is red.
  - NIT, fixed: the path line's buttons were a small tap target on a phone; 44 px there, as the rows and Back are.
  - Checked by the reviewer: every route that opens a window on the board's computer has its button tagged or gated.
