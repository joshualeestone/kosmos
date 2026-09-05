# acctname-2095: show the human-chosen account name as the primary label

## Card
kosmos#2095, "Account name is collected at connect time but never stored or displayed anywhere."
The serve slice (store `.kosmos-name`, serve `account.name`) shipped in PR #2110 and is on main.
This is the deferred DISPLAY slice: render the human-chosen name as the primary label wherever an
account is shown, key last-4 as a secondary detail, HTML-escaped (arbitrary user text).

## Decision (design owner, Mona Lisa)
- The human-chosen `a.name` becomes the PRIMARY label; the key last-4 stays as a SECONDARY detail
  on the richer Settings row. Rejected: leaving the key primary (the card explicitly asks for the
  name primary). Rejected: dropping the key entirely (the card says it "can stay as a secondary
  detail", and it aids identification).
- ONE shared helper `acctPrimaryName(a)` (over `acctChosenName(a)`) used by all three render sites,
  rather than editing three independent copies of the name chain, per the codebase's own #1834
  "name it once so surfaces cannot drift" rule.
- Fold the trimmed name into `accountQualifiers`' key. This is REQUIRED for correctness, not scope
  creep: the function's own deferred finding 8 says the ambiguity count is blind to a name-derived
  label and goes live "the moment a name becomes the visible text", which is exactly what this
  change does. Leading the key with the name makes two same-named accounts counted ambiguous and
  each qualified, so the on-screen and accessible names stay distinct.

## Sites changed (web/index.html)
1. `acctChosenName` (trimmed name or '') / `acctPrimaryName` / `acctHasChosenName`: new module-level
   helpers before `accountQualifiers`. One definition of "does this account have a name and what is
   it", shared by every consumer.
2. `accountQualifiers` key: leads with `acctChosenName(a)`; deferred-findings comment updated
   (finding 8 addressed, finding 9 untouched and still moot).
3. `acctRowHtml` (Settings AI-models row): `who = esc(acctPrimaryName(a))`; new `keyDetail`
   secondary `.acct-keytail` line for named OpenAI rows (a dedicated class, NOT `.acct-org`, so it
   does not collide with the organisation line that #1393 guards); inserted into the row markup.
4. `fillCreateAccounts` `nameOf`: `acctPrimaryName(x) + qualOf(x)`.
5. `fillSwitchAccounts` `nameOf`: `acctPrimaryName(x) + qualOf(x)`, with `accountQualifiers` added
   (iteration 1 fix: leading with the name removed the inherently-unique keyTail that had kept this
   picker's options distinct, so it needed the same qualifier pass the create picker has).
6. `paintAccountPicker` (the Move-to `#d-account` picker, iteration 4 fix): both the current-account
   "here" option and the move-to options lead with `acctPrimaryName`. This is the same account-picker
   class as #4/#5. The move-to options come from `ACCOUNTS` (which carries `a.name`); the "here" option
   comes from `a.account` (launch-file-derived, no name), so it resolves through `acctLive` (its
   `ACCOUNTS` entry, already found in the function) to pick up the name.

## Weakest premise (name it, don't bury it)
The move/switch picker (`fillSwitchAccounts`, `#d-provider-account`) is a THIRD surface not named in
the card body (which lists Settings + create-agent picker). I included it for consistency (it also
shows accounts and used the same name chain), which is a small scope widening. If a reviewer wants
the card scoped to exactly its two named surfaces, that edit is trivially reverted; I judged the
drift-risk of leaving one surface on the old chain worse than the widening.

## Invariants held
- Claude rows unchanged: `readName` is OpenAI-only, so `a.name` is absent for Claude and the chain
  falls through to email. Asserted (and the same fallthrough keeps the #1917 same-email dedup).
- Unnamed OpenAI rows unchanged: no name, so key last-4 stays primary. Asserted.
- Whitespace-only name never wins (trimmed). Asserted.
- Arbitrary name HTML-escaped at every site (existing `esc()`), no markup injection. Asserted in the
  browser check (childElementCount === 0 for an `x<b>y` name).
- `.acct-keytail` inherits every theme/contrast treatment: it is added to the single base `.acct-org`
  rule (colours through `var(--label-2)`), which has no per-theme redefinition, so no theme block can
  leave it unstyled.

## Tests / evidence
- `web.account-name-2095.test.js`: helper + qualifier tests, red-capable controls (name-vs-key,
  same-name disambiguation, unique-name-no-noise, Claude fallthrough, whitespace, label/dir fallback).
- `web.acct-picker-1917.test.js`, `web.account-qualifier.test.js`, `web.picker-provider-2097.test.js`,
  `web.stale-visible-1599.test.js`: eval scopes updated to include the new `acctChosenName` /
  `acctPrimaryName` / `accountQualifiers` deps the extracted picker functions now use.
- `docs/browser-checks/render-account-name-2095.js`: real `paintAccounts` against a stubbed
  `/api/accounts` (no board), headless PASS: `account1` primary + `API key ending NfYA` on the
  secondary `.acct-keytail`; unnamed key primary; Claude email primary; `x<b>y` escaped. + README row
  (#612 gate).
- Full frontend suite `web.*.test.js`: 1071/1071.

## Post-connect confirmation toasts
- The Settings add-a-provider "Added" toast (web/index.html ~15831) now leads with the entered
  name when one was typed (falling back to the key last-4), matching the account list it repaints
  and the success toast beside it. Three review passes flagged the name/key inconsistency here and
  the entered name is in scope one line away, so it earned the fix.
- The FIRST-RUN "Added" toast (~36354) still shows the key: it is a separate flow where the entered
  name is not in scope, so surfacing it there means threading the name through first-run paint code,
  beyond this card's two named surfaces. Left for a follow-up card.

## Deliberately deferred: the agent-detail "runs on" line (documented, iteration 4)
The agent-detail parenthetical (web/index.html ~19511, `a.account.email || a.account.label`) still
shows the path slug for a named account. Unlike the pickers, its account object (`a.account`) is
launch-file-derived via `accountForAgent` and carries no `name`, so showing the chosen name means an
`ACCOUNTS`-by-dir lookup at the detail render, coupling the detail view to the accounts list, and it
would touch a line with subtle saved-but-not-restarted Move-window semantics (the parenthetical
deliberately reads the launch file to name the account the agent WILL use). It is a status line, not
an account picker, so it sits outside the picker/row class this card updates. Deferred to a follow-up
that plumbs `name` onto the agent account object (or does the lookup) deliberately.
