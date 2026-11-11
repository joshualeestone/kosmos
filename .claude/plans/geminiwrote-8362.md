# geminiwrote-8362: uninstall puts back the Gemini settings Kosmos filled in

Card: joshualeestone/kosmos#8362 (follow-up to #8361). Off main.

## Finished looks like

After an uninstall on Mac or Linux, the person's own Gemini settings no longer hold the three values a Gemini agent's
birth filled in (security.auth.selectedType = gemini-api-key, general.enableAutoUpdate = false,
general.enableAutoUpdateNotification = false), unless the person has since changed one, which stays and is named. The
person's other settings and the hooks are untouched, and the uninstall says what it did, or names the record when it
could not.

## Decided

Record what Kosmos writes, and undo only that. ensurePrepared records each value it fills in (file, dotted key, value)
in gemini-wrote.json in Kosmos's data folder, after the save. undoWrites removes a recorded key only when the file still
holds exactly the recorded value (strict equality), removes objects the removal leaves empty, keeps and names a changed
value, leaves and names (and keeps recorded) a file it cannot read or save, and forgets a file that is gone. Recorded
for every account, default and named: both homes are folders a person can run gemini against by hand.

Rejected: leaving them and saying so (easy to miss, and the person's gemini stays on API-key sign-in with no key);
removing the values whenever they equal ours (they are indistinguishable from a choice of the person's); a marker
inside settings.json (Gemini owns that schema).

The Mac/Linux uninstall (install/setup.sh gemini_settings_undo) runs undoWrites through the installed engine, not a
copy inside setup.sh as the Claude unwire does: the record is written only by an engine that has undoWrites, and an
install only moves forward, so the installed engine at uninstall has it. Without node or the engine (a partial install,
or a re-run after the folder went) it names the record instead.

Weakest premise: installs that wrote the values before this change have no record, so their uninstall still leaves them.
The same holds for a value whose record failed at birth (create.js does not report recorded:false). And a second
Kosmos install on the same account shares ~/.gemini: uninstalling the install that recorded a value takes it out even
if the other's agents still use it (the uninstall says so, by file). And a value the person sets again themselves
after Kosmos wrote it, to the same value (Gemini's own /auth picker writes exactly gemini-api-key), still reads as
Kosmos's and is taken out at uninstall: equality cannot tell a re-chosen value from ours, and the uninstall names the
file it put back.
Second: "an install only moves forward" (a downgrade to an engine without undoWrites prints the record's path, which
is the honest fallback, not a silent miss).

Would change my mind: Gemini rewriting the values in settings.json on its own, which would break "still exactly
what we wrote".

## Not in this slice

- The Windows uninstall reading the record: engine/win32uninstall.js is being changed under #8361 (another agent);
  noted there.
- The Mac/Linux uninstall does not take Kosmos's hooks out of the Gemini settings (only Claude Code's), and it removes
  the data folder's bin/, where their bridge lives, so they then run a deleted script. Carded as #8364 (mine, next).

## Challenge loop

- Iteration 1 (opus): 3 WARNINGs. The type check's fixture ('false') could not catch loose equality: FIXED (0).
  A file that cannot be reached was dropped as if gone: FIXED (only ENOENT/ENOTDIR are gone; else left and named),
  with a check. The hooks left pointing at a deleted bridge: carded #8364. NITs: ensurePrepared's doc names
  wroteLedger: FIXED; the re-run check asserts the file is unchanged: FIXED; recorded:false is not reported by
  create.js, the node step has no watchdog (as its Claude sibling), removeAt removes a person's own empty object,
  the tests run setup.sh with bash: noted.
- Iteration 2 (sonnet): 2 WARNINGs. A gemini saving the file between the undo's read and write would lose its save:
  FIXED (re-read just before the write; changed means left and named; the two are still not one step). removeAt
  also removes an empty general or security object the person had before Kosmos wrote into it: DEFERRED, by design
  (an empty object and an absent one read the same to gemini). NIT: a malformed record entry is replaced, not spread:
  FIXED. Other NITs noted (the record's name is written twice, in JS and setup.sh, guarded by the install test).
- Iteration 3 (opus): 2 WARNINGs. An undo that stopped partway lost what it had said and claimed nothing was put
  back (the capture also dropped a failed node's output): FIXED (the output is kept, its lines are said, and the note
  says it did not finish), with a check. A record that fails at birth (the lock busy past 2 s, an unreadable record)
  is lost, and a later birth finds the values present and records nothing: DEFERRED, a known gap (below); treating
  "holds exactly our value" as ours is the indistinguishability this card exists to avoid. NIT: a second Kosmos
  install on the same account shares the person's file, so uninstalling the one that recorded can take out a value
  the other's agents use: a known gap (below).
- Iteration 4 (sonnet): no new findings (its two WARNINGs repeat iteration 3's deferred record gap and iteration 2's
  documented re-read residual). Converged; the final validation passed on f87d5b6dda.
- Rebased onto main after #8361 merged (it also changed geminisettings.js: hookpaths.js). One conflict, the requires,
  both kept. The uninstall test's sandbox engine then lacked hookpaths.js, so the undo could not load and the main
  check went red: FIXED (the test copies geminisettings.js's require closure, with a control).
- Iteration 5 (opus): 1 new WARNING: a value the person re-chose to the same value is taken out: DEFERRED, accepted
  and named in the weakest premise (no record can tell it apart). The node step's missing watchdog: a repeat of the
  noted iteration 1-3 item. NITs FIXED: geminisettings' header said it had no engine dependencies; the "left" message
  now covers every reason; the fallback no longer names sign-in when only updates were recorded; create.js says the
  Windows uninstall does not read the record yet; this plan's test count. Validation on the rebased branch passed
  (11e2a39b48) before these.
- Validation 1: one red, the #1777 guard (the uninstall test compared process.platform with 'win32'): FIXED (a fixed
  darwin platform; the test is skipped off macOS and Linux).

## Change

- engine/geminisettings.js: WROTE_FILE; ensurePrepared records with opts.wroteLedger; recordWrites (under filelock);
  undoWrites.
- engine/create.js: the birth write passes the record path (supportDir()/gemini-wrote.json).
- install/setup.sh: gemini_settings_undo, called before the home is deleted, and in the folder-already-gone branch.
- engine/geminisettings.wrote-8362.test.js (13) and install.uninstall-gemini-8362.test.js (7, the real setup.sh).

## Results

- New tests 13 of 13 and 7 of 7; geminisettings 33 of 33; uninstall-unwire-5998 9 of 9; Gemini creation tests 42 of 42,
  with no record written to this Mac's real data folder.
- Control: with the uninstall's call removed, the main uninstall check fails ("the auth type Kosmos filled in was left").
