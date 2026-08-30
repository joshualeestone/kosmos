# uninstall-litter-1547: our bookkeeping goes, their data stays

Card kosmos#1547.

## What finished looks like
A person who uninstalls Kosmos does not find our ping-logs in their AgentWorkforce
folder, and everything they made is still there, byte for byte.

## The fix
`engine/wouldping.js` writes `wouldping/needs-you.jsonl` into the data folder during
normal running (#1494); the uninstall left it. The six are now removed, **by exact name**.

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
The sweep takes only directories that can be named with certainty as ours, and everything else in the folder is named in a table in setup.sh with a reason. Anything we cannot prove we
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

🛑 **AND THE CORRECTION ABOVE WAS APPLIED TO THE SENTENCE AND NOT TO THE METHOD, WHICH
IS WHY A SECOND REVIEWER FOUND FOUR MORE.** After being told a claim of exhaustiveness had
been written without running a search, I rewrote the claim and STILL DID NOT RUN THE
SEARCH. The next version said the gap was prospective ("a THIRD added later is not
covered") when four more members existed at that moment, including `downloads/`, which
`engine/connect.js` records as costing ~281MB when stranded. So the uninstaller was
removing a JSONL ping log and leaving the largest object in the folder.

⭐ **The reusable form: correcting the wording of an unverified claim produces a
better-worded unverified claim.**

🛑 **AND THE THIRD ROUND MADE THE SAME MISTAKE A THIRD WAY, SO IT IS WORTH THE SPACE.**
This section previously bolded a command as "the fix":
`grep -n "store\.ROOT"`. **That command is blind.** `engine/styles.js:20` and
`engine/trust.js:393` write through an inline `require('./store').ROOT`, and
`engine/create.js:1683` goes through a `supportDir()` helper. Measured:
`grep -c 'store\.ROOT' engine/styles.js` returns **0** for a file that writes there,
against a control of 2 on `engine/wouldping.js`.

⇒ **Round 1 was an unverified claim. Round 2 was better wording for the same unverified
claim. Round 3 pinned a COMMAND that cannot produce the list it was credited with.** The
defect survived two corrections because each correction was aimed at the previous
sentence rather than at the question.

✅ **What actually works: search for the WRITES, not for one spelling of the root.**
`path.join(` with a root-ish first argument, then read each hit. A grep for an
identifier cannot see an identifier that is constructed.

**What is genuinely weak now, and it is smaller:** the sweep names six directories,
derived by that search, and a SEVENTH added later under a new name is not covered. The
count is pinned in both the comment and the test so a member silently dropped is visible,
but nothing fails when a member is never added. A guard that watched `store.ROOT` writers
for unswept names would close it; that is a wider change than this card.

**Out of scope, named rather than silently skipped:** the person's own files in that same
folder (projects, profiles, accounts), which is why this removes six named children and
never the folder itself.
