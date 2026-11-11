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
- Validation 1: one red, the #1777 guard (the uninstall test compared process.platform with 'win32'): FIXED (a fixed
  darwin platform; the test is skipped off macOS and Linux).

## Change

- engine/geminisettings.js: WROTE_FILE; ensurePrepared records with opts.wroteLedger; recordWrites (under filelock);
  undoWrites.
- engine/create.js: the birth write passes the record path (supportDir()/gemini-wrote.json).
- install/setup.sh: gemini_settings_undo, called before the home is deleted, and in the folder-already-gone branch.
- engine/geminisettings.wrote-8362.test.js (12) and install.uninstall-gemini-8362.test.js (5, the real setup.sh).

## Results

- New tests 11 of 11 and 5 of 5; geminisettings 33 of 33; uninstall-unwire-5998 9 of 9; Gemini creation tests 42 of 42,
  with no record written to this Mac's real data folder.
- Control: with the uninstall's call removed, the main uninstall check fails ("the auth type Kosmos filled in was left").
