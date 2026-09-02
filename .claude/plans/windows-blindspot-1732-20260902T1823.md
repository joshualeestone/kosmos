# #1732 - make the Windows-hostile-assumption CLASS visible on an all-macOS fleet

Branch: `windows-blindspot-1732` (agent-workforce / joshualeestone/kosmos)
Card: #1732, the keystone of the four Windows cards (570 / 1112 / 1118 / 1732).
Author: PigeonPete, 2026-09-02.

---

## The problem, restated from measurement (not from the card's assumption)

The fleet is 16 macOS machines; the product branches on `process.platform`. A
behavioural test arm for a win32 branch **cannot fail on a machine that never
takes the branch**, so a green suite here is *no* evidence about Windows. Two
real Windows defects have already been found and each was found by luck, late,
and pinned one-at-a-time:

- **engine/github.js** (#1592): split `AGENT_WORKFORCE_GH_CANDIDATES` on a
  hardcoded `':'`. On Windows a real override is `C:\tools\gh.exe;D:\alt\gh.exe`,
  so the `':'` split returns three broken fragments and gh reports missing with
  no diagnostic. **Found at iteration 45 of a challenge loop.** Fixed to
  `split(path.delimiter)` and pinned in `engine.runnable-not-directory.test.js`
  (lines ~965-972: `assert.match(ghSrc, /split\(path\.delimiter\)/)` +
  `assert.doesNotMatch(ghSrc, /override\.split\('[:;]'\)/)`). On main.
- **engine/store.js** `dataRootFor` (#1510, PR #1529): joined with the *ambient*
  `path` (which off Windows is `path.posix`), so the win32 branch answered with
  forward slashes. Fixed by `joinerFor(platform)` returning `path.win32`/`path.posix`
  and a test that **asks the function about win32 from macOS**. On main.

Both were the SAME shape: a platform-dependent operation using a hardcoded POSIX
constant instead of the platform-aware API, invisible to every POSIX behavioural
arm. #1732 is the meta-card: stop finding these one at a time by luck.

## What I measured that reshapes the card's recommended next step

The card's triage headline (Splinter, 2026-09-01) said the cheapest next step is
an **instrument: one job that runs the existing suite on the Windows box**
(`i-0acbd603679a31361`, t3.medium, stopped, Claw Cabal acct 230470759562,
us-east-2 - reachable; I hold the `kosmos-agent` admin creds + the
`kosmos-windows-test` keypair). **Measured, that instrument is neither cheap nor
sufficient:**

1. **The suite runner is macOS-coupled.** `tools/run-tests.sh` uses `lsof -iTCP`,
   `sysctl vm.loadavg`/`hw.ncpu`, `find -mmin`, a macOS 104-char unix-socket
   assumption, and a `yarn test:shell` arm of dozens of `tools/test-*.sh` bash
   scripts that call `tmux`. **`tmux` does not exist on Windows** - which is the
   very reason my lane (self-reporting without a pane) exists. The shell arm
   cannot run on Windows at all.
2. **Even the node arm cannot find the class.** `node --test engine/*.test.js
   *.test.js` on Windows would (a) red on tests that legitimately need macOS
   (tmux/launchctl) - noise, not Windows bugs - and (b) go **green on the tests
   that hardcode POSIX fixtures**, which is exactly the false-green the card is
   about. A test that hardcodes `'C:\\...'.split(':')`-shaped POSIX fixtures
   tests the POSIX path *even on Windows*. So the instrument, applied to the
   existing suite, proves the card's point and advances it almost none.

⇒ **The durable answer is the card's OWN second recommendation:** *"pin the
SOURCE (assert the Windows branch is taken) rather than the behaviour."* That
needs no box, and there is already a proven per-site template (github.js pin) and
a proven fix-shape (platform-injectable functions: `platform.js`,
`store.dataRootFor`, both `fn(platform = process.platform)`). This plan
generalizes those to the class and adds a net-new capability nothing has today:
**catching the NEXT unknown site at the moment it is introduced**, instead of at
iteration 45.

## Design decision (mine; documented so it can be overturned in a sentence)

**Build a source-coupling ratchet + a class reference. Do NOT build a Windows
suite-runner instrument in this branch.**

- **Rejected: blanket static lint** for hardcoded `:`/`/`. Measured noise is fatal:
  Class-A scan (`.split/join(['":;'])`) = 10 hits, **zero** real path bugs (6 are
  MIME `;`-parsing, 2 are hex/color, 2 are a name-sanitizer that already handles
  `\`). A raw character scan is almost all false positives and missed both real
  bugs (they used other shapes / are already fixed).
- **Chosen: a curated coverage ratchet.** Enumerate the current candidate sites
  (~13 real, after excluding comment lines), classify each in a committed
  inventory with a disposition + reason, and RED on any candidate not in the
  inventory. That is low-noise (the initial set is small and stable) and it fires
  exactly when a reviewer should think about Windows: a new hardcoded coupling
  being added.
- **What would change my mind:** if Josh/Splinter want the actual Windows CI arm
  first, the ordering flips - but that arm requires the suite split into a
  portable node-only subset AND the POSIX fixtures parameterized by platform
  (per store.dataRootFor), which is a larger, separate track. This plan is the
  box-free half that is useful immediately and a prerequisite for trusting a
  future Windows run.

**My weakest premise, named:** a ratchet keyed on enumerated syntactic families
only covers Windows-hostility that TAKES one of those shapes. The known corpus is
n=2 and both fit the enumerated families, but a subtler assumption (`\r\n` vs
`\n` in a file the Windows side parses, case-insensitive-FS assumptions, a
POSIX-only child process) would slip through. The ratchet reduces the surface; it
does not close it. This limit is stated in the reference and on the card, not
buried. (This is the `a-corpus-only-covers-shapes-it-contains` lesson.)

---

## Deliverables

### A. The ratchet test - `engine/windows-coupling-audit-1732.test.js`

A zero-dependency node test that:

1. Enumerates product source: `engine/*.js` + top-level `*.js`, **excluding**
   `*.test.js` and `test-support/`. (Resolved by `fs.readdirSync`, not a shell
   glob, so it is deterministic and Windows-safe itself.)
2. For each source file, strips **full-line** comments (`^\s*//`) and
   block-comment continuation lines (`^\s*\*`) before scanning - this removes the
   4 observed comment-only false candidates. (Heuristic; trailing inline comments
   and slashes-inside-strings may still surface and are handled by classifying
   them in the inventory. Limit documented in the header.)
3. Scans the stripped source for the candidate families:
   - **PATH-delimiter split/join**: `\.(split|join)\(['"][:;]['"]\)` (the github.js
     shape; excludes `path.delimiter`).
   - **filesystem-root literals** used as paths: `'/tmp'`, `'/home/'`, `'/Users/'`,
     `'/var/'` (not inside a URL).
   - **`process.env.HOME`** (undefined on Windows; it is `USERPROFILE` there).
   - **manual `/` path concat**: `\+ *['"]/['"] *\+`.
4. Compares the found candidate set against a committed, in-file **INVENTORY**:
   an array of `{ file, needle, disposition, why }`. Dispositions:
   `benign-mime` | `benign-nonpath` | `sanitizer` | `macos-only-branch` |
   `posix-root-fallback` | `portable-pinned-elsewhere`.
5. **RED conditions** (each with a message naming the file+line and pointing at
   the reference doc):
   - a candidate found in source that is **not** in the inventory (new coupling);
   - an inventory entry whose `needle` is **no longer present** (stale entry - keeps the inventory honest, per `widening-a-vacuous-assertion`).
6. **Explicit positive assertion** for the two known portable sites so this test
   independently red-guards them (belt-and-suspenders with the existing pins):
   - `engine/github.js` contains `split(path.delimiter)` and NOT `override.split(':')`;
   - `engine/store.js` contains `joinerFor(` and uses `p.join(` not `path.join(home, 'Library'`.

Initial inventory (from the measured sweep, ~13 real entries):
| file | shape | disposition |
|---|---|---|
| server.js:1296, 2068 | `.split(';')[0]` on content-type | benign-mime |
| engine/attachments.js:47, 96 | `.split(';')[0]` on content-type | benign-mime |
| engine/unfurl.js:312, 340 | `.split(';')[0]` on content-type | benign-mime |
| engine/unfurl.js:121, 129 | `.split(':')` on hex/color | benign-nonpath (verify) |
| engine/projects.js:1370, 1382 | `.split('/').join('-')...` name sanitizer (handles `\`) | sanitizer |
| engine/projects.js:474 | `[os.tmpdir(), '/tmp']` root set | posix-root-fallback |
| engine/status.js:65 | `[os.tmpdir(), '/tmp']` root set | posix-root-fallback |
| engine/status.js:387 | `TMUX_TMPDIR || '/tmp'` (tmux path) | macos-only-branch |
| engine/machine.js:962 | `process.env.HOME` + `Library/LaunchAgents` | macos-only-branch |

Each entry's `why` records the one-line reason it is not a Windows bug. Before
committing I will re-read unfurl.js:121/129 to confirm the `:` split is a
color/hex parse and not a path (the one entry I have not eyeballed in full).

### B. The class reference - `docs/windows-source-coupling-1732.md`

Concise. Names: the class, the two known instances + their fix-shapes, the
**recommended remediation pattern** (make a platform-dependent function
platform-injectable - `fn(platform = process.platform)` - so a macOS test can
assert the win32 branch, exactly as `platform.js` and `store.dataRootFor` do;
source-pin per github.js only as a fallback when injection is impractical), the
ratchet's job, and its stated completeness limit (n=2 corpus; enumerated shapes
only). This is the artifact a reviewer of Windows-track code reads.

### C. The decision record - a comment on card #1732

After the branch is pushed: post the measured reasons the suite-on-Windows
instrument is not the cheapest phase-1 (macOS-coupled runner; tmux absent; the
existing suite's POSIX-hardcoded fixtures make even a Windows run green for the
wrong reason), what a future Windows-CI phase actually requires, and that the
durable source pin ships instead. Non-closing `Addresses #1732`. This converts
the triage headline into a measured finding for Angel/Splinter/the next reader.

---

## Perturbation proof (the done-condition - run BEFORE trusting the test)

Both known fixes are on main, so both are usable as controls. Restore from a
copy kept OUTSIDE the tree (never `git checkout` inside a perturbation loop - `never-git-checkout-inside-a-perturbation-loop`).

1. **Control 1 (real regression):** revert `engine/github.js` line 45 to
   `override.split(':')`. The audit MUST red (new unclassified `.split(':')`
   candidate AND the positive github.js assertion fails). Restore → green.
2. **Control 2 (synthetic new coupling):** add `x.split('/').join(':')` on a path
   var to one product file. The audit MUST red (unclassified candidate). Remove
   → green.
3. **Control 3 (stale inventory):** delete one real candidate line from source
   without removing its inventory entry. The audit MUST red (stale entry).
   Restore → green.
4. **Negative control:** on unmodified main the audit MUST be green (every
   current candidate is classified). If it is not, an inventory entry is wrong.

Each control must be shown to return the dangerous answer (red) - a control that
only ever passes proves nothing (`a-control-that-did-not-perturb`).

## Checklist

- [ ] Re-read engine/unfurl.js:121/129 to confirm disposition before inventorying.
- [ ] Write `engine/windows-coupling-audit-1732.test.js` (scanner + inventory + positive pins).
- [ ] Run it on unmodified main → green (negative control).
- [ ] Run all three perturbation controls → each reds; restore → green.
- [ ] Write `docs/windows-source-coupling-1732.md`.
- [ ] Full pre-PR validation: `bash tools/run-tests.sh` green.
- [ ] `/challenge-loop` to convergence → proof file.
- [ ] `/create-pr`; self-merge on green (beta ruling); post decision record on #1732 (non-closing).

## Out of scope (named, not silently dropped)

- The actual Windows-CI arm / starting the EC2 box (a later phase; requires a
  portable node subset + platform-parameterized fixtures first).
- Fixing any *new* Windows bug this ratchet surfaces - that is a separate card
  per instance (the ratchet's job is to make it visible, per one-finding-not-three).
- #570 phase-2 (network bind + remote token issuance) and #1118 (native window) - sibling cards, not this one.
