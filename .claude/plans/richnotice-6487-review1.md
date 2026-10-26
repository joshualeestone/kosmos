# richnotice-6487, blind review round 1 (CTO lens)

Reviewed: `git diff origin/main...HEAD` at 14a2ac40e2 (engine/phonenotice.js reportWords, engine/phonenotice.test.js, docs/phone-notifications.md line 112).

Counts: 0 BLOCKER, 3 WARNING, 2 NIT.

## Findings

### [WARNING] engine/phonenotice.js:88: the `row.auto` branch can never fire; the stored row has no `auto` field
selfreport.record stores the writer as `by: 'auto' | 'agent' | 'operator'` (engine/selfreport.js:449) and never writes `auto`. So `if (row.auto)` is dead code, and "Asking your permission to go on." is unreachable.
- Measured (scratch AGENT_WORKFORCE_HOME, real selfreport.record): `{state:'needs_you', because:'asking permission to use Bash: ls', auto:true}` stores `{by:'auto', because:'asking permission...'}` with `auto` absent.
- The new test (engine/phonenotice.test.js, the `auto: true` row) passes only because it is a hand-written JSONL row that selfreport.record can never produce. It certifies a shape that does not exist (bulletin a-hand-rolled-fixture-answers-a-different-question). The doc line repeats the same claim.
- Failure scenario: none on a phone today, because of the next finding. The harm is a test and a public doc certifying behaviour that never runs, and a later reader trusting it.
- Fix: read `row.by === 'auto'` if the branch is wanted, and build the fixture through selfreport.record. Or, better, delete the branch, its test row and its doc clause (see next finding).

### [WARNING] Cause: the "most likely" cause on the card (a permission hook report with no `because`) is false for Claude Code; this branch only reaches `--on`-only and `--owner`-only reports
selfreport.record refuses a needs_you with no `because`, `on` and `owner` (engine/selfreport.js:271). Claude Code's PermissionRequest hook always sends text `asking permission to use <tool>[: <cmd>]` (engine/kosmos-report-hook.js:129), which the report route stores as `because` (server.js:17742).
- Measured: an auto needs_you with empty text is refused (`a needs_you report needs at least one of a reason, --on, or --owner`); an auto permission report stores `because` and reportNote already answered it on main.
- So the only rows this change affects are a report made with only `--on` or only `--owner` (or rows older than the #2001 rule). The card comment (2026-10-26, cause item 1) and the code comment at engine/phonenotice.js:82 both say a permission hook's automatic report records no reason; that is untrue.
- Failure scenario: the card is believed fixed for Jonah's notice, the next Kosmos release ships, and Josh's next permission notice is still plain because the cause was elsewhere (an id the phone cannot ask about: crashloop/stuckterminal/ownbounds; the borrowedName 404; the request failing or timing out from the extension). Nothing in this branch says which.
- Fix: correct the code comment and the card comment to say this covers `--on`/`--owner`-only reports, and keep the weakest-premise note in the plan, now stronger: the measured hook path rules the permission case out. Before calling #6487's lock screen fixed, get the board's own record of which id that push carried (the board log on the computer that sent it), not Josh.

### [WARNING] engine/phonenotice.js:89: an `--owner`-only report says "Waiting for your answer." when it may be waiting on someone else
`owner` is "who must act". `kosmos report needs_you --owner Angel` stores `{owner:'Angel', because:null, on:null}` and the phone tells the person "Waiting for your answer."
- Measured: owner-only rows, `owner:'Angel'` and `owner:'Josh'`, both answer `"Waiting for your answer."`.
- Failure scenario: an agent raises needs_you naming another agent or a colleague as owner; the person's lock screen says the agent waits for THEM, which is untrue. Since auto rows always carry `because` (above), owner-only is the main row that reaches this final fallback, so the misleading case is the common case for this line, not the edge.
- Fix: before the generic line, `if (typeof row.owner === 'string' && row.owner.trim()) return 'Waiting on ' + owner + ' to act.'` (or similar, same trailing-dot trim), with a test row built through selfreport.record. `owner` is masked at write for the setup guide and capped at 200 like `on`, so the same reasoning as `on` applies to privacy and length.

### [NIT] engine/phonenotice.js:87: an `on` that is only punctuation gives "Waiting on ."
Measured: `on: '...'` answers `"Waiting on ."`. Harmless, but "true words" it is not. Fix: test the stripped value, and fall through when it is empty.

### [NIT] docs/phone-notifications.md:112: the doc clause matches the code exactly, including the dead auto branch
"else `Asking your permission to go on.` for an automatic permission report" describes a branch that never runs (first finding). Update it together with the code, and add the owner line if that fix is taken. The rest of the line matches reportWords word for word (`Waiting on <what it is on>.`, `Waiting for your answer.`).

## Checked and found clean

- **Tests, measured:** `node --test` on engine/phonenotice.test.js, server.phonenotice-6487.test.js, server.phonenotice-permission-7017.test.js, server.phonenotice-post-7032.test.js, web.phone-notify-catalog-6487.test.js: exit 0, 32 tests, 32 pass, 0 fail.
- **Row shapes, measured** through the real selfreport.record into a scratch AGENT_WORKFORCE_HOME (probe outside the worktree): permission hook row, empty auto row (refused), on-only, owner-only, no fields (refused), on+owner, on `'...'`. Results as quoted above.
- **Allow/Deny (#7017), read:** fallback words cannot reach the buttons. phonePermissionNow (server.js:4264) keys on selfreport.read's standing `by:'auto'` row and the live viewport, never on the words; NotificationService.swift:136 sets `content.body = permission.shown` when a permission is offered, replacing the words. An auto permission row always has `because`, so the fallback never sits beside Allow/Deny anyway.
- **Masking, read:** wordsFor runs `deps.mask` (guideMasked) on whatever reportNote returns, fallback included, so the setup guide's `on` is masked twice (at write, server.js:17750, and at read). The fixed prefixes carry nothing secret.
- **Length, read and measured:** `on` is capped at 200 characters at write (selfreport CAPS), so `Waiting on <on>.` is at most about 212, under TEXT_MAX 400; shorten() is still applied after.
- **Null meaning downstream, read:** reportNote's null now means "no needs_you row at that time" (or no file); nothing reads null as "the report is gone" beyond the route's 404, which still fires for a missing time, a non-needs_you row and no file (test rows kept). The extension treats any non-200 as "show the push as it came" (NoticeLogic.swift words()).
- **Already answered, reasoned:** a row that is needs_you but already answered still answers its words, as it did with `because` on main; the extension asks within seconds of the push, so the window is the same as before. Not new.
- **Who uses the route, searched:** `/api/phone/notice` is used only by ios/KosmosNotice (NoticeLogic.swift) and ios/LogicTests; the app's own views do not call it. wordsFor/reportNote have no callers outside phonenotice.js and tests.
