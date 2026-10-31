# storecheck-7248 review, round 2 (blind, CTO lens)

Branch `storecheck-7248` at 22a04d7085, diffed against origin/main (fetched 2026-10-26). Two commits, 10 files. Focus on
the round 1 commit.

Counts: 0 BLOCKER, 3 WARNING, 6 NIT.

Round 1's fixes hold except where W2 below says the move to saveFlushed regressed the aside copy's mode.

## Findings

### [WARNING] W1 engine/storecheck.js:200-228 with web/index.html damagedFilesCheck (~line 23970) and the 10-minute interval (~line 46369): restore acts on the store as it is now, but the page shows it as it was at page load, so a press can replace the person's newer data, or bring back a store that was deleted, with the page saying "Kosmos has not changed it"
`current()` re-reads the store, but the page asks for it only at load and when the board restarts (the interval re-asks
only `rebootNoteCheck`). `restore()` takes no statement of what the page showed and proceeds whatever the store is now:
saved over, or gone (`now === null`, it then writes the copy into place and logs "nothing was there to keep").
Scenario (MEASURED, scratch sandbox, `exp2.js`): settings.json all-NUL and profiles/bob.json empty at start; the page's
`current()` says `savedOver:false` for both. Then the person changes a setting (settings.json now `{"theme":"new"}`) and
removes agent bob (profiles/bob.json deleted). Pressing either button: both `{ok:true}`; settings.json is now
`{"theme":"old"}` and profiles/bob.json exists again. The page said "Kosmos has not changed it" for both, with no
"keeps what is there now beside it" line. The new settings sit in `settings.json.damaged-<when>`, which nothing in Kosmos
offers back, so to the person they are gone. The removed agent's profile coming back is reasoned to resurface it wherever
profiles are listed.
Fix: send what the page showed with the press (`savedOver`, or better a `{size, mtimeMs}` token `current()` returns) and
have `restore()` refuse with 409 when the store no longer matches it, or no longer exists; the page then repaints from a
fresh `current()` and says why. Also re-ask `damagedFilesCheck` on the same 10-minute interval, or on focus.

### [WARNING] W2 engine/storecheck.js:218 (`store.saveFlushed(aside, now)`): the aside copy of an owner-only store is written readable by everyone on the computer
`saveFlushed` takes its mode from `modeOf(file)` of the target, and the aside file never exists yet, so it is created at
0666 less the umask. Round 1's `copyFileSync` kept 0600; this commit lost it.
Scenario (MEASURED, `exp1.js`, umask 022): webhooks/webhooks.json at 0600, all-NUL, a 0600 `.bak`: after Put back,
`webhooks.json.damaged-<when>` is 0644. The same applies to every 0600 store not on the secret list. On a real install
those include unsent-lines.json (what the person typed and did not send), community/posts.json and comments.json,
agent-permission-settings.json and webhooks/webhooks.json (MEASURED: their modes in the real data root, names only, no
content read).
Fix: write the aside with the store's own mode: `securewrite.writeSecret(aside, now, modeOf(d.abs) ?? 0o600,
{ atomicOnly: true })`, or a `store.saveFlushed(file, data, mode)` overload. Also keep the restored store's mode when
the store has gone (modeOf returns null there): take the copy's mode.

### [WARNING] W3 engine/storecheck.js:60-62 (SECRET_FILES / SECRET_FOLDERS): webhooks/webhooks.json holds the webhook verifiers, and putting back an older copy brings a removed webhook back to life
engine/webhooks.js:43-50 and :244-250 store `hash: sha256(secret)` per hook and `verify()` accepts any id whose hash
matches. A person removes a webhook because its address leaked; later webhooks.json is damaged in a crash; Put back the
copy saved before the removal, and the leaked address can post into the project again. That is the "outlives its own
revocation" case round 1's W2 fixed for tokens, through the verifier rather than the secret. The restore is MEASURED to
proceed for `webhooks/webhooks.json` (exp1.js: `{ok:true}`); the revival is REASONED from webhooks.js.
The same class, weaker (REASONED): agent-permission-settings.json and org-consent.json are grants the person can
withdraw; an older copy put back re-grants them, and the row's words ("Put back the copy saved <when>") do not say so.
Fix: add `webhooks` to SECRET_FOLDERS. For the grant stores either add them too, or add one line on their rows before
the press: "Putting it back also brings back any permission you changed since then."

### [NIT] N1 engine/storecheck.js:97 and :220: a linked store is checked at its target but put back over the link
MEASURED (`exp1.js`): settings.json a symlink to an empty file elsewhere, a good `.prev` beside the link. Put back
returns `{ok:true}`, settings.json is now a plain file, and the link's target is still empty. The scan says the link's
target is damaged; the restore repairs neither. Kosmos's own writes also replace a link at rename, so the link was not
going to survive long, hence NIT.
Fix: for a link, refuse restore with "it is a link to a file elsewhere" or write to `fs.realpathSync(d.abs)`.

### [NIT] N2 web/index.html damagedRowWords and the success row: the words after a save-over contradict themselves, and "kept beside it" has no way back
"The file with your settings (settings.json) cannot be read. Kosmos has saved over it since it started." (MEASURED,
browser check output): it can be read now. The success row "What was there is kept beside it" names a `.damaged-` file
that no screen offers. Fix: past tense when `savedOver` ("could not be read when Kosmos started; Kosmos has saved over it
since"), and say where the kept file is in the person's words, or offer the `.damaged-` copy as a put-back too.

### [NIT] N3 engine/storecheck.js:184-194: `current()` reads each damaged store whole, synchronously, on every page ask
An `unreadable` store can be up to 64 MB, read and `JSON.parse`d on the event loop for each page load and each open
tab. Not racy (the writers rename, so a read sees old or new), but needlessly heavy. REASONED. Fix: keep `{size,
mtimeMs}` from the scan and `statSync` first; read only when they changed. The same token is what W1's fix needs.

### [NIT] N4 engine/storecheck.js:60-64: dead entries and a basename-only match
`board.token` never reaches the check (not `.json`) and `backupkeys` is not in FOLDERS, so both entries do nothing.
`holdsSecret` matches basenames anywhere, so an agent named "remote" (profiles/remote.json) or a named world whose folder
is called "remote" is treated as secret and offered no copy. Safe direction. Fix: key the set on the path relative to
the data root.

### [NIT] N5 docs/browser-checks/render-damaged-files-7248.js: the refused put-back is stubbed with a reason the board can no longer give
The stub answers "it is readable again, so Kosmos left it alone", which `restore()` stopped returning in this commit.
The check still proves the focus behaviour; the copy it shows is stale. Fix: stub one of the current reasons.

### [NIT] N6 server.storecheck-7248.test.js:167-176: the "later" loop in the static order test never finds what it looks for
MEASURED: within the 1200-character window all three of `communityswitch.migrate(`, `wireDefaultHooks`, `undo.sweep`
return -1 (the first is at +2352), so `i === -1 || i > first` always passes. The opener assertion (the start block
begins with the kosmos#7248 comment) is what carries the test, and it does hold. Fix: drop the loop, or search the whole
start block so it can fail.

## Checked and found clean

- Done-when and unit tests (MEASURED): `node --test server.storecheck-7248.test.js` exit 0, 4 tests, 4 pass, 0 fail.
- Remote step-up (MEASURED + REASONED): `server.remotestepup-6595.test.js` exit 0, 30/30. The gate keys on
  `method + ' ' + pathname` (server.js:4763), which matches the added `'POST /api/board/damaged-files/restore'` exactly.
- Browser check (MEASURED): `render-damaged-files-7248.js` exit 0, 28 PASS, 0 FAIL, "all passed", at 1280 and 390;
  focus stays on a refused button and moves to the row on success.
- No copy of a secret store (MEASURED by the new test, REASONED for folders): `goodCopy` returns null before reading
  anything for the listed names and folders, so no `.recovered-` file is made and `restore()` has no `copyAbs`.
- Secret list against the modules (REASONED, read): remote.json, service-keys.json, org-enrollment.json,
  fed-seal-key.json (fedseal.js:49), github-app.json (githubdevice.js:77), codex/grok sign-ins, sendertokens/,
  communitysend/, remote/ are covered. cloudflare.token and the qwen endpoint files are not `.json` or not in the
  scanned folders. federation.json holds link records, no secret (federation.js). Gap: webhooks (W3).
- saveFlushed on the store itself (MEASURED): restored file keeps the damaged file's 0600 mode; the write is
  flushed-temp-then-rename (securewrite.writeSecret with atomicOnly, read).
- A store whose folder is gone (MEASURED, exp1.js): restore refuses with "the good copy could not be read" (the copy
  lived beside it), the row stays listed, nothing is written.
- Unopenable and too-large stores (REASONED, storecheck.js:150-162): named, no copy looked for.
- Copies are lstat'd and must be regular files (REASONED, storecheck.js:117-118).
- Kept copy time (REASONED): `utimesSync` from the temp's own stat after an exclusive copy.
- worldBase failure (REASONED, server.js start block): caught on its own; the data root is still scanned.
- Log lines (MEASURED in exp1.js output): relative names and error codes only, no absolute path.
- Earlier `require.main === module` blocks above the check (REASONED, server.js:46-60, :75): log stamping and tmux env
  only, no store access.
- Em dashes (MEASURED by the browser check's own assertion on the note; this review has none).

Every experiment ran on scratch sandboxes under the session scratchpad with AGENT_WORKFORCE_DATA set; no board was
started; nothing in the worktree was edited except this file.
