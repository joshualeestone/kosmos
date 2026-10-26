# storecheck-7248 review, round 1 (blind, CTO lens)

Branch `storecheck-7248` at 158ee6c0e6, diffed against origin/main (fetched 2026-10-26). One commit, 9 files.

Counts: 0 BLOCKER, 7 WARNING, 8 NIT.

## Findings

### [WARNING] W1 engine/storecheck.js:115-117 and :110: a kept copy's time moves to the time it was kept, so the second start offers "the copy from" the wrong time
`fs.copyFileSync` does not keep the source's mtime on macOS (measured: source mtime 2026-01-01, copy mtime = now). The kept `.recovered-` file therefore carries the time of the first board start, and `goodCopy` reads `st.mtimeMs` for both ranking and `at`.
Scenario (measured on a scratch copy, `run2.js`): a crash temp written at 2026-01-01; first start says "A good copy from 2026-01-01T00:00:00.000Z"; securewrite reaps the temp on the next write; second start says "A good copy from 2026-10-26T21:39:06Z" for the same bytes, and the page's button says "Put back the copy from 4:39 PM" (today). It also wins any "newest" comparison against a genuinely newer `.bak`/`.prev`, because its mtime is the copy time.
Fix: after the copy, `fs.utimesSync(kept, st.atime, st.mtime)` from the source, or (simpler and robust) take a `.recovered-` file's time from the timestamp already in its own name, and rank by that.

### [WARNING] W2 engine/storecheck.js:113-118: a kept copy of a secret-bearing store outlives its own revocation, the exact residue engine/securewrite.js:60-120 says must not exist
The scan covers `sendertokens/`, `service-keys.json`, `remote.json`, `org-enrollment.json`. A crash temp there holds a secret; securewrite's whole reaper design (#1793, #5434 slice 2) exists because "a secret outlives its own revocation ... NO CODE PATH WILL EVER REMOVE IT". `.recovered-<when>` and `.damaged-<when>` match neither `reapOrphanTemps` nor `reapDeadTempsOf` nor any `forget()`, so a token or key copied here survives a revoke, a re-connect and an uninstall forever. Restore then makes it worse: putting back an old `sendertokens/<agent>.json` or `service-keys.json` reinstates a credential the person may have rotated or removed since.
Fix: for the secret-bearing stores, either do not keep a copy (name the damage, offer nothing), or register the kept copy with the owning module's forget path so it is removed with the secret; and say on the row that putting it back brings back an older key. At minimum, list the secret-bearing names and exclude them from `goodCopy`.

### [WARNING] W3 server.js:19864-19874 (restore route) vs server.js:4716 REMOTE_STEP_UP_EXACT: restore writes a credential store from a remote session with no step-up
`POST /api/board/damaged-files/restore` is not in `REMOTE_STEP_UP_EXACT`, while every route that "leaves a provider's or a service's credential on this computer" is (and so is `/api/register/hide`, a mere notice). With W2, a stale Kosmos+ session can put an older `service-keys.json` or sender token back on this computer. `server.remotestepup-6595.test.js` passes (30/30, measured), so nothing forces the decision.
Fix: add `'POST /api/board/damaged-files/restore'` to `REMOTE_STEP_UP_EXACT` (dismiss can stay ungated, it only hides), or refuse restore of the secret-bearing stores from a remote request.

### [WARNING] W4 engine/storecheck.js:163-165 and web/index.html paintDamagedFiles: the list is frozen at start, so "Kosmos has not changed it" goes false and the good copy becomes unreachable
`current()` returns the start-time snapshot all session. The plan's own fact: several readers treat a damaged store as empty and the next write replaces it (settings, worlds.json, profiles, sender tokens). Scenario (reasoned from the plan and restore's line 182): settings.json is all-NUL at start; the person changes one setting; settings.json is now `{...one key...}`. The note still says "Your settings (settings.json) cannot be read. Kosmos has not changed it." and offers Put back; pressing it is refused with "it is readable again, so Kosmos left it alone", and there is now no way in Kosmos to get the good copy back although it sits on disk. For an `unreadable` store (a truncated JSON with most of the person's data in it) the damaged bytes themselves are also lost at that write, because nothing kept them.
Fix: (a) re-classify each file in `current()` (cheap, measured scan cost 13 ms for 162 files / 2 MB on a real install) and say "Kosmos has saved over it since" instead of "has not changed it"; (b) keep an `unreadable` (non-empty, non-NUL) store aside as `.damaged-<when>` at start, since a copy beside it changes nothing; (c) when the store reads again, still offer the copy with a plain warning that it replaces what is there now, rather than refusing.

### [WARNING] W5 engine/storecheck.js:183-188: restore writes the store without flushing, so a power cut right after can recreate the NUL-filled file this card names
`writeFileSync(tmp)` then `renameSync` with no fsync. The codebase's rule (projects.js:373, "#5434 slice 17: flushed before it replaces the file (store.saveFlushed), so a crash cannot leave it zero-filled") exists for exactly this, and the aside copy is not flushed either. Also the temp name `<file>.restore-<pid>.tmp` is opened without `wx`: a leftover from an earlier failed attempt keeps its old mode (the `mode: 0o600` applies only on create) and a planted symlink there is written through.
Fix: use `store.saveFlushed(d.abs, buf)` or `securewrite.writeSecret` (which also gives the right mode per store and the dead-temp reaping), and create the aside copy with a flush too.

### [WARNING] W6 web/index.html paintDamagedFiles (row text): the sentence is ungrammatical for most stores and uses jargon
The subject is the HOLDS phrase, and most are plural: "The keys for services you connected (service-keys.json) is empty." (measured in a page probe), "Your settings (settings.json) is empty", "Your AI policies ... is empty", "Your projects, their tasks and who is on them (projects.json) holds only empty bytes". "holds only empty bytes" is not plain English for a non-technical person, and the board log adds a second bracket: "holds only empty bytes (a crash can leave a file like this) (it holds ...)". The put-back button reads "Put back the copy from on Oct 3 at 4:00 PM" for any copy older than yesterday, because `rebootWhen` returns "on ..." and only `^at ` is stripped (reasoned from web/index.html:23850; old crash temps are the normal case, see W1).
Fix: one shape that works for every phrase, e.g. "The file with your settings (settings.json) is empty." / "... is damaged, it holds nothing." Drop "empty bytes" on screen and in the log ("is blank, as a crash can leave a file"). For the button, use "Put back the copy saved {rebootWhen}" ("saved at 4 PM", "saved on Oct 3 at 4 PM"), which reads with all three forms.

### [WARNING] W7 web/index.html paintDamagedFiles put-back handler: pressing Put back drops keyboard focus to the page, success or failure
`btn.disabled = true` blurs the focused button immediately (measured: activeElement is BODY right after Enter), and on success `row.innerHTML = ...` removes it; on refusal the button is re-enabled but focus is not returned. A keyboard or screen reader user lands at the top of the document with no announcement tied to their action (the `role="status"` wraps the whole note, so it was present before the change).
Fix: keep the button enabled but `aria-disabled="true"` with a guard flag while in flight; on refusal leave focus on it; on success give the row `tabindex="-1"` and focus it (or focus the X), as `paintRebootNote` does with `rebootFocusAway` when its note leaves.

### [NIT] N1 engine/storecheck.js:84-86, :134-137: a store that cannot be opened, or is a symlink, or is over 64 MB, is skipped silently
`readFileSync` throwing EACCES is `continue`, so a permissions-damaged store (which its readers also see as missing) is never named; `Dirent.isFile()` is false for a symlinked store, so a person who links projects.json elsewhere gets no check; >64 MB is skipped with no line. Fix: name EACCES as its own problem ("Kosmos cannot open it"), `statSync` the symlink target, and log one line for an oversized skip.

### [NIT] N2 engine/storecheck.js:100-106: `goodCopy` follows symlinks for `.bak`/`.prev`/`.recovered-`
`statSync` + `readFileSync` follow a link, so any JSON file a link points at can be offered and then written into the store. Needs a same-user writer in the data root, hence NIT. Fix: `lstatSync` and require a regular file.

### [NIT] N3 server.js:26897: if `worldBase()` throws, the whole check is skipped, not just the base registry
The argument is evaluated inside the same try as `atStart`, so a broken login env (worldRegistryBase null) means the data root is never scanned either. Fix: `let base = null; try { base = worldBase(); } catch {}` before the call.

### [NIT] N4 engine/storecheck.js:153, :190: board.log can carry a home path
Both error lines append `err.message`; Node fs errors include the absolute path ("EACCES: permission denied, open '/Users/<name>/Library/...'"). The test's own guard (N6) would not catch it. Fix: log `err.code` and `rel(path)` only. Also `rel()` on Windows across drives returns an absolute path (path.relative cannot relativise C: to D:), which does not start with `..`.

### [NIT] N5 engine/storecheck.js:171-195: restore does not take the owning module's lock
worlds.json has `withRegistryLock`; projects has its own write path. Within the board everything is synchronous, so the window is only against another process (the CLI, a second board on another world). Fix: for worlds.json go through worlds.js's lock; otherwise document the residual.

### [NIT] N6 server.storecheck-7248.test.js:102: the "no home path" assertion cannot fail
The sandbox is under `os.tmpdir()` (/var/folders/... on macOS), not under `os.homedir()`, so the regex can never match whatever the log says. Fix: assert the log lines carry no `sb` (the sandbox path) and no `path.sep`-led absolute path.

### [NIT] N7 server.storecheck-7248.test.js: nothing pins "first in the start block"
The done-when test damages projects.json and removed.json, which no start-path writer touches, so moving `atStart` below `communityswitch.migrate`, `wireDefaultHooks` or `undo.sweep` would stay green. Fix: a static order test in the style of server.worldenv-order.test.js (atStart is the first statement inside `if (require.main === module)` at the start block), or damage a store a start writer touches.

### [NIT] N8 docs/browser-checks/render-damaged-files-7248.js:78,87,95: clicks are `element.click()` in page JS, which works on an inert or covered button
In my probe the whole `.apphead` (which contains `#damaged-slot`) was `inert` under this check's stubs, and the check still passed 24/24, because `HTMLElement.click()` ignores inertness and overlap. So the check cannot tell a button a person can press from one they cannot, and cannot see W7. Fix: use `page.click()` / keyboard `Enter` on a focused button and assert `document.activeElement` after each action.

## Checked and found clean

- Store reads and writes before the check (MEASURED): booted the branch's server with an fs trace preload (`--require` hook logging every fs call under the sandbox data root, with 20 root stores plus profiles/alice.json and sendertokens/alice.json all damaged). Before storecheck ran: two reads of worlds.json (worldenv bootstrap, read-only), one `existsSync` (legacy-store migration probe), one read of catalogue/catalogue.json (catalogue.load, read-only, writes nothing on failure). No write, rename, unlink or copy touched the data root before the check. logstamp/logring write only board.log. After the check, 8 s of idle board wrote only board-alive.json, .world-confirmed.json, ping.json, prompter-nudges.json, setup-guide-state.json and bin/ scripts: none of the damaged stores was rewritten, and all 22 were named in the log.
- Board log line (MEASURED): relative names only (`profiles/alice.json`, `worlds.json`), no home path, no secret content, one line per file.
- Path traversal through `file` (REASONED, engine/storecheck.js:173): restore only accepts a string equal to a `file` in the start-time list; nothing from the request reaches a path.
- Mode of a kept copy of a 0600 store (MEASURED): `copyFileSync` keeps 0600 on macOS.
- False positives on a real install (MEASURED, read-only): ran the same classification over the real default data root's 162 candidate files (root, profiles, commitments, sendertokens, webhooks, community, communitysend, catalogue, remote): 0 flagged. Scan cost 13 ms for 2 MB, largest file 818 KB.
- A directory named *.json, dotfiles (MEASURED by code path and trace): `isFile()` and the leading-dot filter skip them; `.world-confirmed.json` is not scanned.
- Folder enumerations seeing the new files (REASONED, discover.js:1665, register.js:77, feedbacksend.js:165, sendertoken.js:772/844, backuptick.js:218): every reader filters `.endsWith('.json')`, and `.recovered-*`, `.damaged-*`, `.restore-*.tmp` do not end in .json.
- Modules caching old content after restore (REASONED): projects.js re-reads each time and its `LAST_READ_OK` refuses to write over an unreadable file, so a restore is picked up on the next read; no module-level cache found for settings, you, policy, limits, stars. The success copy's "restart Kosmos" covers worldenv's frozen booted world.
- Named world (REASONED, storecheck.js:127-130, worlds.baseRoot / store.resolveDataRoot): the base worlds.json is added only when the base differs from the world root, both derive from resolveDataRoot so the comparison is spelling-safe, and it is named relative to the base.
- Done-when test (MEASURED): `node --test server.storecheck-7248.test.js` exit 0, 2/2. Negative control on a scratch archive copy with the `atStart` call disabled: exit 1, the done-when test fails and the unit test passes, so it can fail on the thing it covers.
- Browser check (MEASURED): `render-damaged-files-7248.js` exit 0, 24 PASS, 0 FAIL (see N8 for what it cannot see). Listed in gated.txt and README.
- Remote step-up suite (MEASURED): `server.remotestepup-6595.test.js` exit 0, 30/30 (it does not require the new routes to be classified, see W3).
- Em dashes (MEASURED): the only one in the diff is inside the browser check's own no-em-dash regex.
- Route parity (REASONED): GET and dismiss mirror `/api/board/restart-note` and its dismiss exactly; restore's body read is capped at 4096 bytes and a bad body is a 400.

Every board I started was stopped by its recorded pid; no file in the worktree was edited except this review.
