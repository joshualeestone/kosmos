# #8322: record the second trust key written while the main key was already true

## Done when
1. The ALREADY-true arm in engine/trust.win32-key-2281.test.js records the second key under the agent's name and a removal takes back only that key.
2. Another agent's entry, another account's config, and the person's main key are never touched (tests).
3. CI green, with the windows job running the new arms.

## Decided
- A separate record file (trust-also-writes.json), not an `also` field on trust-writes.json. Rejected: the field, because an engine from before this change reads every trust-writes.json entry as "the main key is ours", so a rollback to it followed by a removal would delete the person's own main line.
- Keyed by agent name, written only by callers that know it (creation, Windows launch and resume). Never found by searching records for a key (the #4260 attempts that did grew records owning another agent's line).
- The first write of a key is kept (it holds what was there before Kosmos); a different key replaces it.
- forgetAlso never touches the main key; a malformed or no-longer-true second entry is left, ok, so a removal step never stays red forever.
- Weakest part: two agents sharing one working folder each record the same short key; the first removal takes it back while the other is still running. Running sessions are unaffected and the other agent's next launch writes and records it again. Would change my mind: evidence that agents commonly share a cwd on Windows.

## Review round 1 (blind, 0 BLOCKER, 5 WARNING, 3 NIT)
Fixed: W1 (record names the config it was made against; forgetAlso leaves a line in another file), W3 (a gone or empty config is nothing of ours: ok, no red-forever step), W5 (behavioural remove.test.js arms: real, dry run, no record; mutation-checked), N1 (the forgettable:false arm now runs against a line it could take), N2 (creation drops a previous incarnation's entry BEFORE the agent starts, so the first launch's record survives).
Deferred to the card:
- W2: after a rollback to an engine older than this, a removal there leaves the also-record and a recreate there does not drop it; rolling forward and removing could then take back a line that is no longer ours. Needs an incarnation marker (birth id) on the entry.
- W4: the other trustFolder callers (create.js trust-and-restart sweep, setAccount; worldstarts.js) can still write a second key and record nothing. Same leftover as before this change, inert.
- N3: first-write-kept erases a later false (inert); dropAlsoRecord drops by name, not key; a re-aliased subst letter.

## Review round 2 (blind, 0 BLOCKER, 1 WARNING, 2 NIT): all fixed
- W-a: forgetAlso now edits the file the record names (the launch task's CONFIG()), under that file's lock, never the board's CONFIG(); a mismatch used to report ok and drop the record over a line still there.
- N-a: a record entry with no absolute `config` reads as null (the line stays).
- N-b: remove.test.js arm with the record against another file; mutation-checked (taking back in the board's CONFIG() fails it).

## Review round 3 (blind, 0 BLOCKER, 2 WARNING, 3 NIT): converged, rest to the card
All five leave at most an inert leftover line or record, or harden against a record only the user's own account can write:
- W1: first-write-kept compares the key, not the file; with creation (board) and launch (task) on different configs, one file's line can be left. Fix later: one entry per (name, config).
- W2: a failed start takes back the in-memory short key but does not drop an also-record the first launch already wrote (harmless: the take-back finds nothing; dropped on name reuse).
- N1: a recorded config path is any absolute path; harden by requiring a .claude.json name and refusing UNC.
- N2: a corrupt also-record is moved aside silently (same as the main record).
- N3: the dry-run removal arm could also assert the step is reported.
