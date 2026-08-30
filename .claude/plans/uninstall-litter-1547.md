# uninstall-litter-1547: our bookkeeping goes, their data stays

Card kosmos#1547.

## What finished looks like
A person who uninstalls Kosmos does not find our ping-logs in their AgentWorkforce
folder, and everything they made is still there, byte for byte.

## The fix
`engine/wouldping.js` writes `wouldping/needs-you.jsonl` into the data folder during
normal running (#1494); the uninstall left it. It is now removed, **by exact name**.

🛑 **Named, not globbed, and that is this file's own rule.** Every other `rm` in
`install/setup.sh` proves ownership first. A pattern-swept data folder is exactly how an
uninstaller deletes the thing it promised to keep.

## The control that matters more than the fix
"`wouldping/` is gone" is trivially satisfied by deleting the whole data folder, which is
the catastrophe this change must not become. **Every arm that asserts our litter is gone
also asserts a seeded user file survived byte for byte**, and both directions are proven:
removing the sweep reds it, and over-deleting the data root reds it too.

## Scope
**In:** `install/setup.sh`'s uninstall, plus its test.
**Out:** any other app-written file. The card says "and any similar app-written files";
I removed only the one that can be named with certainty. Anything we cannot prove we
wrote is left alone and named, per the file's header rule.

## Weakest premise
🛑 **THE ORIGINAL PREMISE HERE WAS FALSE AND A REVIEWER CAUGHT IT.** It read
"`wouldping/` is the only litter I could name confidently". `engine/liveness.js:32` is
`path.join(store.ROOT, 'liveness')`, the same class, nameable with exactly the same
confidence, and I had not looked. Both are now swept.

⭐ **The correction worth keeping is not the second directory, it is that a sentence
claiming a search was exhaustive was written without running the search.** "The only one
I could name" describes my recall, and it reads to anyone else as a property of the
codebase.

**What is genuinely weak now, stated as a rule rather than a list:** the sweep names two
directories, and a THIRD added later under a new name is not covered. The test pins the
rule the list encodes (Kosmos's own bookkeeping under `store.ROOT`, regenerated on next
run) so a future reader can decide correctly, but nothing FAILS when a new one appears.
A guard that watched `store.ROOT` writers for unswept names would close it; that is a
larger change than this card and is not attempted here.

**Out of scope, named rather than silently skipped:** the person's own files in that same
folder (projects, profiles, accounts), which is why this removes two named children and
never the folder itself.
