# #3081: create-agent defaults to the last provider, account, and model selected

**Branch:** `create-defaults-3081` · **Card:** kosmos#3081 · Priority: 0.6.68 (lower than the
0.6.66 class-2 de-alarm; picked up on night shift after that shipped).

## The ask

An operator who runs several agents on the same provider / account / model re-picks all three
on every create. Josh (2026-09-14): agent creation should default to the last provider, account,
and model selected. Make the create form pre-fill the last successful selection.

## The approach

The last-selected provider/account/model is remembered per machine in `localStorage` (the same
per-viewer store the theme, layout, and sort choices already use), read back on each create open,
and applied ONLY while each value is still usable. It is a DEFAULT, not a lock.

- **Keys:** `kosmos.create.provider` / `.account` / `.model` (namespaced constant `CREATE_PREF_KEYS`).
- **Save (`saveCreatePrefs`)** fires only on outcome `'created'` in the create-go handler. A
  `'partial'` rolls back (nothing was made), so it must not become the remembered choice. Values
  are the raw selector values, so an empty account (the single-account hidden row) or empty model
  (OpenAI "let it choose") persists as empty and simply fails to match an option next time,
  degrading to the ordinary default with no special case.
- **Restore** runs in `loadCreateExtras`, inside the SAME `!CREATE_PROVIDER_TOUCHED` auto-default
  gate as the #2097 openai-only upgrade. A saved provider supersedes that upgrade when usable
  (a saved `openai` already covers the only-openai case). A manual pick flips the touched flag, so
  the restore never overrides a deliberate choice.
- **Validity gating** is the core safety property. `applyCreateAccountPref` selects a saved dir
  only when it is one of the offered `<option>`s (`fillCreateAccounts` already excludes the
  confirmed-dead), so a removed account falls back to the server-marked `isDefault`.
  `applyCreateModelPref` selects a saved Claude model only when it is still in `CREATE_MODELS`, so
  a retired model falls back to the default.
- **OpenAI model** uses a one-shot `CREATE_PREF_OPENAI_MODEL`, mirroring the existing
  `IMPORT_OPENAI_DEFAULT`, because the OpenAI model list is fetched per account and async. It is
  armed before a single `paintOpenaiCreateModel()` for the chosen account, then cleared once a real
  account's list has painted, so a later manual account change never re-forces it. `resetCreateProvider`
  clears it on a fresh create.
- **Storage failures** (private window / blocked site data): every access is wrapped in try/catch.
  A read fails soft to all-empty (the ordinary default stands); a save is swallowed (the choice
  is simply not remembered this once). Neither breaks the create form.

## Scope

Scoped to the CREATE flow. The provider/model SWITCH dialog uses different selectors
(`#d-provider` / `#d-model`), does not share this, and is untouched.

## Tests

`web.create-prefs-3081.test.js` extracts and runs the four persistence/validity helpers
(`readCreatePrefs` / `saveCreatePrefs` / `applyCreateAccountPref` / `applyCreateModelPref`)
against stubs, so the controls can return the dangerous answer without a browser: a retired
model, a removed account, and a blocked-storage read. The `loadCreateExtras` cascade wiring is
covered by the existing create-flow browser check; this pins the logic the helpers own.

## Weakest premise

That the restore belongs in the `!CREATE_PROVIDER_TOUCHED` gate is the load-bearing assumption:
it means the saved default applies only before the operator touches the form, which is exactly
the intent (a default, not a lock), but it also means an operator who habitually changes provider
first sees the restore for a split second before their manual pick. That is acceptable (the pick
wins and flips the flag), but if Josh wants the restore suppressed entirely once a session has any
manual history, that is a bounded follow-up.
