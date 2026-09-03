# supportdir-win32-2039 -- collapse create.js's second data-root formula to the one win32-aware source (#2039)

## The bug
`engine/store.js` has the correct, win32-aware data-root derivation (`dataRootFor`,
which `store.ROOT` reads). `engine/create.js` `supportDir()` carried its OWN second
copy of the formula with NO win32 branch, so on the first real Windows test it built
a literal Mac data path (`C:\Users\x\Library\...`) on an NTFS disk. store.js's own
comment already warns about exactly this hazard, next to the copy that got it right.

## The fix (create.js only)
`supportDir()` now returns `store.dataRootFor(process.platform, homeDir(), process.env)`
-- the ONE win32-aware formula, not a second copy. This is the card's explicit ask:
adding a win32 branch to create.js's copy would fix the instance and leave the class
open (the next platform difference gets added to one copy and missed at the other).

- The `AGENT_WORKFORCE_DATA` (sandbox) and mac results are byte-identical to before;
  win32 is the only behaviour that changes, and it changes to correct (roaming
  `%APPDATA%\AgentWorkforce`).
- create's own `homeDir()` is passed, so `AGENT_WORKFORCE_HOME` still applies.

## Grep for a THIRD copy (Splinter's instruction: two copies is a pattern, not a pair)
Searched the whole tree for the data-root formula. Result: there is NO third copy of
the AgentWorkforce-data-root formula. `store.js:95` is the one source; create.js was
the only duplicate. Every other `Application Support` hit is a comment or a
description string, not a live formula.

⚠️ The grep DID surface adjacent, same-CLASS win32-less mac paths -- but each is a
DIFFERENT concern and a different Windows mechanism, so they are separate follow-ups,
NOT this card's scope:
- `create.js:197 agentsDir()` -> `~/Library/LaunchAgents` (macOS launchd; Windows uses
  a different launch mechanism entirely -- part of the Windows launch story, not a path
  tweak).
- `engine/machine.js` -> `/Applications` + `~/Applications` (mac app discovery).
- `engine/runners.js` -> `~/.local/share/kosmos`, `~/.local/bin` (install base / CLI path).
Each wants its own card under the Windows-port effort; folding them here would mix
unrelated mechanisms.

## Test, and why it is source-pinned
`supportDir` reads `process.platform`, so its WINDOWS output cannot be asserted from a
Mac -- which is precisely how this defect survived. So the guard is two-part:
- behavioural: `supportDir()` equals `store.dataRootFor(process.platform, homeDir(),
  process.env)` across the env that decides the root (pins the delegation args + the
  sandbox leaf).
- structural (the load-bearing one): `supportDir`'s source delegates to
  `store.dataRootFor` and carries NO `path.join(...)` of its own. A re-added copy has
  `path.join`; the delegating version does not. Proven non-vacuous: reverting to the
  old copy passes the behavioural test on a Mac (it cannot see win32) and REDS the
  source-pin -- exactly the state this guards.
- win32 correctness itself is `store.dataRootFor`'s, already proven in
  `store.dataroot-570.test.js` (`dataRootFor('win32', ...)`), and now inherited.

`supportDir` is exported so the behavioural half can call it (repo convention:
chat.js exports `cleanMessage`/`storeText` for tests).

## Verification
- engine/create.supportdir-win32-2039.test.js 2/2; create.test.js + store.test.js green (155/0 together).
- Real-Windows verification of the resulting `%APPDATA%` path is for the Windows
  verification agent (I cannot run Windows); the derivation is store.dataRootFor's,
  which store's suite already covers for win32.
