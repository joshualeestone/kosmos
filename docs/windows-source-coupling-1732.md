# Windows source-coupling: the class, and how we keep it visible (#1732)

This fleet is macOS-only; the product branches on `process.platform`. A
behavioural test arm for a win32 branch **cannot fail on a machine that never
takes the branch**, so a green suite here is *no* evidence about Windows. Worse,
a test that hardcodes a POSIX fixture exercises the POSIX path **even when run on
Windows** - so running the suite on a real Windows box would still not catch this
class. This document names the class, records what we know, and points at the
mechanism that keeps it from growing silently.

## The known instances (the corpus)

All were found by luck, late, and pinned one at a time. Two shapes so far:
a platform-dependent operation using a hardcoded POSIX constant instead of the
platform-aware API (the delimiter/root family), and an `fs.constants` open flag
that is **undefined on win32** and so silently vanishes when OR-ed in (#1777).

| # | site | the bug | fix-shape |
|---|---|---|---|
| #1592 | `engine/github.js` | split `AGENT_WORKFORCE_GH_CANDIDATES` on a hardcoded `':'`. On Windows a real override is `C:\tools\gh.exe;D:\alt\gh.exe`, so `':'` yields three broken fragments and gh reports missing with no diagnostic. **Found at iteration 45 of a challenge loop.** | `split(path.delimiter)` (`:` on POSIX, `;` on Windows) + a source-pin. |
| #1510 | `engine/store.js` `dataRootFor` | joined with the **ambient** `path` (which off Windows is `path.posix`), so the win32 branch answered with `/`. | `joinerFor(platform)` → `path.win32`/`path.posix`, and a test that **asks the function about win32 from macOS**. |
| #1761 / #1776 | `engine/securewrite.js`, `engine/sendertoken.js` | an `O_NOFOLLOW` symlink guard OR-ed into an `open()`. `O_NOFOLLOW` is **undefined on win32**, and `X | undefined === X`, so the guard **evaporates on the one platform the module ships to** - with no error and, worse, no macOS signal, because on macOS the kernel enforces the refusal via the same flag so the call has *no observable effect there at all*. | capture the maybe-undefined flag undefined-safe (`(NOFOLLOW || 0)`) **and** make the protection platform-INDEPENDENT - a `refuseSymlinkTarget` hand check that runs even when the kernel flag is absent, pinned behaviourally so its presence is testable on macOS. |

**A third instance, `engine/discover.js` `scanRootsFromEnv` (#1777),** was the
delimiter family at a *second* call site: it splits `AGENT_WORKFORCE_SCAN_ROOTS`
on `path.delimiter` correctly, but had no pin. It needed no new one-off pin -
the ratchet below scans every `engine/*.js`, so a regression of that site to a
hardcoded `':'` already reds (measured). That is the ratchet composing, which is
the whole point of #1777: a fix at one site should not leave the next site as
unguarded as the first.

## The recommended fix-shape for a real hit

**Make the platform-dependent function platform-INJECTABLE** - `fn(platform =
process.platform)` - so a macOS test can assert the win32 branch by asking about
it. This is already the org idiom:

- `engine/platform.js` - `isSupported(platform = process.platform)`,
  `describe(platform = process.platform)`, pure.
- `engine/store.js` - `dataRootFor(platform, ...)` + `joinerFor(platform)`.

Injection is strictly better than a source-pin: it **exercises** the win32
branch and asserts the **result**, so it also catches a logic bug in that branch,
not just the spelling of one line. Use a **source-pin** (assert the source uses
the portable API and not the hardcoded form, as `engine.runnable-not-directory.test.js`
does for github.js) only as a fallback when injection is impractical.

Do **not** reach for a hardcoded separator/root at all:

| instead of | use |
|---|---|
| `.split(':')` / `.join(';')` on a PATH-like value | `path.delimiter` |
| `a + '/' + b`, `'/tmp/...'`, `'/Users/...'` | `path.join`, `path.sep`, `os.tmpdir()`, `os.homedir()` |
| `process.env.HOME` | `os.homedir()` (Windows sets `USERPROFILE`, not `HOME`) |
| a hardcoded `'\n'` written to a file the Windows side re-parses | `os.EOL`, or normalize on read |

This table is remediation **advice**. It is NOT the same as what the ratchet
auto-scans: five families are scanned - `path-delimiter-literal`,
`fs-root-literal`, `env-home`, `env-home-destructure`, and
`fs-const-platform-flag` (an `fs.constants` open flag that is undefined on
win32 - `O_NOFOLLOW`/`O_SYMLINK`/`O_NONBLOCK` and the rest of the win32-undefined
set; the always-defined flags are deliberately not matched). `env-home-destructure`
was added as a #1732 follow-up to close the documented destructure gap
(`const {HOME} = process.env`); it has a low-noise signature because extracting
HOME from `process.env` is almost never benign. Manual `a + '/' + b` concat and
hardcoded `'\n'` EOL are advice here but not scanned (concat is dominated by
legitimate URL building; EOL has no low-noise syntactic signature - and a sweep
for the file-read `readFileSync(...).split('\n')` shape found its one product-source
site, `codexsession.js`, already `\r`-safe because its lines are consumed only by
`trim()` and `JSON.parse`, both of which tolerate a trailing `\r`). Use the
portable form anyway.

## The ratchet: `engine/windows-coupling-audit-1732.test.js`

A curated coverage ratchet - **not** a blanket lint (measured: a raw
hardcoded-`:`/`/` scan is nearly all false positives and missed both real bugs).
It enumerates the current candidate sites in product source, classifies each in
an in-file `INVENTORY` with a disposition + one-line reason, and:

- **reds when a file's count of family-matches exceeds what the inventory
  accounts for** (classification is count-based per `(file, family)`, so a new
  coupling reds even when appended to a line that already carries a classified
  one) - it fires when someone **adds** a hardcoded platform coupling, which is
  when a reviewer should be thinking about Windows;
- **reds on a stale inventory entry** - a classified site removed or reshaped - so the inventory cannot rot into a vacuous pass;
- carries **positive pins** for the known-fixed sites (github.js uses
  `path.delimiter`; store.js uses `joinerFor`; securewrite.js ORs `O_NOFOLLOW` in
  undefined-safe as `(NOFOLLOW || 0)`), so it independently red-guards a
  regression.

Every arm is perturbation-proven: reverting the github.js fix reds the coupling
arm **and** the github pin; a synthetic new `.split(':')` or `fs.constants.O_SYMLINK`
reds the coupling arm; a synthetic `const {HOME} = process.env` reds the
`env-home-destructure` arm; neutralizing a classified site reds the stale arm;
dropping securewrite's `(NOFOLLOW || 0)` guard reds the #1776 pin; the unmodified
tree is green.

### What the ratchet does and does not claim (read this before trusting it)

The ratchet **prevents NEW instances of KNOWN shapes**.
It **claims nothing about finding existing instances** already in the tree, and
**nothing about catching unknown shapes** - a subtler Windows assumption (`\r\n`
vs `\n` in a file the Windows side parses, a case-insensitive-filesystem
assumption, a POSIX-only child process, a shell script that calls `tmux`) does
not take one of the enumerated syntactic families and slips straight through. It
reduces the surface; it does not close it.

There is also accepted **friction** in the other direction. Two shapes recur:

- `path-delimiter-literal` also matches `.split(';')` (MIME content-type parsing)
  and `.split(':')` (IPv6 hextets), which are the common non-path idioms - most
  of the current inventory rows are exactly these. So a new content-type or IPv6
  parse added to a scanned file reds and needs a one-line benign row. This is the
  main source of routine friction, and it slightly dilutes the "fires exactly
  when a reviewer should think about Windows" claim - a reviewer classifies these
  as benign in a few seconds.
- `fs-root-literal` keys on a root segment **immediately after the opening
  quote** (`'/var/log'`, `"/Users/x"`), so a literal whose root starts the string
  reds and has to be classified benign. It is deliberately quote-adjacent: a
  `/var/` in the MIDDLE of a string (a URL like `'https://h/var/data'`) does NOT
  match, which keeps URL false-reds out. The same adjacency is a small coverage
  edge in the other direction - a real POSIX root not at the string start
  (`'--prefix=/home/user'`) is not caught - accepted as low risk, since a
  hardcoded root almost always begins its literal.

That is the deliberate cost of a curated ratchet over a parser; a one-line
inventory row clears each.

The family regexes catch the common spellings (a split/join on a quoted `:`/`;`
with optional whitespace or a limit arg; `process.env.HOME` by dot or bracket
access, and now the `const {HOME} = process.env` **destructure** via the
`env-home-destructure` family). A separator held in a **variable** is still not
matched - a variable can hold anything, so a regex for it is nearly all
false-red; it stays part of the enumerated-shapes floor, not a separate promise.

**Completeness sweep (#1732 follow-up).** The product-source scope was swept for
every named-but-unscanned shape, to record what "find all instances" actually
turned up: the HOME **destructure** (now a family, no product instance today);
**bare-command spawn** and **executable-extension** (`node`/`gh`/`git`/`claude`
by bare name) - none; **hardcoded POSIX bin paths** - only `remove.js` /
`connect.js` / `update.js` calling `tmux` / `launchctl` / `/bin/sh`, which are
macOS-only MECHANISMS the Windows agent replaces entirely (the #570/#2042
lifecycle lane), not the portable-constant class; **EOL** - the one file-read
`readFileSync(...).split('\n')` site (`codexsession.js`) is already `\r`-safe.
So no new *fixable* instance existed in the unscanned shapes; the class was
reduced by one documented spelling (the destructure), not closed - an unknown
shape with no syntactic signature still slips through, which is why #1732 also
records why a real Windows test instrument is the eventual answer.

**The corpus is a FLOOR, not a ceiling. Grow it.** Every future Windows bug that
is found should add its shape to the `FAMILIES` list (and, if it is a real fix,
a positive pin), so `n` only ever rises. A ratchet frozen at n=2 slowly becomes
decoration; a ratchet that absorbs each new shape becomes the thing that makes
the class progressively less invisible.

## Why we did NOT stand up a "run the suite on Windows" instrument (yet)

Recorded on card #1732 with the four measurements. In short: `tools/run-tests.sh`
is macOS-coupled (`lsof -iTCP`, `sysctl vm.loadavg`, `find -mmin`, a 104-char
unix-socket assumption) and its `yarn test:shell` arm runs bash scripts that call
`tmux` - which does not exist on Windows, the very reason the self-reporting lane
exists. And even the node arm cannot find this class, because the existing tests
hardcode POSIX fixtures: a passing Windows run would be **green for the wrong
reason**. A Windows CI arm becomes worthwhile only after the suite is split into
a portable node-only subset **and** the fixtures are parameterized by platform
(per `store.dataRootFor`). That is a larger, separate track.
