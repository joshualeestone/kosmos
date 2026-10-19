# Plan: delete the dead stateReason quoted arm and the noQuote option (#6118)

## Card

#6118 (claimed:scorpion). Delete the dead `stateReason` quoted "because" arm in
`web/index.html`, and the `noQuote` option that only exists to skip it. Liu Kang decided
DELETE (m5229). This branch is built fresh on origin/main AFTER #6101 (ownbounds, #5154
slice B) merged (d6896788f), which restructured `stateReason`, so line numbers were
re-measured against the current file (2d7b90f2b).

## Why the quoted arm is dead

`stateReason(a, opts)` has two adjacent arms (post-#6101 line numbers):

- `21164`: `if (opts && opts.noQuote && a && a.stateReported === true && a.because) { /* fall through */ } else`
- `21176`: `if (a && a.stateReported === true && a.because) { return '“' + a.because + '”'; }`

The quoted arm (21176) returns the agent's reported sentence in quotes. It only fires when
`noQuote` is falsy. Every live caller passes `noQuote: true`, so the quoted arm is
unreachable. Josh ruled twice (#986) that the grid/list should not show the quote, and
#3271 removed the detail header's status line entirely, so the quote now renders nowhere.
The reported reason still surfaces via the Talk waiting box (waitingLine) and the engine
state sentences, which this change keeps untouched.

## Every caller (verified at 2d7b90f2b)

`taskLine(a, opts)` at 20966 returns `stateReason(a, opts)` at 21045 (opts flows through).
`taskLine` does not read `noQuote` itself. The only `noQuote` references are:

- `21164` stateReason noQuote arm (DELETE).
- `22258` atask card: `taskLine(a, { noQuote: true, card: true })` -> `taskLine(a, { card: true })`.
- `22490` lrow card: `taskLine(a, { noQuote: true, card: true })` -> `taskLine(a, { card: true })`.
- `40870` detail bubble: `taskLine(a, { noQuote: true })` -> `taskLine(a)`.
- `40855-40867` bubble comment explaining the noQuote mechanism (UPDATE: noQuote is gone;
  taskLine now always falls through for a reported self-quote).

No caller passes `noQuote` falsy, and no caller relies on the quote.

## Edits

1. In `stateReason`, delete the `#986` comment block (21153-21163), the noQuote arm
   (21164-21168), the `#569` comment block (21169-21175), and the quoted arm (21176-21178).
   Replace with a one-line history comment naming #569 (introduced the quote), #986, #3043,
   #3271 (removed its surfaces). A reported+because agent then falls through to the state
   rules, exactly as the `noQuote: true` path did.
2. Drop `noQuote: true` from the three callers (keep `card: true` at 22258/22490).
3. Update the bubble comment (40855-40867) to drop the now-removed option.

## Tests

- `web.quoted-line-986.test.js` is the guardian of this behavior. It asserts the noQuote
  fall-through (still true), the quoted arm (being removed), and that the card/list/header
  SOURCE contains `noQuote` (lines 85-86, 95-96, which must change to assert the callers no
  longer pass noQuote and the quote renders nowhere). Rewrite it to assert the NEW behavior:
  reported+because yields no quote from any surface, and no caller passes noQuote.
- The other test files (muse-waiting-4569, agyquota-4588, agypoolcard-4588, rulesbehind-5957,
  etc.) pass `{ noQuote: true }` as an argument. After removal the option is ignored (a
  harmless no-op), and they assert fall-through results that are now unconditional, so they
  stay green. Confirm by running the full Node suite.

## What "finished" looks like

- The quoted arm and the noQuote option are gone from `web/index.html`.
- All three callers drop `noQuote: true`.
- The guardian test asserts the new always-fall-through behavior and that no caller passes noQuote.
- Full Node suite green; no rendered surface changes for any live caller (dead-code removal).

## Independence

Built on origin/main after #6101 landed. Does not touch #6129's files (browser-check).
