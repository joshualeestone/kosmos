# Plan: engine dataRootFor refuses a non-absolute data root (#1820)

## Problem

#1798 fixed the shell installer's uninstall (DELETE) path so an empty `HOME` and
a relative `AGENT_WORKFORCE_DATA` can no longer steer `rm`. The engine's
`dataRootFor` in `engine/store.js` has the same two holes on the READ/WRITE path
(confirmed against `origin/main`):

- a relative `AGENT_WORKFORCE_DATA` override yields a cwd-relative data root;
- an empty `home` falls through to a relative platform path
  (`Library/Application Support/AgentWorkforce` on Mac; `AppData/Roaming/AgentWorkforce`
  on win32 when `APPDATA` is also unset).

A relative data root means profiles/avatars/settings are read and written under
whatever the process cwd happens to be that run. Lower stakes than #1798 (a
misplaced read/write, not a deletion) and both inputs are unlikely in the wild,
which is why #1798 fixed only the delete path.

## Approach

Guard the RESULT, not each branch (#1798's "the refusals are on the result").
One `p.isAbsolute(root)` check on the final answer catches all three
relative-producing inputs and any future branch, judged by the joiner for the
platform asked about. Refuse (throw) rather than silently absolutize: a
misplaced read/write is invisible; a thrown error names both offending inputs.
Keep the engine and shell derivations agreeing on the refuse posture.

## Decisions

- **Refuse, not absolutize.** Absolutizing to cwd is arbitrary and still wrong;
  throwing surfaces the broken input loudly. Normal operation never trips it
  (`root()` passes an absolute homedir; every fixture uses an absolute sandbox
  path), so there is no regression risk for real use.
- **Guard the final result, not each branch.** Repeating the check per branch
  would miss the next branch someone adds; one check is enforced everywhere.

## Tests

`engine/store.dataroot-1820.test.js`, auto-wired via the `engine/*.test.js`
glob. Both arms verified: the 4 refuse assertions red against `origin/main`'s
unguarded `dataRootFor` and green on the fix; 4 positive controls stay green on
both, so a throw-everything guard could not pass. Full engine suite: 1919 pass.

## Out of scope (follow-up)

`engine/remote.js` and `engine/you.js` read `AGENT_WORKFORCE_DATA || store.ROOT`
directly, bypassing `dataRootFor`, so a relative override still scatters those
two files' state. Pre-existing, not a regression from this diff; a follow-up
card tracks it (the same relation this card has to #1798).
