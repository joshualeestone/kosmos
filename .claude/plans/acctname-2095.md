# acctname-2095: show the human-chosen account name as the primary label

## Card
kosmos#2095 — "Account name is collected at connect time but never stored or displayed anywhere."
The serve slice (store `.kosmos-name`, serve `account.name`) shipped in PR #2110 and is on main.
This is the deferred DISPLAY slice: render the human-chosen name as the primary label wherever an
account is shown, key last-4 as a secondary detail, HTML-escaped (arbitrary user text).

## Decision (design owner, Mona Lisa)
- The human-chosen `a.name` becomes the PRIMARY label; the key last-4 stays as a SECONDARY detail
  on the richer Settings row. Rejected: leaving the key primary (the card explicitly asks for the
  name primary). Rejected: dropping the key entirely (the card says it "can stay as a secondary
  detail", and it aids identification).
- ONE shared helper `acctPrimaryName(a)` used by all three render sites, rather than editing three
  independent copies of the name chain, per the codebase's own #1834 "name it once so surfaces
  cannot drift" rule.
- Fold the trimmed name into `accountQualifiers`' key. This is REQUIRED for correctness, not scope
  creep: the function's own deferred finding 8 says the ambiguity count is blind to a name-derived
  label and goes live "the moment a name becomes the visible text" — which is exactly what this
  change does. Leading the key with the name makes two same-named accounts counted ambiguous and
  each qualified, so the on-screen and accessible names stay distinct.

## Sites changed (web/index.html)
1. `acctPrimaryName` / `acctHasChosenName` — new module-level helpers before `accountQualifiers`.
2. `accountQualifiers` key — leads with trimmed `a.name`; deferred-findings comment updated
   (finding 8 addressed, finding 9 untouched/still moot).
3. `acctRowHtml` (Settings AI-models row) — `who = esc(acctPrimaryName(a))`; new `keyDetail`
   secondary `.acct-org` line for named OpenAI rows; inserted into the row markup.
4. `fillCreateAccounts` `nameOf` — `acctPrimaryName(x) + qualOf(x)`.
5. `fillSwitchAccounts` `nameOf` — `acctPrimaryName(x)`.

## Weakest premise (name it, don't bury it)
The move/switch picker (`fillSwitchAccounts`, `#d-provider-account`) is a THIRD surface not named in
the card body (which lists Settings + create-agent picker). I included it for consistency (it also
shows accounts and used the same name chain), which is a small scope widening. If a reviewer wants
the card scoped to exactly its two named surfaces, that edit is trivially reverted; I judged the
drift-risk of leaving one surface on the old chain worse than the widening.

## Invariants held
- Claude rows unchanged: `readName` is OpenAI-only, so `a.name` is absent for Claude → falls through
  to the email-first chain. Asserted.
- Unnamed OpenAI rows unchanged: no name → key last-4 stays primary. Asserted.
- Whitespace-only name never wins (trimmed). Asserted.
- Arbitrary name HTML-escaped at every site (existing `esc()`), no markup injection. Asserted in the
  browser check (childElementCount === 0 for an `x<b>y` name).

## Tests / evidence
- `web.account-name-2095.test.js` — 8 tests, red-capable controls (name-vs-key, same-name
  disambiguation, unique-name-no-noise, Claude fallthrough, whitespace, label/dir fallback).
- `web.acct-picker-1917.test.js` — updated to grab `acctPrimaryName` into its eval scope (the
  extracted `fillCreateAccounts` now depends on it). Passes 3/3.
- `docs/browser-checks/render-account-name-2095.js` — real `paintAccounts` against a stubbed
  `/api/accounts` (no board), headless PASS: `account1` primary + `API key ending NfYA` secondary;
  unnamed key primary; Claude email primary; `x<b>y` escaped. + README row (#612 gate).
- Cluster (account/create/picker) 63/63.

## Not in scope
- The add-confirmation messages ("Added: API key ending X", lines ~15822/36335) are a different
  surface (post-connect confirmation, not the account display) and are left unchanged.
