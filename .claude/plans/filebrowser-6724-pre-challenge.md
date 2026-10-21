---
pre_challenge: true
method: challenge-loop
branch: filebrowser-6724
diff_hash: 93803b3c4085c70b229e7d6f24c3259ad58f7928e5d43551bf7df0628e18b92c
validation: passed on Mortals but for two unrelated #6668 arms (see Validation)
subdir_audit: passed (no subdirectory CLAUDE.md changed)
timestamp: 2026-10-20T22:43:01Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10, fresh blind reviewers alternating opus and sonnet. **Converged:** iteration 7 reported NO NEW FINDINGS on the product. Iterations 8 to 10 reviewed what came after it: three browser checks, the surface gate's trailers, and the suite's own audits. Every finding from them was fixed. **Fixed:** every finding of iterations 1 to 6 and 8 to 10, one fix commit per iteration. **Asked:** 0.

Decisions, accepted items, every mutant run and the iteration-by-iteration fixes are in .claude/plans/filebrowser-6724.md.

**Validation, measured:**
- **After the rebase (2026-10-20 16:3x):** the merge with main conflicted after main moved 50 commits. The only conflict
  was the server.js exports line, where #6721 added its slow-request names; both lines were kept. Re-checked on the
  rebased head 450c5eeb:
  - 14 focused files green, both browser-check gates rc 0.
  - Mortals full suite, twice: 22724 tests, 22402 passed, 2 failed, 320 skipped, the same 2 both times. They are
    #6668's watchdog arms in tools.run-tests-file-timeout-6668.test.js (untouched here), failing "node --test not
    started" under suite load. That file passes alone on Mortals at this head (16/16) and here on the branch and on
    origin/main a2e49f05 (16/16). The evidence is on kosmos#6668. Weakest premise: that nothing in this branch
    slows the runner start that arm waits for; its file and its runner are untouched.
- **Before the rebase:**
- **Mortals full suite** at 9ed5b655 (hash dbbbe47f): 22615 tests, 22297 passed, 0 failed, 318 skipped. Recorded clean.
- **The run before it**, at a952af30, had 27 reds:
  - 6 were this branch's, all fixed: web.api-routes-3957; the 2 #1732 audits (the read-flags line is now one shared constant, not a bumped count); the #1777 Windows test list (the route test is excluded with its reason); and 2 more cleared by the same fixes.
  - The other 21 were in 16 CLI and tool files this branch does not touch. Re-run alone, 14 files pass. The other 2 (cli.msgqueue-5187, cli.limitmsg-5805) are red on main as well whenever an agent runs them, because they inherit the runner's KOSMOS_AGENT_TOKEN; filed as kosmos#6740.
- **Browser checks** (render-agent-files-3614, render-files-preview-4997, render-remote-file-download-5165, render-nav-files-4961, run on Agent1s with the pinned runtime after the 0.7.61 cut): all rc 0, 308 PASS, no FAIL, no SKIPPED. The new arms passed: F5b on both engines and all four lists, R9 and L9 on both board platforms, and the Files screen's text-row and Cmd-click arms.
- **Gates:** the browser-check gate (#1720) and the surface gate (#2518) both rc 0. The surface gate's eight per-check trailers were each read against the check.
- **Merged with current main** (27 commits ahead, overlapping in web/index.html and tools/windows-tests.js, merging clean): on the actual merged tree, web.api-routes-3957, engine/windows-tests-1777, engine/windows-coupling-audit-1732, web.filebrowser-6724, web.agent-files-3614, web.files-preview-4997, fixture-discipline, server.filebrowser-6724 and web.win32-board-copy all pass, and both gates are rc 0. The branch is not rebased, so the validation above still describes its diff.
- **Mutants:** every fix was checked with one that turned a test red, then restored. The two layers that cannot be shown alone, and why, are in the plan.

### Per-Iteration Breakdown

The reviewers' own reports, copied from this session's Claude Code transcript (2026-10-20). Local paths are replaced and em dashes removed (house style). Nothing else is edited.

#### Iteration 1
**Reviewer model:** opus

I found no path that escapes the agent's Files folder, and no way for the zip to send bytes it should not. That covers traversal, links, hard-link swaps, case and Unicode spellings, Windows short names, trailing dots and `:` streams, and the walk-versus-read race. Every file is checked again at read time and read through one O_NOFOLLOW handle matched by inode, so a swapped file is refused. The file-name header strips CR/LF. The cross-site and board-token checks cover both new routes, and neither is on the agent-token route list. The page writes names, path segments and text previews as text, never as markup.

The 8 touched test files ran clean: 257 tests, 257 pass, `ℹ fail 0`. I made no edits.

1. [CHALLENGE] WARNING, engine/projects.js:2070 (`browsedEntry`), with server.js:4993. **Measured.** The browser lists names that nothing else will accept, and one such name sinks the whole folder zip. A file or folder with a backslash in its name is legal on macOS, so `a\b.txt` and folder `d\e` both appear in `listDir` and `walkListedDir`. Then:
   - `resolveListedFile` refuses the file ("that is not a file in x"), so its preview and download fail.
   - `resolveListedDir` refuses the folder, so clicking it fails.
   - `zipwrite.nameBytes` throws "bad entry name", so Download folder on that folder, or on all of Files, answers 413 "that folder cannot be put into one zip" because of one file, without naming it.
   
   Fix: give `browsedEntry` the same name check the resolvers use (no `\`, and no `:` on win32), so the list, the zip and the preview agree. Add one test.

2. [CHALLENGE] NIT, server.js:7817 with web/index.html:42430. **Measured on the engine side.** When Files is a file, or exists but cannot be read, `listDir` at the top answers `{ok:false, because:'this is a file, not a folder'}`, and the route sends it as a 404. The page reads any 404 at the top as "This agent has no folder of its own on this computer, so there is no Files list." That is the wrong sentence, and it is new: the flat route did not send 404 for this case. Fix: answer 409 (or 200 with `ok:false`) for a `listDir` refusal and keep 404 for an unknown agent, or have the page prefer `body.because`.

3. [CHALLENGE] NIT, engine/projects.js:2105. **Reasoned, not measured.** `listDir` checks the realpath of the folder, then calls `fs.opendirSync(got.real)`, which follows a link. A folder swapped for a link between those two steps would list an outside folder's names, sizes and dates; no file contents are exposed. Only a local process, in practice the agent that owns the folder, can make that swap, so it gives nothing new. Fix (optional): after opening, compare the opened folder's identity with the checked one, or `lstat` again after the read and drop the answer if it changed.

4. [CHALLENGE] NIT, server.js:5027. **Reasoned.** If any file in the folder is still being written (a log, a draft being saved), its size differs from the walk's. The connection is then cut partway through the zip, possibly hundreds of MB in. The person sees only the browser's own "network error" with no Kosmos sentence, and the `?check=1` look already passed. That is safe (never a wrong zip), but nothing explains the failure. Fix: decide it on purpose and write it down. Either send the first `e.size` bytes of a grown file (the CRC stays consistent), or put a line next to Download folder saying a folder that changes during the download stops it.

5. [CHALLENGE] NIT, server.js:5012 (`put`). **Reasoned.** `put` has no timeout. A client that stops reading keeps the response and one open file handle forever, because Node's response timeout is off by default. Several stalled remote downloads each hold one. Fix: give `put` a stall timer (for example 120 seconds with no drain, then `res.destroy()`).

#### Iteration 2
**Reviewer model:** sonnet

1. [CHALLENGE] WARNING, web/index.html:42369 and :42420-42430 (`paintAgentFilesAll`). A failed read is repainted on every 5-second tick, which a screen reader announces each time.
   - The failure path sets `AGENT_FILES_ALL_STAMP = null`, so there is no "same failure as last time" skip.
   - Each tick then runs `list.textContent = ''` and rewrites `msg.textContent` (a `role="status"` region), both on a refusal and on a network error.
   - The flat painter above it has a deduplication stamp (`'neterr'` and `'refused:...'`) with a comment saying why: a screen reader may re-announce each time.
   - The Files screen now polls the browse route on every tick, so it has lost that protection.
   - The same rewrite wipes the "folder too big" message that `kplusDownloadFolder` just put in `#d-filesall-msg`, up to 5 seconds later, whenever the browse is also failing.
   - Fix: keep a `lastFailure` string (status plus because). On an identical failure, return without touching the DOM, while still leaving `AGENT_FILES_ALL_STAMP` null. Add a test that two identical failures write once.

2. [CHALLENGE] NIT, web/index.html:42393, :42418-42421, :42795.
   - `AGENT_FILES_FOCUS` is set by a move and consumed only on a successful paint.
   - The error and catch paths return before consuming it, and `openDetail` does not reset it.
   - Scenario: click a folder, the read fails, and the person goes elsewhere. When a later tick succeeds, focus jumps to the first row, possibly on another agent's screen.
   - Fix: clear the flag in the failure branches and in the `openDetail` reset block.

3. [CHALLENGE] NIT, web/index.html:~13809 (`#d-filesall-h`) and the focus fallback at :42421.
   - The fallback chain ends at the `<h2>`, which has no `tabindex="-1"`, so `.focus()` does nothing.
   - Scenario: a keyboard user clicks the "Files" crumb to go back to a top level with no rows. The crumb button was just destroyed by `agentFilesPath`, nothing receives focus, and it falls to `<body>`.
   - Fix: add `tabindex="-1"` to the h2.

4. [CHALLENGE] NIT, web/index.html:25195 and :42312. The Files screen refreshes only if the flat `/files?limit=` fetch also succeeded.
   - `paintAgentFilesAll` is called from inside `paintAgentFiles`, after its fetch.
   - If that unrelated fetch throws (the catch returns early) or is superseded by a newer epoch, the browse view skips that tick.
   - The browse route now also runs a synchronous lstat per entry, up to 1000, on the board's event loop every 5 seconds.
   - Fix: let the poll site call `paintAgentFilesAll` itself when the screen is showing.

5. [CHALLENGE] NIT, test soundness.
   - The new `pvOpen` text branch (web/index.html:70208-70221) has no page-side test. That covers the `x-kosmos-preview-cut` note, the failure falling back to the file card, and the preview being closed before the response arrives. Only the server test sees the header.
   - `web.filebrowser-6724.test.js` last test checks wiring by source-string order (`indexOf`), not behaviour.
   - In `server.filebrowser-6724.test.js` (:253, :280), the zip tests skip when python3 is missing, which is fine. `readZip` also shells to `unzip` with no skip. Where `unzip` is absent (Windows), `unzipOk` is false and the test fails instead of skipping.
   - The plan says the zip is read back with `engine/win32zip.js`, but the test uses python and `unzip`.
   - Fix: add a pvOpen text-branch test against a stub DOM, and skip or fall back when `unzip` is missing.

6. [CHALLENGE] NIT, engine/projects.js:104 and :145-147 (`listDir`), reasoned and not measured because macOS refuses such names.
   - On Linux, a file name that is not valid UTF-8 is read by Node as U+FFFD, so the disk name and the listed name differ.
   - The list shows the file, its preview and download fail on lookup, and `writeZipEntries` hits `!gate.ok` and throws `changed()`. The whole folder download is cut off mid-stream.
   - This is the same class as the backslash fix in iteration 1, but the filter misses it.
   - Fix: in `browsedEntry`, drop any name containing `\uFFFD`.

7. [CHALLENGE] NIT, engine/projects.js:129-152.
   - The 1000-entry cap counts raw readdir entries, including hidden and skipped ones, in OS order.
   - A folder with many hidden files can show nothing real, and the later entries cannot be reached because there is no paging. The page's "more than 1,000 items" line hard-codes the number.
   - The cap itself is a recorded decision. Only the counting is the problem.
   - Fix: count only the entries that are shown, and have the server send the limit for the page to quote.

8. [CHALLENGE] NIT (a decision for Josh, not a bug), server.js:4961-5075.
   - Remote reads need no step-up, as the single-file download already does not.
   - `download-folder` now hands a stale or stolen remote session up to 1 GiB per request, read twice (CRC pass and send).
   - Concurrent requests are not capped.
   - Mitigation if wanted: a small in-flight limit on zips, and possibly adding `GET download-folder` to the step-up list.

**Checked and clean (no finding):**
- **Zip format:** I built a zip with the shipped `zipwrite` functions. It had a non-ASCII folder name, an empty file, mtimes of 1970 and 2096, and folder entries.
  - `unzip -t` passed.
  - `zipinfo -v` showed Unix attributes 040755 and 100644, the DOS folder bit (0x10) and the 1980 clamp.
  - `ditto -x -k` (the Archive Utility engine) extracted every entry with the right names, contents and mtimes.
  - `zipLength` equalled the actual length (508).
  - Parent folders always precede their children, and the entry counts cannot reach 65535.
- **Server side:** I found no escape in `resolveListedDir`, the listing, the walk, the read-time gates, `zipPut`, or the 200/204/413 handling.
- **Tests:** the two new test files give 77 pass, 0 fail, 0 cancelled, 0 skipped.
- **Page, seen in the source and not run in a browser:**
  - `[hidden]` is `!important` globally, so the empty path nav is hidden.
  - Switching agents resets the folder and stamp.
  - A late answer for a folder already left is dropped by `stale()`.
  - The page's text-extension list matches `attachments.kindOf`.

#### Iteration 3
**Reviewer model:** opus

1. [CHALLENGE] WARNING, server.js:455-459 (the in-flight check, which `?check=1` also runs) together with web/index.html `kplusDownloadFolder` (around line 20470). **The page can say a download was refused while that download is running.** The page starts the real download first and sends its `?check=1` look straight after. When that real request gets there first, it has already taken a slot, so the look is counted against the very download it is checking.
   - **Measured** with a scratch test against the worktree's own server (<local path>). One folder zip was held open by a paused client. Then, in the page's order, came the real navigate request and then the look. Result: `held 200 real 200 check 429 {"because":"another folder download is already under way on this computer; try again when it has finished"}`.
   - **How a person hits it:** they start one large folder download, then click Download folder on a second folder (or double-click). The second zip downloads, but the status line tells them to try again. If they do, the retry gets a real 429. A navigate refusal is a silent 204, so the retry does nothing visible.
   - **Which result you get depends on which request arrives first.** If the look arrives first it gets 204. So the message is unreliable both ways.
   - **Fix:** in check mode, only test the slot limit with a margin (for example `ZIPS_IN_FLIGHT > ZIP_MAX_IN_FLIGHT - 1` only when the look is not the person's own download). Simpler: on a 429 from the look, have the page say "If the download did not start, another folder download is under way...". Or record a navigate request refused as busy for a few seconds, and have the look report 429 only when that record exists.

2. [CHALLENGE] NIT, server.filebrowser-6724.test.js:471-482. **The limit test passes even if the counter never counts.** It uses limit 0, and limit 1 only with downloads that run one after another. No case keeps one zip open while asking for a second. A mutant that removes both `ZIPS_IN_FLIGHT += 1` and the `-= 1` on close leaves the counter at 0: limit 0 still answers 429 and limit 1 still answers 200. So the test is green while the cap does nothing.
   - This is reasoned from the code, not run as a mutant. The plan's "no zip limit" mutant removes the check itself, not the counting.
   - **Fix:** hold a zip open with a paused client and a body large enough not to fit in the socket buffers (my scratch test used 80 MB). Assert a second request gets 429 at limit 1. Then destroy the held one and assert the slot frees.

3. [CHALLENGE] NIT, engine/projects.js:186-229 (`walkListedDir`) and server.js:445-458. **The zip's folder walk has no read budget, and runs even when the request will be refused.**
   - Iteration 2 gave `listDir` a 20,000-entry read budget. The zip walk has none: hidden names, skipped names and entries that are not files are read without limit and count against nothing, all synchronously on the board's thread.
   - The walk also runs in full before the in-flight check. So every 429, every `?check=1` and every HEAD (HEAD is never counted against the limit) pays for a whole walk. Each page click costs two.
   - **Fix:** add the same budget to the walk, refusing with a reason past it. Test the in-flight limit before walking, for real downloads and looks alike.

4. [CHALLENGE] NIT, engine/projects.js:150 and web/index.html (the overflow line in `paintAgentFilesAll`). **The overflow sentence can be wrong.** When a listing stops because it hit the 20,000-entry read budget, the answer still carries `limit: 1000`. The page then says "This folder holds more than 1,000 items" for a folder of, say, 20,001 hidden names and 3 real files. Some real files may also be missing from the list.
   - **Fix:** return a separate reason (for example `scanCut: true`) and word it as "Kosmos stopped looking partway through this folder", as `PJ_DOCS_PARTIAL` already does for projects.

**Checked, no defect found:**
- **In-flight counter:** it cannot leak or go negative. The route handler has no `await` before `sendFolderZip`, so `close` cannot fire before its listener is attached. HEAD and `?check=1` return before the counter goes up. Every way a download ends (finished, cut, stalled) fires `close` exactly once.
- **Sender:** `zipPut` adds and removes its listeners correctly, with no pile-up.
- **Page reads:** the order of the two reads, the epoch and stale guards across folder moves and agent switches, the cleared pending focus, and the failure de-duplication with recovery all behave correctly.
- **Text preview:** the page and server agree on which files are text. It is served as text/plain with nosniff and the sandbox CSP, and drawn with textContent.
- **U+FFFD names:** filtered for both listing and the walk.
- **Remote:** the browse and download-folder GETs are not step-up gated, so the feature works over Kosmos+.

The eight test files the diff touches: 268 tests, `ℹ fail 0`, `ℹ cancelled 0`.

#### Iteration 4
**Reviewer model:** sonnet

1. [CHALLENGE] WARNING, server.js:5005 (`answer`) and server.js:5002 (`zipBusyRecent`). A refusal record can outlive the busy state, so the look can say "busy" about a download that is running. This is the mirror image of the iteration 3 bug. I read this from the code and did not run it.
   - Scenario:
     1. Both places are taken, and the person clicks Download folder on folder A. The download is refused with a 429 and `zipBusyRefusedAt[A]` is set.
     2. A place frees within 10 s, and the person clicks again.
     3. The page sends the anchor download and the `?check=1` fetch at nearly the same moment, in no guaranteed order.
     4. If the look arrives first, `zipBusyRecent(A)` is still true, so `answer()` sends 429 even though `ZIPS_IN_FLIGHT < MAX`.
     5. The download then starts and deletes the record, but the status line already shows "another folder download is already under way... try again" while the zip downloads.
   - If the look arrives second, the accepted download has already cleared the record and the look is correct. So the result depends on arrival order.
   - Fix: make the look say busy only when the record is recent and the places are still full. In `answer` and in the guard before `setTimeout`, test `zipBusyRecent(key) && ZIPS_IN_FLIGHT >= ZIP_MAX_IN_FLIGHT`. A free place then always gives 204, and a record only breaks the tie when places are full. Add a test that records a refusal, frees a place, then looks.

2. [CHALLENGE] NIT, server.js:4999-5001. The key is built from the raw `?dir=` string before the walk validates it, so a refused download of a nonexistent or invalid folder is also recorded. Growth is bounded by the 10 s sweep (run on each refusal insert) plus the 429 refusals made before any walk, and by the header size limit. Any realistic effect is a few KB. Fix, optional: record only after the shape gate passes, or cap the map at about 100 entries.

3. [CHALLENGE] NIT, engine/filepreview.js `readHead`. The 256 KiB cut can split a multibyte UTF-8 character. `res.text()` then ends with U+FFFD under the "The start of the file" note. This is cosmetic. Fix, optional: trim a trailing incomplete sequence when `cut` is true.

Items I checked and found sound:
- The 500 ms wait holds only a timer and a response. If the person navigates away it ends harmlessly, because `writeHead` and `end` on a closed response do nothing.
- The `ZIPS_IN_FLIGHT` count is balanced by the single `res.once('close')`.
- The walk's 100,000-name budget refuses cleanly with a 413.
- `scanCut` is correctly separate from `limit`.
- Swapping a folder for a link between the walk's lstat and its `opendirSync` can only add names to the walk. The read-time gate then refuses those files and the download ends before any outside bytes are sent.

#### Iteration 5
**Reviewer model:** opus

1. [CHALLENGE] NIT, web/index.html:17366 and web/index.html:17608. Over Kosmos+, the remote rule hides two buttons but leaves the hint line under each one on screen:
   - `#tk-chats-reveal` is hidden, but "One folder, with a file for each task's conversation." still shows.
   - `#pjs-chats-reveal` is hidden, but "One folder for every project, with a file for each conversation." still shows.

   Each hint only describes where its button goes. A remote viewer sees a stray sentence under nothing. The Linux rule already hides each pair together: the button and its hint both carry `data-linux-hide`. The new `data-remote-hide` was put on the buttons only.

   Fix: add `data-remote-hide` to those two `<p class="fhint">` lines. In web.filebrowser-6724.test.js, also check that any hint carrying `data-linux-hide` next to a `data-remote-hide` button carries `data-remote-hide` too.

That is the only new finding. Iteration 4's changes hold up, and so does everything else I checked:

- **The UTF-8 trim:** I ran a copy of `readHead`'s trim (the same code) on every cut point.
  - A 4-byte emoji cut after 1, 2 or 3 of its bytes drops all of them.
  - A cut landing exactly after a whole 4-byte or 3-byte character keeps every byte. The loop stops at `end-4`, so the lead byte is found.
  - A file of only continuation bytes is left alone, because they read as length 1.
  - A cut inside the first 3 bytes of a file cannot go below index 0.
- **`zipBusyNow` and the 100-key map bound:** both are correct. The busy check before the walk and the count going up happen with no await between them, so two requests cannot both pass the check.
- **The zip writer:** `zipLength` matches the bytes actually written. Entry names cannot carry `..`, a leading `/` or a backslash. The caps (4,000 entries, 1 GiB) stay well under the zip format's limits.
- **Depth:** the folder limit (`segs.length > 8`) and the file limit (`segs.length - 1 > 8`) agree. So every file the browser shows at depth 8 can be previewed and put in the zip, and a zip of such a tree does not end partway.
- **Text preview:** the page's list of text extensions is exactly the server's `kindOf` list. The page draws the text with `textContent`.
- **Remote:** the in-preview reveal turns into Download over Kosmos+.

Tests: I ran all 8 related test files in the worktree (cwd set): 272 tests, `ℹ fail 0`, `ℹ cancelled 0`, exit 0. I did not edit, commit, push or post anything.

#### Iteration 6
**Reviewer model:** sonnet

1. [CHALLENGE] WARNING, web/index.html:70226-70228 (new branch in `pvOpen`; the attachment path that feeds it is `pjAttachmentCard`, line 70174). This is a regression, and the cause is that file content now gets used as a URL. I found it by reading the code and did not run it.
   - `pjAttachmentCard` stores `preview: a.preview` unfiltered in `PV_ATTS`. For a conversation attachment of kind text, the server sends the file's first characters as `preview`, which the code comments call "UNTRUSTED TEXT".
   - Before this diff, any text whose first characters were `/api/` fell to the file card. The old text branch deliberately excluded `/api/`-prefixed strings.
   - The new first branch is `a.kind === 'text' && /^\/api\//.test(a.preview)`. It treats such content as a URL and calls `pvTextInto`, which runs `fetch(url, { cache: 'no-store' })` with the viewer's session. It then renders the response in the preview overlay.
   - Scenario: an agent or a chat participant sends a text file whose content begins `/api/accounts` or `/api/<anything GET-able>`. When the viewer clicks the card, the viewer's browser makes a same-origin GET to a path the file's author chose, and the response is shown in place of the file. Any GET route with a side effect can be triggered this way. The file's real text is also never shown.
   - Fix: do not infer "this is a URL" from the content. In `filesPvOpen`, set an explicit field on the record, for example `previewUrl: base.preview + q`, and have the new branch test `a.previewUrl`. Leave `a.preview` as snippet text only. Add a test that a conversation text attachment whose body is `/api/x` shows the file card, or its own text, and fetches nothing.

2. [CHALLENGE] NIT, web/index.html:8286-8288 (`.dfiles-path button`). The path-line buttons have `padding: 2px 4px` and a small font, which gives a tap target of about 22px high on a phone. The phone block raises the folder and file rows (`.pj-doc`) and `#d-files-back` to 44px, but not these buttons. They are the only way back up a folder, and with a nested path they sit close together. Fix: in the phone media block, give `#d-filesall-path button` `min-height: 44px` and some horizontal padding, or at least 32px.

Checked and clean:
- **Untagged host-window routes:** every route that calls `revealFolder`, `revealFile`, `openFile` or the system-settings open has its button covered, one way or another.
  - Tagged `data-remote-hide`: `#d-files-finder`, `#docs-finder`, `#pjs-reveal`, `#pjs-chats-reveal` (button and hint), `#tk-chats-reveal` (button and hint), `#set-reveal` and `#upd-open-folder`.
  - The preview's Finder action is gated by `pvOffersDownload`.
  - The file-row clicks, `docs-list`, `pj-docs` and the room chips are all gated by `kplusRemote()`.
  - `open-sleep-settings` and `open-accessibility-settings` open System Settings, not a folder. They stay visible and say "elsewhere" when clicked, which is the existing #5165 behaviour. This is outside the card's wording.
- **Glance list:** it is still flat (`maxDepth: 0`). Its names carry no path, so the browse-only `label` logic does not touch it.
- **Server:**
  - Depth semantics agree between `resolveListedDir`, `browsedEntry` and `resolveListedFile` (8 folders deep, files in the eighth).
  - The zip headers and length arithmetic look sound.
  - The in-flight counter is attached synchronously after `writeHead`, so no early-close race.
  - No em dashes in the added lines.

#### Iteration 7
**Reviewer model:** opus

NO NEW FINDINGS

I found nothing new in the diff, and none of the recorded or fixed items needs reopening. The focused suites pass: 274 tests across eight files, with `ℹ fail 0` and `ℹ cancelled 0`.

**Where untrusted data reaches an address, attribute, header or path, and why each place holds:**
- **`dataset.dir`:** it is the server's own listed name and is only put into the page with `textContent`. It goes back to the server through `encodeURIComponent`, and `resolveListedDir` checks it again there. A trailing slash, an empty segment, `..`, a backslash or an absolute path is refused.
- **Path line:** each crumb's label is set with `textContent`, and its `dataset.dir` is built by joining the segments of `AGENT_FILES_DIR` back together. No markup is involved.
- **Folder rows:** the only `insertAdjacentHTML` is the fixed folder icon. The name and the `aria-label` are written as plain text.
- **Download anchor:** both the owner and `dir` are `encodeURIComponent`'d in `href`. The `download` attribute is only the folder's last name plus `.zip`, which the browser sanitizes itself.
- **Zip:**
  - `content-disposition` goes through `attachmentDisposition`. Control characters (a newline is legal in a macOS name), quotes and backslashes become `_` in `filename=`, and `filename*` is percent-encoded, so a header cannot be injected.
  - Entry names are refused if they are empty, start with `/`, or contain a backslash, a NUL, `.` or `..`, so a zip-slip name cannot be built.
  - Every folder and file is gated again before its header is written, so a subfolder swapped for a link after the walk never puts an outside name into the zip.
- **Preview record:** the attachment records built at `web/index.html:70175` copy a fixed set of fields that does not include `textUrl`. So the only record that can carry a `textUrl` is `filesPvOpen`'s, and `pvStageKind` also requires it to start `/api/...` and name a Files preview route. Text is shown with `textContent`.
- **Text preview on the server:** the response is always `text/plain` with nosniff and the sandbox CSP, behind `crossSiteRead`. The browse answer does not send the folder's absolute path.

**Correctness checks:**
- The depth rules agree between `browsedEntry`, `resolveListedDir` and `resolveListedFile` (a file inside a folder 8 levels down is reachable; a 9th folder is not).
- `zipLength` matches the bytes actually written.
- The in-flight count goes up once and down on `close`.
- On the page, the staleness guard (epoch, agent and dir), the reset of the stamp and failure record on every move, and the reset when switching agents are correct.

**Considered and not raised:**
- `?check=1` and HEAD on download-folder walk the folder without counting against the in-flight limit. It is a bounded synchronous walk (100,000 names), only for an authenticated session, and iteration 3 left it that way on purpose.
- `walkListedDir` does not have the before/after folder identity check that `listDir` has. The only effect of a race is that `content-length` reflects an outside folder's sizes. Nothing from that folder is ever written, and only the agent could make the swap, and it can read those files anyway.

#### Iteration 8
**Reviewer model:** sonnet

1. [CHALLENGE] BLOCKER, `docs/browser-checks/render-agent-files-3614.js:300`. This browser check was not touched by the diff, and the product change breaks it.
   - The arm runs `page3.click('#d-filesall-list .pj-doc[data-doc="rex-13.txt"]')` and asserts `opened.length === before + 1` (opener reached, label "#3757: a row on the Files screen opens that file").
   - `rex-13.txt` is now a text row. In `web/index.html:42474`, `filesPvOpen` runs first on a plain click and matches `txt` (`web/index.html:70363`). It opens the preview and returns before `/files/open` is ever POSTed, so `opened` stays unchanged and the arm fails.
   - The same file's PDF arms already use a modifier click for the opener (`:194`). `tools/bc-pr-select.js` and the `Browser-check-surface` header (`d-filesall-list` is listed) will select this check on a cut.
   - Fix: click that row with `{ modifiers: ['Meta'] }`, as line 194 does. The preview skips modifier clicks (`filesPvOpen` returns false when `metaKey` is set). Alternatively, make the fixture a `.docx`. Also add a plain-click arm asserting the preview opens, so the new behaviour is covered there too.

2. [CHALLENGE] NIT, `docs/browser-checks/render-remote-file-download-5165.js:207`. The new R3 arm cannot fail for two of its seven buttons.
   - `#set-reveal` and `#upd-open-folder` carry the `hidden` attribute, so `display` is `none` whether or not the `data-remote-hide` rule exists.
   - The other five (`docs-finder`, `pjs-reveal`, `d-files-finder`, `pjs-chats-reveal`, `tk-chats-reveal`) are not `hidden`, so for them the arm is discriminating. A hidden ancestor does not matter, because the check reads each button's own computed `display`.
   - Fix: for those two, clear `hidden` first (`b.hidden = false`) and then read `display`, or assert it only on the five that discriminate.

3. [CHALLENGE] NIT, `render-remote-file-download-5165.js:207`. The label "R3" duplicates the existing R3 arm ("a file the board refuses ... is said under it") in the same `runRemote`. Two arms with one id make a red line ambiguous. Rename it, for example `R4`.

4. [CHALLENGE] NIT, `render-remote-file-download-5165.js:251`. L3 is labelled "the remote rule hides nothing" but only asserts that `data-kplus-remote` is absent.
   - L0 already proves `kplusRemote()` is false, and the L1 clicks use `b.click()`, which works on `display:none`.
   - A regression that hid the buttons at the computer by another route would still pass L3.
   - Fix: also assert the five non-`hidden` folder buttons are not `display:none` at the computer, which makes it the true mirror of R3.

Checked and fine:
- **4997 F5b:** it cannot pass for the wrong reason. The "Reading…" placeholder in `pvTextInto` uses the same U+2026 character the arm waits out. A failed fetch swaps in the file card, so `text` is null and the arm times out red. The asserted `'hello'` is the fixture's exact bytes, with no cut note involved.
- **4997 `.docx` swap:** no row counts or other `notes.txt` uses depend on the fixture.
- **Other checks:** the other checks that touch the moved buttons use `127.0.0.1` or `file://`, where the stamp is never set (`kplusRemote()` is false when the hostname is empty). `render-agent-files-3614`, `render-task-taps-5200` and `render-tasks` all use a real local board, so the `/files/browse` route move reaches them without a mock. I found no check that mocks `/files?limit=500` or asserts the old "And N more" line.
- **Rest of the diff:** nothing new beyond the above. I ran no tests or browser checks, as instructed.

#### Iteration 9
**Reviewer model:** opus

I found two new problems, both in the browser checks and the CI test gate, not in the product. Per your instructions I did not run any browser check, so the first finding comes from reading the code, not from a run. For the second I ran the repo's read-only surface gate against the branch, and it returned rc=1.

1. [CHALLENGE] BLOCKER, docs/browser-checks/render-files-preview-4997.js:112 and :165 (cause: web/index.html, `paintAgentFilesAll`). The `d-filesall-list` arms can fail even though the product is fine.
   - **Cause:** this branch added a stamp short-cut to `paintAgentFilesAll`: `if (ok && body.stamp && body.stamp === AGENT_FILES_ALL_STAMP) return;`. The browse stamp (engine/projects.js:2144) is a hash of names, sizes and mtimes, and nothing in this check changes those files.
   - **What happens:** `open()` and the F4 redraw both empty `#d-filesall-list` by hand, then call `paintAgentFilesAll('ava')` without clearing `AGENT_FILES_ALL_STAMP`. The `d-files-list` branch right beside them does clear its own stamp (`AGENT_FILES_STAMP = null`).
   - **Scenario:**
     - The first `photo.png` open on `d-filesall-list` paints, because the stamp starts null.
     - F4's redraw sees the same stamp and returns, so the list stays empty. The 5 s poll does the same, since it reaches `paintAgentFilesAll` and hits the same stamp. No `photo.png` row comes back, so focus cannot return to it, and F4 fails.
     - Each later `ownRow` (report.pdf, notes.txt, plan.docx) waits 3 s, falls back to a hand-drawn row, and fails "drawn by this list's own painter". That is 4 failures per engine, so 8 across Chromium and WebKit.
     - F2, F5b and F5 then pass on the hand-drawn rows, which means the new F5b arm is not testing the painter's own text row on this list.
   - **Fix:** put `AGENT_FILES_ALL_STAMP = null;` before both `await paintAgentFilesAll('ava')` calls, the same way the `d-files-list` branch handles its stamp.

2. [CHALLENGE] BLOCKER, branch-wide (the gate is tools/lib/browser-check-surface-gate.sh, run from tools/run-tests.sh:648). The full suite will go red on the pull request.
   - **What I ran:** `kosmos_browser_check_surface_gate` on the branch as it stands. It returned rc=1 and listed 8 checks whose surface tokens appear on changed lines of web/index.html, with neither the check updated nor a per-check trailer:
     - render-unread-edge-3743 (`msg`)
     - render-docs-subfolders-2245 (`pj-doc`)
     - render-win32-board-copy (`data-win-copy`)
     - render-docs-seg-4937 (`docs-finder`)
     - render-task-taps-5200 (`tk-chats-reveal`)
     - render-agentdm-3414 (`msg`)
     - render-phone-taps-5218 (`pj-doc`)
     - render-subview-cleanup-3502 (`docs-finder`)
   - **CI:** test.yml runs tools/run-tests.sh on every pull request, so this blocks the PR.
   - **Semantic sweep:** I read each of these 8 checks for what this change alters, and none of their assertions breaks:
     - docs-seg-4937, subview-cleanup-3502 and task-taps-5200 click or measure their buttons at 127.0.0.1, where nothing is stamped as remote.
     - win32-board-copy loads the page from file://, so it never counts as remote, and its `#tk-chats-reveal + p.fhint` selectors still match.
     - docs-subfolders-2245 and phone-taps-5218 only read or measure `.pj-doc` rows and never click one.
     - The two `msg` checks match an unrelated token.
   - **Fix:** add one `Browser-check-surface: <check-basename> <reason>` trailer per check, then run the gate again until it returns rc=0.

The rest of the sweep found nothing:
- **render-agent-files-3614:** the new plain-click text arm cannot pass without the real preview fetch returning "r", and the Cmd-click arm is guarded by `filesPvOpen`'s modifier check.
- **render-remote-file-download-5165, R9 and L9:** a missing button counts as a failure in both, and the only CSS that hides `#d-files-finder` otherwise is in the phone layout, which a 1280 px viewport never reaches.
- **Other checks:** no check outside the three edited ones clicks a text file in a Files list expecting the opener or a download, and none opens the Files screen except mobile-shots, which only waits for a `.pj-doc` row and still gets one. render-thread's `/files` 404 exemption never meets the browse route, because the Files screen is never opened there. The checks served from a remote address (render-file-preview-4930, render-settings-fit-5510, render-phone-pass-5510, render-plus-bar-3837, render-phone-offline-718) do not assert any of the seven folder buttons or the two hints.

#### Iteration 10
**Reviewer model:** sonnet

1. [CHALLENGE] BLOCKER, `<local path>` (new `pvTextInto`, `return fetch(url, { cache: 'no-store' })`) and `<local path>` and `:474`.
   - **Failure:** the branch makes the suite red. I ran the 412 `web.*`, `browser-checks*`, `fixture-discipline`, `no-brand`, `server.familywords`, `server.preview*`, `server.files*`, `server.filebrowser*`, `tools.filepanel*` and `tools.jspanels*` test files. The result was 3425 tests, 3424 pass, `ℹ fail 1`, `ℹ cancelled 0`.
   - **The failing test:** `#3957: every /api path the page fetches is served by a board route`. It asserts: "fetches whose URL is not a literal grew to 22 (ceiling 21)".
   - **Cause:** `pvTextInto(stage, url, fileCard)` fetches a variable URL, which is the 22nd non-literal fetch. The branch does not touch `web.api-routes-3957.test.js` and does not mention #3957 or `UNREAD_CEILING` in the plan.
   - **Side effect:** the extractor cannot verify the preview route that `pvTextInto` is passed, so the route-served check does not cover it.
   - **Not checked:** I did not run this test against `origin/main`. I inferred main's count is 21 from the ceiling, and the +1 comes from this diff.
   - **Fix (either):**
     - Raise `UNREAD_CEILING` to 22 and append a reason in the existing style: "+1 (#6724): pvTextInto fetches the url its caller passes; the callers pass the agent and project file-preview routes".
     - Or make the URL a literal inside `pvTextInto`, which is better because the route then gets checked. Pass the pieces in, for example `fetch('/api/agent/' + encodeURIComponent(o) + '/files/preview?name=' + ...)`.
   - **Why it slipped through:** the gates the branch ran (browser-check and surface) do not run this unit test, and it is not one of the files the plan records as run.

2. [CHALLENGE] NIT, trailer text in the `render-docs-seg-4937.js` commit trailer.
   - **Wrong detail:** the trailer says "clicks docs-finder at 127.0.0.1". That check loads `file://` (`render-docs-seg-4937.js:24`, "HERMETIC (file://, fetch stubbed...)").
   - **Conclusion still holds:** `kplusRemote()` (`web/index.html:20426`) returns false for an empty hostname, so `data-remote-hide` hides nothing there.
   - **Fix:** say "at file:// (no hostname, not remote)". This is optional; the trailer is true in effect but wrong in its stated mechanism.

Items 1-4 of your brief that came back clean:
- **Stamp fix:** `AGENT_FILES_ALL_STAMP = null` in `render-files-preview-4997.js` is correct. The variable exists (`web/index.html:42344`, and `:42432` is the early return it defeats). It is cleared at both repaint sites.
- **Same stale-stamp class elsewhere:** none. `render-agent-files-3614.js` opens the Files screen on a fresh page per theme and width, and its `#d-filesall-list` clicks follow a first paint. `mobile-shots.js` and `render-thread.js` are not gated checks.
- **Trailers:** I read the seven checks other than `render-win32-board-copy.js` and found each reason true or effectively true. They touch only `.msg`, `.msg-bd` or `.pj-doc` rows they never click, or `#docs-finder` and `#tk-chats-reveal` on `127.0.0.1` or `file://`, where nothing is remote-hidden. In `render-win32-board-copy.js` the `#tk-chats-reveal + p.fhint` selector still matches, because the `<p>` still directly follows the button in the diff.
- **Other checks using the newly remote-hidden ids:** `render-pjsettings.js`, `render-tasks.js` and `render-agent-files-3614.js` go to `127.0.0.1`. `render-update-win32-manual.js` uses a `URL` constant I did not trace, and `render-remote-file-download-5165.js` sets its own origin on purpose.
- **Repo gates:** the browser-check gate and the surface gate both printed `rc=0`, with all eight overrides listed and none rejected.

