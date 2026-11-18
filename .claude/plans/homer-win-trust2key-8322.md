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
