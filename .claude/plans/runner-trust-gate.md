# runner-trust-gate: auto-trust the ON-DISK folder spelling (#2129 / 0.6.42 keystone #5)

## Problem
Josh's 0.6.42 fresh-macOS re-test: every NEW agent (Claude AND codex) stalls on the
runner's own first-run directory-trust menu, unanswerable from the Kosmos chat box
(Enter = No/exit = agent dies). Auto-trust regressed.

## Root cause (measured, not assumed)
The auto-trust write keyed the trust on fs.realpathSync(dir), but the RUNNER looks up its
cwd's ON-DISK canonical spelling. Measured on macOS:
  - fs.realpathSync resolves symlinks but does NOT case-fold: realpathSync('~/work/x') on a
    disk holding '~/Work/x' returns the LOWERCASE input.
  - process.cwd() after chdir('~/work/x') returns '~/Work/x' (the on-disk case) -- what a
    Node runner (Claude Code) looks up; codex's std::fs::canonicalize does the same.
So on a fresh user whose on-disk worker root is '~/Work' while the code hardcodes lowercase
'~/work' (workersDir), the realpath key (lowercase) missed the runner's capital lookup and
the menu fired -- for BOTH runners. On the dev box realpath==on-disk case, so it shipped
green; no test caught it (every trust test realpath's its sandbox, and none pinned the key
to the runner's actual process.cwd lookup).

## Fix (auto-trust PRIMARY)
A canonicalOnDisk(dir) helper (readdir-walk that recovers the stored case + unicode form,
after realpathSync resolves symlinks) -- this equals what the runner looks up. trust.js
keys trustFolder on canonicalOnDisk (single key, so the #169 undo contract is UNCHANGED);
create.js trustCodexFolder + forgetCodexFolder key on it too (removal leaves the folder on
disk, so it resolves to the same stored spelling). Test pins the key to process.cwd() (the
runner lookup) with a control proving realpathSync missed; case arms guarded on a
case-insensitive FS.

## First fix was WRONG, caught by the loop
The initial dual-key (raw + realpath) approach was reverted: realpathSync doesn't case-fold,
so it never produced the capital spelling -- it would have merged green and failed Josh's
next test (the recycling loop). The iter-1 challenge review + a direct measurement of
realpathSync/process.cwd caught it before shipping.

## One-click fallback (companion)
Insurance vs any residual (a spelling canonicalOnDisk still misses, or a non-spelling
cause): a "trust & restart" button that writes trust for the agent's folder and restarts it.
Both runners.

## Verify bar
A new agent usable on a real fresh macOS user, zero hand-answered terminal trust menu.
