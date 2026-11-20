# movename-8839: `kosmos agent move` takes the name `kosmos agent list` prints

Card: #8839. Measured on Mortals' board on 2026-11-20: `kosmos agent move "Sub-Zero" "<account>" --yes` answered
"Kosmos will not move Sub-Zero: there is no agent called Sub-Zero on this computer"; by id (`subzero`) it worked.

## Cause (read from the code, then shown by a test that is red on main)
The CLI sends the typed name to `GET /api/agents/account-plan`, and that route looked for a launch job under the typed
name alone (`create.readJob(name)`). A launch job is filed under the agent's own name (`subzero`), never under the name
its card shows (`Sub-Zero`), so every listed name that differs from the agent's own name was refused as no agent.

One correction to the card: the run without `--yes` did not resolve the name either. It stops before any request
("there is no terminal here to confirm on") and only repeats the typed word, so it looked as though it had found the
agent. At a terminal, without `--yes`, the same refusal came back. Both paths are fixed by the one change.

## Fix
- `server.js`, the plan route: with `resolve=1`, the typed name goes through `removal.resolve` over
  `cardsForResolve()`, the same resolution the removal plan (#8109, #8113) and the model route (#8665) use. Every answer
  past that point carries `name` (the agent's own name) and `shown` (its card's name). A name two agents answer to is
  refused with 409 and names both. If the cards could not be read and the name has no job of its own, the answer is a
  failed read (503), not "no agent".
- `install/kosmos` and `tools/windows/kosmos-cli.js`: send `resolve=1`, send the plan's `name` to
  `POST /api/agents/account` (that route resolves nothing, as remove's DELETE does not), and say the agent by its card
  and its own name when those differ, as `agent model` does. A plan with no `name` (an older board) leaves the typed
  name, as before.
- Only the two CLIs call the plan route (the Settings screen posts straight to the move with the card's own name).
  `resolve=1` is still opt-in, so any caller that sends an exact name is never resolved onto another agent.
- A board that could not read its agents answers `readFailed`; both CLIs say that sentence and "Nothing was moved",
  not "Kosmos will not move".

Rejected: resolving inside `POST /api/agents/account`. That route acts, and #8109 settled that only the read-only plan
resolves, so a retry after an agent went away can never land on a different agent with the same display name.

Rejected: resolving for every caller of the plan (no `resolve=1`). A caller holding the exact name gains nothing from
it, and it could only turn an exact miss into another agent.

## Checks
- `server.accountplan-name-8839.test.js` (new, real board): a hyphenated and a spaced listed name plan as the agent
  they name; the agent's own name still plans (control, green on main too); no `resolve=1` resolves nothing; an unknown
  name is still "no agent"; an ambiguous name is refused and names both. Cards that cannot be read answer 503 for a
  listed name, and the agent's own name still plans. On main's `server.js` the hyphen, space and
  ambiguous tests fail and the controls pass (run by hand: main's `server.js` at 14c4a37364 under the test file as of
  54b322d325, 4 of 6 failed, the fourth being a control that then asserted the new `name` field and was corrected).
- `cli.agent-move-8048.test.js`: both CLIs send `resolve=1`, post the resolved name, and refuse an ambiguous one with
  nothing posted; controls for the agent's own name and for an older board.

## Weakest part
The CLI tests run against a stub board, so nothing in one test goes from a typed display name through the real board
to a real move. The two halves meet only on the plan's `name` field, which both sides pin.

## Not in this change
The card's second observation (the automatic mover did not move two agents off an account at 100% weekly) is a
separate question and gets its own card if it reproduces.
