# Plan: grow the #1732 Windows-coupling ratchet + record the completeness sweep

Branch: `win-coupling-1732` · Repo: joshualeestone/kosmos · Card: #1732

## What the card asks, and what is already done
#1732 is the meta-card for the Windows-hostile-assumption CLASS on an all-macOS fleet
("find them by system, not by luck"). Two PRs already landed:
- #1891: `docs/windows-source-coupling-1732.md` + `engine/windows-coupling-audit-1732.test.js`
  (the RATCHET: 4 scanned families - `path-delimiter-literal`, `fs-root-literal`, `env-home`,
  `fs-const-platform-flag` - reds on any unclassified match; positive pins for the known-fixed sites).
- #2199: the source-pin guard for the path-separator fix.

The ratchet PREVENTS NEW instances of the known shapes. It explicitly "claims nothing about
finding existing instances already in the tree" and names uncaught gaps (EOL, case-FS, a HOME
DESTRUCTURE, a separator in a variable).

## The completeness sweep (this is the "find all instances" half)
Swept the product-source scope the ratchet defines (`engine/*.js` + top-level `*.js` + `bin/*.js`,
minus tests/tools) for the named-but-UNSCANNED shapes. Findings:
- **HOME/USERPROFILE destructure** (`const {HOME} = process.env`): NONE exist today.
- **bare-command spawn** (Windows needs `.exe`/shell): NONE (commands use absolute paths or env overrides).
- **executable-extension** (spawn of `node`/`claude`/`gh`/`git` by bare name): NONE.
- **hardcoded POSIX bin paths**: `remove.js` (`/opt/homebrew/bin/tmux`, `/bin/launchctl`),
  `update.js` (`/bin/sh`), `connect.js` (tmux) - ALL macOS-only MECHANISMS. On Windows these tools
  do not exist and the agent uses a different lifecycle mechanism entirely (the #570/#2042 Windows
  lane), so they are `macos-only-branch`, NOT the #1732 portable-constant class. Out of scope here.
- **EOL** (`readFileSync(...).split('\n')` on a file Windows writes `\r\n`): one file-read site,
  `codexsession.js:126`, and it is SAFE - the split lines are consumed only by `line.trim()` and
  `JSON.parse(line)`, both of which tolerate a trailing `\r`. The other 38 `.split('\n')` sites split
  SUBPROCESS output (tmux/launchctl - macOS-only) or JSON. So EOL has no low-noise signature and no
  fixable instance, exactly as the doc reasoned when it left EOL unscanned.
- **separator held in a variable / PATH-var**: NONE.

Conclusion: no NEW fixable Windows-hostile instance in the unscanned shapes. The known class is
covered by the 4-family ratchet + the landed fixes. The remaining real risk is a FUTURE coupling of
a known shape written in a spelling the ratchet misses.

## The build: close the one cleanly-closable documented gap (grow the corpus)
The doc's instruction is explicit: "The corpus is a FLOOR, not a ceiling. Grow it." Of the documented
gaps, only the `env-home` DESTRUCTURE has a low-noise syntactic signature (destructuring HOME out of
`process.env` is almost never benign - you extract HOME to use it as a path root, which is undefined
on Windows). EOL / case-FS / manual-concat were deliberately excluded as noisy and that call stands.

Add a new family `env-home-destructure`:
- `re: /(?:const|let|var)\s*\{[^}]*\bHOME\b[^}]*\}\s*=\s*process\.env/`
- `\bHOME\b` word-bounded so `HOMEBREW`/`HOME_DIR` do not match; requires a `{...}` destructure of
  `process.env` naming HOME. No product line matches today (swept), so the tree stays green with no
  new inventory row.

## Tests / verification
- Tree stays GREEN after adding the family (no false-red): full audit test passes.
- PERTURBATION: add a synthetic `const { HOME } = process.env;` to a scanned file -> the EXCEED arm
  must RED (unclassified `env-home-destructure` match); revert -> green. Documented in the doc beside
  the existing perturbation proofs.
- `node --test engine/windows-coupling-audit-1732.test.js` green.

## Doc update
- Move the HOME destructure from "uncaught limit" to a scanned family; note `n` families rose 4 -> 5.
- Record the completeness-sweep findings above (so the next reader knows what was checked and why the
  macOS-mechanism calls are the #570 lane, not this class).

## Scope decision + weakest premise (for the card)
Call: grow the ratchet (close the destructure gap) + document the completeness sweep. Rejected:
(a) adding an EOL/exec-ext family - no low-noise signature, ~all false-red, no fixable instance
(the doc already reasoned this and I re-confirmed it); (b) "fixing" codexsession.js - it is already
`\r`-safe, so a change would be inventing work; (c) gating remove.js's launchctl/tmux on platform -
that is the #570/#2042 Windows-lifecycle build, a separate initiative, not the syntactic class.
Weakest premise: the completeness sweep covers the SHAPES I enumerated; an unknown Windows-hostile
shape with no syntactic signature still slips through (the doc admits this and it is unavoidable
without a real Windows test instrument, which #1732 itself defers). This PR reduces the surface by
one documented shape; it does not claim to close the class.
