---
pre_challenge: true
method: challenge-loop
branch: fingerprints-6761
diff_hash: 4ea385ffe60e97e47c045106829a8f6c1ba8f6ba88236881d05443bb32055c7b
validation: passed on Mortals but for two unrelated #6668 arms (see Validation)
subdir_audit: passed (no subdirectory CLAUDE.md changed)
timestamp: 2026-10-21T02:22:09Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10, fresh blind reviewers alternating opus and sonnet. **Converged:** iteration 10 reported NO NEW FINDINGS.

Decisions, accepted items, every mutant run and the iteration-by-iteration fixes are in .claude/plans/fingerprints-6761.md.

**Validation, measured:**
- **Mortals full suite on the PR head 4b84219e** (rebased onto main c3efddca; hash 4ea385ff, matching the diff_hash
  above): 22773 tests, 22451 passed, 2 failed, 320 skipped. The 2 are #6668's watchdog arms in
  tools.run-tests-file-timeout-6668.test.js (untouched here), failing under suite load as on every branch tonight; that
  file passes alone (evidence on kosmos#6668), and #6768 fixes it. Weakest premise: that nothing here slows the runner
  start those arms wait for; their file and runner are untouched.
- **Earlier full runs**, all recorded in the plan: e2a0562d (7 reds, 5 of them this branch's, all fixed); fc716aaa and
  245ba52f (only the same 2 #6668 reds).
- **Focused and page sets on 4b84219e:** 410 test files, 3438 tests, 0 failed (every web.* file, the fingerprint and
  task-list files, the #1732 and #5548 audits, fixture-discipline, the Files servers, install tests); `bash -n
  install/kosmos` ok.
- **Browser checks on 4b84219e** (Agent1s, pinned runtime, through queued-heavy): render-phone-taps-5218,
  render-agent-files-3614, render-files-preview-4997, render-remote-file-download-5165, render-nav-files-4961,
  render-docs-seg-4937, render-docs-subfolders-2245, render-subprojects-1994, all rc 0, 393 PASS, 0 SKIPPED. Not run, as
  they read only the project view state and no Files rows: mobile-shots, render-consolidated-newagent-3053,
  render-consolidated-settings-2842, render-pjsettings, render-subback-4586.
- **Mutants:** every fix was checked with one that turned its test red, then restored from a scratch copy (counted by
  `ℹ fail`, not `not ok`).

### Per-Iteration Breakdown

The reviewers' own reports, copied from this session's Claude Code transcript (2026-10-20). Local paths are replaced and em dashes removed (house style). Nothing else is edited.

#### Iteration 1
**Reviewer model:** opus

Two warnings and three nits. Nothing is a blocker.

All four new test files pass with KOSMOS_* stripped from the environment: 7/7, 5/5, 4/4 and 4/4, with 0 fail and 0 cancelled. The diff has no em dashes in any of the five spellings. What came through clean on the security side:
- The page validates the fingerprint as exactly 64 lowercase hex before showing it, and writes it only through textContent or the title, so no fingerprint or name can reach markup.
- The cache key binds the file's identity (device, inode, size and both times), and the stat before and after the read must match. A file swapped for a link, or for another file, is never fingerprinted as the listed one.
- Webhook words in the compact list are quoted with the same rules as the long list.

1. [CHALLENGE] WARNING, `engine/filehash.js:58-76` (hashOne) together with `forRow`. **A file that keeps growing is re-read in full on every poll and never cached.** Each poll gives a changed file a new key and queues it again. The hash then reads the whole file, finds the stat changed by the end, and throws the result away.
   - Measured with a scratch script: a 200 MB file, appended every 200 ms and polled every second, cost 1800 MB of reads in 10 s and ended uncached.
   - At the real 5 s poll, that is about 200 MB of disk read every 5 s for each such file, for as long as a Files or Documents list shows it. Up to 512 MB per pass is allowed.
   - Likely triggers are a growing log, a recording, or an export being written into a project folder.
   - Fix: hash only files that have settled (for example, mtime at least a few seconds old). Or keep a per-path back-off after a "changed while read" result, so that path is not tried again for N seconds or until it stops changing.

2. [CHALLENGE] WARNING, `web/index.html:69352-69364` (openDocsView). **The Documents view mostly shows no fingerprints.** The view fetches `/documents?limit=500` once, when it opens, and never polls. The repaint-on-stamp mechanism the branch relies on (`server.fingerprints-6761.test.js`: "the stamp moves when it arrives, so the page repaints") does not reach this view. Only the rail (`pjLoadDocs`) compares stamps, and it asks for 10 rows, not 500.
   - Scenario: open a project's Documents view after the board starts, or after any file changes. Every row not yet hashed shows only size and date, and stays that way until the person closes and reopens the view.
   - That means the newest revision, the one the card is about, is the row most likely to lack its fingerprint. The web test checks `pjDocMeta` in isolation, so it cannot see this.
   - Fix: re-fetch while any shown row has no `sha256` (a short bounded retry, or poll by stamp the way the rail does) and repaint `PJ_DOCS_FILES` in place.

3. [CHALLENGE] NIT, `engine/projects.js:2149` with `engine/filehash.js:19-21`. **Nothing caps the total bytes hashed.** One browse of a folder queues up to 1000 files of up to 512 MB each. After the queue drains they are cached, but 5000 entries are dropped in insertion order: `known()` never moves an entry to the back, so it is not LRU. Several large folders browsed or polled in turn can push entries out and cause re-reads. Fix: a byte budget per interval, and refresh an entry's place on a `known` hit.

4. [CHALLENGE] NIT, `engine/filehash-6761.test.js` ("a link is not followed"). **The test cannot fail if O_NOFOLLOW is removed.** The swapped-in link points at a file with a different inode, so the key check discards the result either way. Its second assertion, `known(p, statSync(p)) !== sha('secret')`, can never fail, because `known` never reads a file. Fix: make the link target carry the listed stat's identity (for example, a hard link to the original inode reached through a symlink), or assert on the ELOOP open error.

5. [CHALLENGE] NIT, `engine/tasklist.js:62-75` versus `tools/windows/kosmos-cli.js` taskList. **The two CLIs differ in two error paths**, which goes against the "byte for byte" claim:
   - **Older-board refusal:** the Mac CLI prints it to stdout (node writes everything there); the Windows CLI prints it to stderr (`shown.rc ? ctx.err : ctx.out`).
   - **Body that is not JSON:** the Mac CLI prints "Kosmos could not print that list compactly; list it without the flag to see it whole." The Windows CLI prints "Kosmos sent no task list, so there is nothing to show."
   - Fix: have the bash path send rc 1 lines to stderr, and use one sentence for both. Also, `list p --open ""` is accepted by bash (`[ -z "$3" ]`) and refused by Windows (`args.length > 2`). That one is trivial.

There are also two observations I am not counting as findings:
- The board always sends `count: rows.length` (`server.js:19906`), so the "The board counted N but sent M" line cannot fire on today's board. It is harmless as a defence for later boards.
- The page labels the value "sha256 abcdef123456" while the CLI says "Fingerprint sent". "fingerprint" would be the plainer word for the person.

#### Iteration 2
**Reviewer model:** sonnet

1. [CHALLENGE] WARNING, engine/filehash.js:48 (`want`): a file whose modification time is in the future is never fingerprinted, and its row shows no fingerprint until that date.
   - The settle test is `now - Math.max(st.mtimeMs, st.ctimeMs) < SETTLE_MS`. A future mtime makes the difference negative, so it is always under the limit.
   - Files with a future mtime are common. Examples are tar/unzip or `cp -p` from a machine with a fast clock, `touch -d`, and an agent that sets a mtime.
   - Measured: I set mtime to 2030, ran `forRow`, and waited. It came back null, the queue was idle, and nothing was queued.
   - The Documents fill then runs all 15 tries (about 30 s of full list re-reads) for nothing.
   - Fix: settle on `ctimeMs` alone. The kernel sets ctime and a user cannot, and any write moves it. Optionally also treat a future mtime as unsettled only when ctime is recent.
   - Add a test with mtime set to the future and ctime older than 5 s (or SETTLE set to 0 and a future mtime) that must get hashed.

2. [CHALLENGE] NIT, web/index.html:69262 (`docsFingerprintFill` calling `pjDocsPaintPage`): every fill that adds a fingerprint rebuilds the whole page of rows with `box.textContent=''`.
   - This can happen up to 15 times in 30 s.
   - A row the user has keyboard focus on, or a hover title they are reading, is destroyed and recreated. Focus drops to the body.
   - Fix: patch the fingerprint into the existing `.pj-doc-w` text and `title` of the rows already shown (match by `dataset.doc`), or save and restore the focused row's `dataset.doc` around the repaint.

3. [CHALLENGE] NIT, install/kosmos:5356-5360 against engine/tasklist.js and tools/windows/kosmos-cli.js:918-921: the two CLIs now print a refusal on different streams.
   - On the Mac, the module's refusals (an old board, no task list) go to stderr.
   - The Mac's own shell-side refusals (`say` for "could not find its own runtime" and "no compact task list yet") go to stdout, because `say` is a stdout printf.
   - The Windows CLI sends all of these through `ctx.err`.
   - I found no existing caller or test that reads the old stdout. These are new flags and the changed Mac paths are covered by passing tests.
   - A caller that does `2>/dev/null` will see the Mac's two shell-side failures and miss the module's.
   - Fix: send those two Mac lines to stderr (`say ... >&2`) so a failure always lands on the same stream.

Checked, and nothing to report:
- **`$# -le 2` under `set -u`:** it is sound. `$#` is always set, and `$1` is the project at that point, so the check means flag plus nothing else. `list proj --open ""` is correctly refused.
- **Back-off:** it holds across polls, and a stale queued key is simply asked for again. The back-off map is bounded.
- **Restart:** the cache is lost and everything rehashes in the background, in order.
- **Least-recently-shown cache:** `known` re-inserts the entry, so eviction order is right.
- **Documents fill:** a project switch or a new open is caught by the `PJ_CURRENT`, `PJ_VIEW` and `DOCS_OPEN_GEN` checks on both sides of the fetch, and the timer does not reschedule after that. Matching by name, size and date never attaches a newer file's hash. Pagination is kept, because the page index is untouched.
- **Tests:** all nine files I ran pass with 0 failures and 0 cancelled. They are the five new test files plus the four edited ones: `engine/filehash-6761`, `cli.task-list-compact-6761`, `server.fingerprints-6761`, `web.fingerprints-6761`, `server.builtsha-6330`, `tools.windows-kosmos-cli-570`, `web.agent-files-3614`, `web.filebrowser-6724` and `web.filewho-5812`. I did not run the Mac CLI itself or any live board. The gap that matters for finding 1 is that no test sets a future mtime.

#### Iteration 3
**Reviewer model:** opus

1. [CHALLENGE] WARNING, engine/filehash.js:47-60 (`want`) and :67-80 (`hashOne`). Cloud-only files get downloaded just because a list was shown.
   - **Scenario:** a project folder sits in an iCloud-synced Documents or Desktop folder (or a OneDrive folder on Windows). Its files are often stored only in the cloud. A placeholder still reports its full `size`, so `want` queues it, and the read in `hashOne` makes the OS download the whole file (macOS fileproviderd, OneDrive recall). The project page polls every 5 s with 10 rows, and the Documents view asks for 500. So simply showing a list downloads up to 500 files of up to 512 MB each, without the person opening any of them. That costs bandwidth and disk, and on a laptop it can fill local storage that the person deliberately kept free. Nothing on this branch or in the plan considers this; the 512 MB per-file cap and the settle rule do not bound it.
   - **Not measured:** I could not make a dataless file here. This is from how macOS and OneDrive placeholders work, not a run.
   - **Fix:** skip a file that looks like a placeholder, so its row shows nothing:
     - `st.size > 0 && st.blocks === 0` where `st.blocks` is defined (macOS and Linux);
     - on Windows, skip project folders under a OneDrive root (engine/update already has detection for that);
     - add a test with a stat stub where `blocks` is 0 and `size` is greater than 0, plus a mutant.

2. [CHALLENGE] NIT, engine/tasklist.js:28-41 (`titleOf` / `ownerOf`). The compact rows drop two marks that the long list deliberately prints.
   - The `[added by X]` mark from #4887, which says an agent other than the owner added the task.
   - The "through task N" qualifier from #5678 on an owner who only owns the task through its tree.
   - **Scenario:** agent A adds a task whose wording names agent B ("mona: ship the build"), and it is assigned to nobody or to B. The compact line `#7  open  nobody  mona: ship the build` reads as B's own instruction, which is exactly what #4887 added the mark to prevent. A subtask's inherited owner also prints as a direct owner.
   - The webhook quoting is kept, which is the stronger case, so this is a NIT.
   - **Fix:** add ` [added by <q(addedBy)>]` after the title under the same condition as the long list (`addedVia === 'process'` and not one of the owners). Print an inherited owner as `<name> (through #N)`.

3. [CHALLENGE] NIT, engine/projects.js:1788-1791 (`fingerprintStampPart`). This part of the stamp joins raw `name=sha` with `\n`, but the comment just below it says the stamp uses JSON-encoded records precisely so a `\n` in a POSIX name cannot merge two records. The new part brings that collision back, in theory. The only effect would be a missed repaint, so it is cosmetic.
   - **Fix:** `known.map((r) => JSON.stringify([r.name, r.sha256])).join('\n')`, as listDir already does by putting the sha inside its JSON record.

**Tests:** all green in the worktree, with cwd set and KOSMOS_*/AGENT_WORKFORCE_* stripped (`ℹ fail 0`, `ℹ cancelled 0` for every file):

| File | Pass |
|---|---|
| engine/filehash-6761 | 8/8 |
| server.fingerprints-6761 | 4/4 |
| web.fingerprints-6761 | 5/5 |
| cli.task-list-compact-6761 | 8/8 |
| server.builtsha-6330 | 7/7 |
| tools.windows-kosmos-cli-570 | 50/50 |
| web.filebrowser-6724 | 14/14 |
| web.filewho-5812 | 2/2 |
| web.agent-files-3614 | 14/14 |

**The stat and open stubs I checked, none passing for the wrong reason:**
- The cloned-Stats construction keeps `isFile()` working; the future-mtime test, which needs a hash to come back, proves it.
- The size-cap mutant would show up as `opens = 1`, so that test can fail.
- The "only rows shown" test stubs `filehash.forRow`, which projects.js calls as a property of the module, so the stub really intercepts it.

The Windows symlink or junction swap, where O_NOFOLLOW does not exist, is covered by the dev/ino key check in `hashOne`. Nothing new on security beyond item 1.

#### Iteration 4
**Reviewer model:** sonnet

[CHALLENGE] NIT, engine/filehash.js:56 (the `st.blocks === 0 && st.size > 0` rule). Findings 1 and 2 are my choice of rating; finding 3 is a reading of the code that I did not run. Everything else I looked at holds.

1. **Failure scenario.** The rule treats any file with zero allocated blocks and a size above 0 as a cloud placeholder. Any real local file that reports 0 blocks is then never fingerprinted, and nothing tells the person why.
   - Measured on this Mac: a sparse 100 MB file (`truncate` only) reports `size=100000000 blocks=0`, so it is skipped.
   - Other file systems that could report 0 blocks for real local data, by their documented behaviour (I could not reproduce these here):
     - small decmpfs-compressed APFS files kept in an xattr;
     - ext4 with `inline_data`;
     - some NFS and SMB servers.
   - My attempt to make a compressed file here with `ditto --hfsCompression` produced no compressed flag, so I could not confirm the decmpfs case.
   - A bounded cost follows: the Documents view's fill (web/index.html `docsFingerprintFill`) re-reads up to 500 rows every 2 s, up to 15 times, whenever any row lacks a hash. A project holding one such file therefore costs about 15 refetches on every open of the view, and the row stays blank.

   **Fix.** Make the rule narrower or say why it skipped the file. For example, skip only when `blocks === 0` and the file is at least 1 MiB, since tiny files are cheap to read even if a placeholder. Alternatively, on macOS test the dataless flag (`SF_DATALESS`) instead of the block count. At minimum, add the sparse and compressed cases to the plan's accepted-and-recorded list.

2. **NIT, web/index.html `docsFingerprintFill`.** The fill gives up after 30 s total, but the hasher is one-at-a-time, up to 512 MB per file, and each file waits 5 s after its last change before it is hashed. A folder with several large settled files can take longer than that to finish. The rows that were not reached stay blank until the person reopens the view. This is bounded and benign. It would be worth adding a sentence to the plan's accepted items, since the plan currently says only that a too-big file "runs out the tries".

3. **NIT, engine/projects.js:2149 (`listDir`).** `rowOf` is called inside the read loop, before the 1000-entry cap check can stop the scan. Each poll therefore calls `forRow` for up to 1000 files. This is harmless, because `QUEUE_MAX` is 2000, the dedup set stops repeat queueing, and a known hash is a single map lookup. It is only worth noting that a folder of 1000 large settled files queues about 500 GB of reads over time, the byte budget the plan already declined in iteration 1.

No security issue and no correctness bug. I read the diff for `filehash.js`, `tasklist.js`, `rowOf` and the stamp, the stamp's JSON records, `O_NOFOLLOW` and the before-and-after stat check, the `(through #N)` and `[added by X]` wording, and the two CLIs' argument and error paths. I also ran four test files in the worktree. All passed with 0 fail and 0 cancelled:

| Test file | Tests |
|---|---|
| `engine/filehash-6761.test.js` | 9 |
| `server.fingerprints-6761.test.js` | 4 |
| `web.fingerprints-6761.test.js` | 5 |
| `cli.task-list-compact-6761.test.js` | 8 |

Nothing in the diff rises above NIT. The only non-NIT-adjacent point is finding 1, which is a wording and coverage gap that I would not block on.

#### Iteration 5
**Reviewer model:** opus

1. [CHALLENGE] NIT, web/index.html:42437 to 42440 (agent narrow Files panel), 42554 to 42575 (Files browse screen), 69529 to 69531 (project rail `pjLoadDocs`), with the cause in engine/projects.js `fingerprintStampPart` and the listDir stamp at about line 2165.

   **The problem.** Your stamp now includes the fingerprints, so it moves when a fingerprint arrives even though no file changed. All three polled lists react to a moved stamp by emptying the list (`textContent = ''`) and building every row again. Nothing in that path gives the keyboard focus back.

   **Scenario (worked out from the source, not measured in a browser).**
   - A keyboard or screen-reader user is on a row in the agent's Files screen.
   - An agent saves a new file. The list repaints, which already happened before this branch.
   - Five seconds later the file has settled and is hashed. The next poll sees a moved stamp and repaints again, and focus drops to `<body>`.
   - So each new or changed file now costs a second focus loss and a second re-read by the screen reader.
   - After a board restart the cache is empty. Every list hashes its rows again, so a browsed folder of large files repaints on several polls in a row until the hashing finishes.

   Iteration 2 fixed exactly this for the Documents fill (`docsFingerprintFill` puts focus back on the same row by `dataset.doc`). The three polled lists that this branch also made repaint more often did not get that fix. The plan records "the stamp includes them, so a polled list repaints" as intended, but says nothing about focus on those lists.

   **Fix.** Do what iteration 2 did in each of the three repaint paths: before clearing, note the focused row's `dataset.doc` (or `dataset.dir`); after rebuilding, focus the row with the same value. A possible further step, if you want it: when only the fingerprint part of the stamp moved, patch the `title` and size line of the existing rows in place instead of rebuilding.

**Checked and fine:**
- **Hashing safety (engine/filehash.js):**
  - The file's identity before and after the read must match the identity from when it was listed, so a file swapped after listing gets no fingerprint.
  - O_NOFOLLOW and O_NONBLOCK are both used.
  - The backoff and the cache both have size limits.
  - A file is hashed only if it is regular and not a link (lstat in listDir; the dirent check in listFiles).
- **No path or stat leak:** the internal `abs` and `st` fields never reach a response; `rowOf` builds a clean row.
- **Task list (engine/tasklist.js):** the escaping of a webhook task's words and the `[added by]` mark match the Windows long list. The bash path routes refusals to stderr and returns the module's exit code. `kosmos_engine_module` resolves the module the same way as for `handoff`.
- **Documents fill:** it only fills a fingerprint onto the same file (same name, size and date), and its fetch uses the same `limit=500` as `openDocsView`.

**Tests**, run in the worktree with KOSMOS_* stripped, all with 0 fail and 0 cancelled:

| Test file | Passed |
|---|---|
| engine/filehash-6761 | 10/10 |
| server.fingerprints-6761 | 4/4 |
| web.fingerprints-6761 | 5/5 |
| cli.task-list-compact-6761 | 8/8 |
| server.builtsha-6330 | 7/7 |
| tools.windows-kosmos-cli-570 | 50/50 |
| web.filebrowser-6724 | 14/14 |
| web.filewho-5812 | 2/2 |
| web.agent-files-3614 | 14/14 |

One small weakness, not filed as a finding: in server.fingerprints-6761.test.js:63 the "stamp moves when a fingerprint arrives" check only runs if the first read had no fingerprints yet. With the 5-second settle rule that is always the case today, so it does run.

There are no other new findings beyond item 1.

#### Iteration 6
**Reviewer model:** sonnet

1. [CHALLENGE] WARNING, web/index.html:42212 to 42224 (`refocusRow`), plus the same shape in `docsFingerprintFill` at about line 69277. I did not run it in a browser; this follows from reading the code.
   - `refocusRow` calls a bare `again.focus()`, and `docsFingerprintFill` does the same after `pjDocsPaintPage()`. A plain `focus()` scrolls the element into view.
   - Iteration 5 makes these repaints fire without any file changing, because a fingerprint arriving moves the stamp. Take a keyboard user who tabbed to a row and then scrolled the Files screen away with the wheel or touchpad. When the next background fingerprint lands, the page jumps back to that row.
   - In the Documents view this can happen up to 15 times over about 30 s. It can also happen repeatedly during the 5 s polls while many files are being hashed. The scroll jump disorients readers and is worse for people using zoom or magnification.
   - Fix: use `again.focus({ preventScroll: true })` in `refocusRow` and in the Documents fill's refocus. Keep the plain focus for the deliberate `AGENT_FILES_FOCUS` first-paint case.

I checked the rest of the diff and found nothing new and real in it.
- **Row keys:** `rowKey` prefixes `doc:` and `dir:`, so a file and a folder with the same name do not collide. Breadcrumb buttons sit outside the list box.
- **Fingerprint hashing:** the stat key matches between listing and hashing. Dirent filtering keeps symlinks out before `O_NOFOLLOW` could matter. The `listDir` abs path (`got.real` plus basename) is consistent with its one-level names.
- **Stamp inputs:** both stamps include the fingerprint, so a repaint fires when one arrives.

I did not run the tests.

#### Iteration 7
**Reviewer model:** opus

I found one new WARNING and one NIT. Tests run on the worktree (which has since been rebased to e2a0562; the code under review matches the pinned 74b96b5b08 version): engine/filehash-6761 10/10, web.fingerprints-6761 6/6, server.fingerprints-6761 4/4, cli.task-list-compact-6761 8/8. That is `ℹ fail 0` and `ℹ cancelled 0` in each.

1. [CHALLENGE] WARNING, web/index.html `pjLoadDocs` (pinned line ~69564, the `roomBox.__lastRoom = undefined; ... paintRoom(roomBox.__lastBody)` line just after the new `hadFocus` capture)
   - **Cause:** when the project rail's stamp moves, `pjLoadDocs` rebuilds the rail and also forces a full rebuild of the project conversation. It clears `__lastRoom`, so `paintRoom` skips its shape guard and calls `paintThreadInto`, which closes any open reaction picker (`rxnCloseAllPickers()`) and replaces every message (`setLive`). That rebuild exists only so file citations become chips when the folder's names change. Before this branch the stamp moved only when a file changed. Now it also moves when a fingerprint arrives (`fingerprintStampPart(shown)`), and no file name has changed.
   - **What the person sees:**
     - About 5 s after opening a project on a freshly started board (fingerprints are kept in memory only, so none survive a restart), the rail's next poll brings the fingerprints. The whole room is rebuilt: an open reaction picker closes, a text selection in the conversation is lost, and keyboard focus on a message's button is dropped. Only the jump focus (`PJ_JUMP_FOCUS`) is put back.
     - After each file an agent writes, the room is now rebuilt twice instead of once: once for the change, then again when its fingerprint arrives after the settle time.
   - **Gap in iteration 5:** that fix kept focus in the three lists, but not in the room that one of them repaints.
   - **Fix:** in `pjLoadDocs`, force the room repaint only when the names changed. For example, compare `JSON.stringify(body.names)` against the last value kept, or compare the old and new `PJ_DOC_NAMES` sets. Keep the rail repaint as it is.
   - **Test:** a fingerprint-only stamp change leaves `__lastRoom` untouched; a name change still clears it (control).

2. [CHALLENGE] NIT, web/index.html `agentFileRow` (`b.title = ... ', fingerprint sha256 ' + fp`), `pjDocsPaintPage` and `pjLoadDocs` (the `b.title = f.name + ', fingerprint sha256 ' ...` lines)
   - **Cause:** a button's `title` becomes its accessible description, so screen readers read all 64 hex digits for every row as they move down a list.
   - **What the person hears:** on the narrow panel and the rail that is 64 characters of noise per row. In the Documents view it comes on top of the 12 digits already read from the row text.
   - **Who can see it:** the whole value is only in hover text, so touch and keyboard-only sighted users never see it. The visible 12 digits still let them tell versions apart.
   - **Fix:** either
     - keep the hover for mouse users and stop it reaching the accessible description, by setting `aria-description` to `'fingerprint ' + fp.slice(0, 12)`, which overrides the title for screen readers; or
     - put only the short form in the title and leave the whole value to the CLI.
   - **Test:** add a check that the row's description is the short form.

No other new findings. I re-checked these and they hold: the walk's `abs`/`st` never reach the response, the compact task-list paths on both CLIs, and the before/after identity check in `hashOne`. A folder swapped mid-read in `listDir` can make the board hash a file outside the folder, but the result is cached under that path and identity only, never shown, so nothing leaks.

#### Iteration 8
**Reviewer model:** sonnet

1. [CHALLENGE] WARNING, web/index.html:42412, 69375, 69666 (and web.fingerprints-6761.test.js:48-55). The iteration-7 spoken description is set as a property, `b.ariaDescription = ...`. This is the ARIA reflection property, and I could not confirm that every browser Kosmos runs in implements it. I did not measure this. Where it is unsupported, the assignment creates a plain expando that nothing reads. The row then has no spoken description except the `title`, so the 64-hex value is read aloud on every row, which is the noise iteration 7 set out to remove. The attribute form `b.setAttribute('aria-description', ...)` has no such dependency.
   - The test cannot catch this. It uses a fake DOM that records the property name, so it passes whether or not a real browser honours it.
   - Fix: use `setAttribute('aria-description', text)` in all three places, and have the test assert `getAttribute('aria-description')`. If the property form is kept, the browser support needs to be verified.

I read the rest of the diff and found nothing else new. That covers `sameDocNames` (null-to-null correctly skips the repaint, and a null-to-set change repaints), `refocusRow` (the rail rows carry `dataset.doc`, so the keys match), and the Documents fill (it keys on name, size and modified, so a newer file is never given an older hash). I did not run the test suites.

#### Iteration 9
**Reviewer model:** opus

I found two NITs and nothing at BLOCKER or WARNING. The tests pass with nothing failing or cancelled: the 7 new and changed files plus 8 neighbouring and audit files, including filehash 10/10, server.fingerprints 4/4, web.fingerprints 7/7, cli.task-list-compact 8/8, engine.reachable, the #1732 audit, web.project-page, bundle.* and fixture-discipline. I also checked the iteration 8 changes (the `aria-description` attribute, the '|' stat key, FP_NOFOLLOW / FP_NONBLOCK with their #1732 inventory rows, the four excused test seams) and found nothing wrong with them.

1. [CHALLENGE] NIT, `engine/filehash.js:55-57` (and plan line 90, the iteration 3 ACCEPTED item). The comment and the plan both say Windows "reports no blocks", so a OneDrive placeholder there cannot be detected and can be downloaded just by showing a list. This is reasoned from libuv's source, not measured: there is no Windows machine here, and the macOS stat of the node binary gave blocks=32, which is only the POSIX side. As I remember it, libuv's Windows stat fills `st_blocks` from `StandardInformation.AllocationSize >> 9`, and a cloud-only OneDrive file allocates nothing locally. If so, the existing `blocks === 0 && size >= 1 MiB` rule already catches placeholders on Windows. The code is safe either way; it is the recorded premise that is probably wrong, in the reassuring direction. A later reader might "fix" Windows with a second mechanism, or treat the accepted risk as real. Fix: on a Windows CI runner, stat a regular file and check that `blocks` is a positive number. If it is, rewrite the comment and the plan item to say Windows is covered too, with the remaining gap being only providers that report a non-zero allocation.

2. [CHALLENGE] NIT, `engine/filehash.js:85`. `hashOne` allocates and zero-fills a fresh 1 MiB buffer for every file, even a 5-byte one. A browsed folder can queue up to 1000 files, which is about 1 GB of allocation and memset plus GC churn just to hash small files. The CPU cost is small (estimated, not measured). Fix: `Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(1, before.size)))`, or one module-level buffer, which is safe because `drain` hashes one file at a time.

#### Iteration 10
**Reviewer model:** sonnet

NO NEW FINDINGS

I checked the iteration 9 change by reading `engine/filehash.js` and the rest of the diff. I did not run the tests or measure anything.

**Shared buffer, no concurrent use.**
- `hashOne` is not exported. Its only caller is `drain`, which awaits each file before taking the next.
- `drain` is guarded by `running`, which is set synchronously on entry. A second `setImmediate(drain)` returns at once.
- Nothing awaits between the loop's final `queue.length` check and `running = false`. A job pushed at that moment cannot be stranded, and the guard cannot let two reads overlap.
- `_resetForTest` clears the queue but leaves `running` alone, so it cannot start a second reader either.
- `h.update` copies its input synchronously before the next `await`, so a later file cannot overwrite bytes that are still being hashed.
- `finally { await fh.close() }` also runs before the next job starts.

**No stale tail.**
- Only `buf.subarray(0, bytesRead)` is hashed, and `pos` advances by `bytesRead`, so a short read never leaves old bytes in the hash.
- A zero-byte read returns without caching, which covers a file that shrank mid-read.
- The read length is capped at `before.size - pos`. A file that grows after the first stat is caught by the second `keyOf` comparison and goes to backoff instead of the cache.

**`listDir` path.** `abs: path.join(got.real, path.basename(e.name))` looks wrong for nested names but is correct. `e.name` is `relDir/ent.name` and `got.real` is already that directory's real path, so the basename is the right leaf.

I read the rest of the diff and found nothing new. That covers `rowOf`, the stamp changes in both list functions, the focus handling in `web/index.html`, the Documents fill-in, and `tasklist.js`.
