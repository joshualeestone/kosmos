# A rejected OAuth token reads as "working" forever (#874)

Josh, live-testing ahead of the Visual Edge session, 25 Aug: a new agent ("Roger") sent "hello" and the chat showed "Roger is working..." indefinitely. The real terminal told a different story: `401 {"type":"error","error":{"type":"authentication_error","message":"OAuth access token is invalid."},"request_id":null}` retrying, 7/10 attempts. Mona Lisa diagnosed and routed, not fixed (`engine/subscription.js`, credential-adjacent, my lane per the standing routing).

Splinter's framing, worth keeping: the check has two states where it needs three -- connected / not connected / **we have not actually asked**. A green light that cannot go red is not a status.

## Two real bugs, filed as one, scoped as two

1. **The chat UI shows nothing wrong** when an agent is stuck retrying a rejected token. Fixed here, fully.
2. **Kosmos's "Connected" status does not mean the token works** (`engine/subscription.js:108`, a shape-check on a cached local file, never a live call). NOT fixed here -- see "Deliberately not done" below.

## Bug 1 root cause, confirmed by reading the code, not assumed

Traced the whole chain: `web/index.html`'s `paintBusy`/`busyRow` render `"<name> is working…"` in `#d-busy` whenever `fresh.state === 'working'`, where `fresh` is `snapshot()`'s verbatim output from `engine/status.js`'s `classify()`. `classify()` has no marker set for auth failures -- the Claude branch's `esc to interrupt`/spinner checks fire on Claude Code's own retry-banner chrome before anything else gets a chance to say otherwise, so a 401-retry loop reads exactly like a healthy mid-task agent. This codebase had already independently pinned the *identical* failure shape for Codex (not Claude) in `engine/status.test.js`'s `CODEX_WORKING` fixture (captured 2026-08-24, a live pane, `#249`) and deliberately asserts it classifies as `WORKING` -- so any fix has to be Claude-branch-specific, and it already is: the Codex branch of `classify()` returns before this file's own module-level markers are ever reached, so the two shapes can never collide by construction, verified with a dedicated test rather than trusted to the branch split holding on its own.

## Design (mirrors `RATE_LIMIT_MARKERS`'s own precedent exactly)

- New `STATE.AUTH_FAILED` (`engine/status.js`), and `AUTH_FAILED_MARKERS` (`/OAuth access token is invalid/i`, `/"type":"authentication_error"/i` -- both captured directly from the live pane, not guessed at, matching this file's own "observed half by observing" discipline).
- Checked in `classify()`'s Claude branch, right after the existing rate-limit check and before `NEEDS_YOU_MARKERS`/the `esc to interrupt`/spinner checks -- same ordering reasoning as rate-limit: a more certain, more specific read of the same lines wins.
- Wired through every place `rate_limited` already reaches, so the new state doesn't half-appear:
  - `web/index.html` `STATE_COPY`/`CARD_ST` (board card badge -- given the quieter "paused" pack shape rate_limited already has, since the agent process is still up, it just cannot reach Claude; a louder treatment is a design call for whoever owns the pack, not decided here).
  - `web/index.html` `stateReason()` (the detail header's "Looks like a usage limit"-style line -- now also speaks for auth_failed).
  - **`web/index.html` `paintBusy`/`busyRow` -- the actual bug.** The `#d-busy` slot (the exact place "is working…" sat, unchanged, while Josh's real terminal showed the 401) now shows `"<name>'s Claude sign-in isn't working"` plus the evidence line, instead of staying blank or (before this fix) claiming "working" forever.
  - `engine/chat.js` `waitingNote()` (the note beside a message you sent, if the agent was auth-failed when it landed -- was falling to the generic "we could not tell what it was doing" default, exactly the case where the most was actually known).

## Deliberately not done here: bug 2, Settings > Accounts accuracy

`engine/subscription.js`'s `check()`/`checkCached()` never make a live call to Anthropic -- confirmed, no module anywhere in this repo calls `api.anthropic.com`. Making it live is a real, separate design problem, not a small addition:

- **Cross-account attribution is the hard part.** An auth failure observed on one agent's pane needs to be attributed to the RIGHT account before it can honestly downgrade that account's "Connected" status -- Josh's own symptom ("I'm connected to two accounts but it's not allowing me to access them") is exactly the multi-account case this would need to get right, and `subscription.check()` already has a `configDir`-scoping seam (`#248/#324`) built for exactly this kind of per-account precision that a naive "any agent anywhere failed" signal would blow past.
- **A live network call on every 5-second status poll is not the right shape either** -- `subscription.js`'s own header explains why `checkCached()` exists at all (a 95KB file parse twelve times a minute, forever, for a question that changes only on sign-in/out). A live check needs its own, much coarser cadence.
- **The reusable pieces already exist**, confirmed by research: `engine/tokendoor.js`'s `ask()`/`verify()` (timeout via `AbortController`, a `fetcher` test-seam, 401/403 specially distinguished from "unreachable") and `engine/githubdevice.js`'s `state()` (the closest real precedent: a live "who am I" call that tells a revoked token apart from an unreachable one, with an honest `because` sentence either way) are the two modules to build from, not `subscription.js`'s own pure-file-read shape.
- Given bug 1's fix directly addresses the reported urgency (a silent stall with no explanation, the "bad first five minutes" risk Splinter named for the Visual Edge session), and bug 2 needs real design work to get the attribution right rather than ship something that could misattribute one account's failure to another -- **filed as its own follow-up card** rather than rushed, with this reasoning as its premise (kosmos#[filed after PR], see below).

## Verification -- done, not just planned

- `engine/status.test.js`: new case `#874: a rejected OAuth token reads as auth_failed, not working forever` -- the real captured pane text, the state/confidence/evidence assertions, a healthy-pane control, and an explicit pin that `#249`'s Codex 401 fixture is untouched. Full file: 113/113 pass (was 112).
- `engine/chat.test.js`: new case for `waitingNote('auth_failed', ...)`, both delivery outcomes. Full file: 106/106 pass (unmodified count, one new test replacing headroom in an unrelated area is not what happened -- this is a net +1).
- `web.pane-title-status.test.js`: new case for `stateReason`/`taskLine` on `auth_failed`, both confidence arms, executed via the real lifted source (`test-support/page.js`'s `lift`), not a paraphrase.
- `web.reply-where.test.js`: extended the existing `paintBusy`/`busyRow` source-pattern tests (matching this file's own established style for testing those two functions without executing their full avatar-rendering dependency chain) to cover the new branch and its actual words.
- Full suite: `node --test engine/*.test.js *.test.js` -- 2099 passed, 0 failed (was 2091 before this card, +8 new tests: net of the 12 individual assertions above spread across fewer `test()` blocks than files touched).
