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
**`wouldping/` is the only litter I could name confidently.** There may be others; this
does not sweep them, and a future one added under a new name will not be covered.
