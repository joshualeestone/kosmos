# storecheck-7248 review, round 3 (blind, CTO lens)

Branch `storecheck-7248` at bd4dab9440, diffed against origin/main. Three commits, 11 files. Focus on the round 2 commit.

Counts: 0 BLOCKER, 0 WARNING, 3 NIT.

Round 2's fixes hold. No path found where an older copy goes over newer valid data, and no path where a sensitive
store's copy is kept or offered. The aside copy IS briefly at the umask mode (answer to the direct question: yes, written
then chmodded), but inside a data root the board forces to 0700, so no other user can reach it; hence NIT.

## Findings

### [NIT] N1 engine/storecheck.js:233-235: the aside copy is created at the umask mode and only then chmodded
`store.saveFlushed(aside, now)` takes its mode from `modeOf(aside)`, which is null for a new file, so writeSecret runs
with `umaskDefault`: the temp is opened at 0666 less the umask, renamed to the aside name, and only then does
`fs.chmodSync(aside, lst.mode & 0o777)` narrow it.
MEASURED (scratch sandbox, umask 022, `unsent-lines.json` at 0600, NUL, with a `.bak`): a hook on `fs.renameSync` saw the
aside temp at mode 644 at rename, then the final aside at 600. If the chmod throws (a foreign-owner or odd mount), the
store is not restored and the aside stays at 644 for good.
Why only a NIT (MEASURED + REASONED): boardauth.js:354/371 forces `store.ROOT` to 0700, and the real root here is
`drwx------`, so another uid cannot traverse to the file in the window. It matters only if the root were ever looser.
Fix: one call that creates at the right mode: `require('./securewrite').writeSecret(aside, now, lst.mode & 0o777,
{ atomicOnly: true })` (the temp is opened `wx` at that mode and fchmodded on the fd), and drop the chmodSync. On
Windows pass null with `umaskDefault`, as `modeOf` does.

### [NIT] N2 engine/storecheck.js:167 (`holds` lookup): HOLDS is matched by basename at any depth, so a store in a folder can be described as a root store
Round 2 keyed the sensitive list on the path relative to the data root, but the words still come from
`HOLDS[path.basename(file)]` first. MEASURED (same sandbox): an agent named "remote" with a damaged `profiles/remote.json`
is reported, in board.log and on the page, as "profiles/remote.json is empty (it holds your Kosmos+ settings)". The same
happens for agents named settings, projects, policy, webhooks and so on. Safe in effect (that file is correctly NOT
treated as sensitive, and a copy is correctly offered), but the person is told the wrong thing about what the button
puts back.
Fix: use HOLDS only when `path.dirname(file) === store.ROOT` (or the base for worlds.json), else the FOLDERS words.

### [NIT] N3 engine/storecheck.js:228-229: "still damaged" is checked, "still the same damaged file" is not
`restore()` refuses only when the store now parses. A store that changed since start but is still not JSON (the person
hand-edits settings.json to fix it and leaves a stray comma; a second process writes it non-atomically) is replaced by
the older copy. Nothing is lost (the current bytes go to the `.damaged-` aside, MEASURED for the plain case), and
`current()` keeps saying "Kosmos has not changed it", which is then untrue. REASONED; rare.
Fix: the scan already records `size` and `mtimeMs`; refuse when either moved, with the same "saved since Kosmos started"
reason. That also lets `current()` use one rule for every size instead of a 1 MB split.

## Checked and found clean

- Unit tests (MEASURED): `node --test server.storecheck-7248.test.js` exit 0, tests 4, pass 4, fail 0.
- Browser check (MEASURED): `render-damaged-files-7248.js` exit 0, 28 PASS, "all passed".
- Saved-over store refused (MEASURED, sandbox): settings.json empty at start with a `.prev`, then written `{}`: restore
  returns `{ok:false, why:"it has been saved since Kosmos started, so Kosmos left it; the copy is kept at
  settings.json.prev"}` and settings.json is still `{}`. The page (read, web/index.html paintDamagedFiles) shows no
  button when `savedOver`, only where the copy is kept.
- Gone and linked stores (REASONED, read storecheck.js:225-226): `lstatSync` failure refuses with "no longer there";
  `isSymbolicLink()` refuses. Nothing is written in either case, so a removed store is not brought back.
- Sensitive stores (MEASURED + REASONED): `webhooks/webhooks.json` empty with a good `.kosmos-1-2-3.tmp` beside it: no
  `.recovered-` file was made, the row has `backup:null, secret:true`, and restore refuses "there is no good copy of it".
  `profiles/remote.json` is not treated as sensitive (correct, relative-path keying works). `goodCopy` returns before
  reading any copy for a sensitive path, and `restore` needs `copyAbs`, which is only set from `goodCopy`, so there is no
  second route to a kept or offered copy. The listed files are all joined directly to `store.ROOT` in their modules
  (agentpermission.js:30, orgenroll.js:41/270, fedseal.js:49, servicekeys.js), so root-level keying matches them.
- Stores not on the list (REASONED): connect.json holds sign-in flow state (connect.js:342-358), no secret.
  federation.json holds link records; the coordinator enforces access. agent-token-only.json narrows agents but has no
  Kosmos writer (sendertoken.js:987, read-only callers), so Kosmos never makes a `.kosmos-` temp of it to offer. For the
  restriction stores (policy, limits, removed), the damaged state reads as empty, so any older copy is no looser than
  what the person already has.
- Large stores (MEASURED): a 2 MB unreadable limits.json with a `.bak`: `current()` reported `savedOver:false` from size
  and time, and restore put the copy back with the damaged one kept aside.
- Aside naming (REASONED): `<file>.damaged-<iso>` does not end in `.json`, so the scan and the profile listers that filter
  on `.json` (backuptick.js:218, feedbacksend.js:166) do not pick it up, and `goodCopy` never offers it.
- Restore is synchronous from read to rename, so no in-board writer can interleave (REASONED); the cross-process residual
  is documented in the code.
- Remote step-up entry and routes (REASONED, read): unchanged since round 2, which measured them.
- mobile-shots.js scenario, gated.txt and README rows (read): stubbed on the way to the page, nothing written.
- No em dash in this file.

Every experiment ran on a scratch sandbox under the session scratchpad with AGENT_WORKFORCE_DATA set; no board was
started; nothing in the worktree was edited except this file.
