---
pre_challenge: true
method: challenge-loop
branch: gemini-discover-2243
diff_hash: 525275e37c24b93153c447b9c6fc09203343416f5f3b71b879ea7dafa59cde61
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T12:02:00Z
iterations: 1
converged: true
---

## #2243 part 2: discover Gemini agents (GEMINI.md via projects.json)

### What this ships

`foundGemini()` in `engine/discover.js`, the third provider path beside `found()`
(Claude) and `foundCodex()` (Codex), plus a new `engine/geminisession.js` module
that owns the `~/.gemini` resolution. A directory recorded in Gemini's
`<GEMINI_CLI_HOME>/projects.json` whose `GEMINI.md` INTRODUCES somebody is a
discoverable Gemini agent, read with the same `status.identityFromText` the
CLAUDE.md arm uses. Rows carry `runner: "gemini"`. Wired into `found()`'s
aggregation LAST, so Claude then Codex win a directory collision.

Measured against a real `projects.json` on this machine, not taken from the spec
PDF alone: the enumeration source is `{ "projects": { "<abs-cwd>": "<name>" } }`
and instructions live in `<cwd>/GEMINI.md`.

### Blind challenge-loop review

One fresh blind general-purpose reviewer (CTO lens), told to attack the #1500
sandbox handling, the `found()` integration, robustness, and test power.

**Verdict: NO BLOCKERS.** Reviewer independently confirmed: the #1500 guard is
byte-for-byte foundCodex's discipline; `roster` is in scope at the call site; the
collision order matches intent; no `byDir` shadowing (foundGemini's local map vs
found()'s); every robustness arm handled; `alreadyIn(cwd, undefined)` tolerated;
and the CONTROL test is discriminating, not vacuous. Reviewer ran the tests.

**One NIT, fixed.** foundGemini originally dropped an existing-but-unparseable
`GEMINI.md` with no signal, diverging from foundCodex (`unreadable += 1`) and
reintroducing the #1527 "less discoverable than an empty folder" defect for
Gemini. Fixed with the correct semantics for Gemini (whose `projects.json` lists
NON-agents too, unlike codex rollouts): gate the count on `INTRODUCES`. A file
that introduces somebody but names nobody the parser can read is an agent we could
not NAME (`unreadable += 1`); a file that introduces nobody is not an agent
(skipped silently). Verified `identityFromText` behaviour on both strings first.

### The self-found gate: a check-frozen-roots (#1432) FALSE POSITIVE

The full suite went red on `engine/discover.js:703 const SCAN resolves a root at
require time`. SCAN is pure numeric constants from #1938, untouched by this diff.
Measured decisively: the checker returns rc=1 on this HEAD but rc=0 on
origin/main's `discover.js`, so the addition flipped it. Root cause: the checker
matches a resolver-helper name via `\b<name>\s*\(` inside a const's init text
INCLUDING COMMENTS (a use-vs-mention bug in the checker). The original local
`function geminiHome()` reached `os.homedir()`, chaining
`geminiHome -> foundGemini -> found()` into the resolver set, and SCAN's COMMENT
literally says `found()`.

**Fixed by mirroring foundCodex's ARCHITECTURE, not just its function shape.**
foundCodex reaches no `os.homedir()` in discover.js at all; it delegates to the
codexsession module. Extracting `geminisession.js` (home + projects.json, home a
lazy arrow const) keeps discover.js's `found()` out of the #1432 resolver set.
Deliberately did NOT cosmetically edit SCAN's comment, nor patch the shared
checker (the real use-vs-mention bug there is out of this card's scope and worth a
separate card).

### Evidence

- `check-frozen-roots.js`: rc=1 before, **rc=0 after**; `geminisession.js` alone rc=0.
- gemini suite: **5/5 pass** (twin pair pins the INTRODUCES gate in both directions).
- discover suites: **134/134 pass** (found() aggregation + #1500 sandbox tests).
- full `run-tests.sh`: **4899/4899, fail 0, real exit 0** (the first red was this
  gate, not #708 contention; confirmed by re-run after the fix).
- diff em-dash swept clean; engine-only change, no `web/` diff, so no #1720 gate.

### Weakest premise (named)

`projects.json` is the only enumeration source, so a Gemini-only agent that never
got a `projects.json` entry (or a Gemini install that stores project cwds
elsewhere) is invisible. That is a session-history follow-up, the same shape as
Codex's rollout scan, documented on the card, not this MVP.
