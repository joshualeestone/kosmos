# accounts-boxes-770

## What this branch is

Josh's design pass on the Settings > Accounts screen (#770, #chaoskosmos-design
2026-08-24 22:31 CDT): a box per connected account with a green Connected mark
and a Disconnect link, and "Add a provider" as its own dialog with a dropdown
listing every AI provider.

## Scope

- `web/index.html`: `.acct-row` retired for `.acct-box` (bordered card,
  provider small, account bold, green Connected mark, a Disconnect door
  present but disabled -- the accounts engine has no disconnect route yet).
  The inline two-button provider picker (`#727`) moved into a new
  `#acct-add-modal` dialog (`.rm-box-form`, the same shape `#766`'s New
  task dialog uses) reached through a full-width `+ Add a provider` door;
  the picker itself became a `<select>` (Claude and OpenAI live, four
  placeholder "coming" entries, flagged for Josh's real list). The Claude
  sign-in and OpenAI key flows themselves are unchanged, just moved inside
  the dialog; `acctPick`/`acctFlowPaint`'s reload-recovery retargeted from
  the retired buttons to the select.
- `docs/browser-checks/render-accounts-openai.js`: rewritten for the
  dialog-first interaction (open the dialog, then `selectOption` instead
  of clicking a data-pick button) plus new assertions for the box shape
  (green Connected, disabled Disconnect).
- `docs/browser-checks/regress-a-night.js`: `.acct-row` -> `.acct-box`.
- `web.accounts-add.test.js`: rewritten for the dialog structure; a new
  test pins the review-driven focus fix.

## Done when

- Each account renders as its own box: provider name (small), account
  (bold), a green Connected mark at the right.
- Disconnect is present on every box, disabled with an honest reason
  (no engine route yet).
- "Add a provider" is a full-width door under the list, opening a dialog
  with a provider dropdown; Anthropic Claude and OpenAI are live, others
  listed and disabled.
- Reopening the dialog onto a sign-in already in flight lands focus on
  the actual step it is on, not the top of the dialog.
- Unit suite green. Full `tools/browser-checks.sh` page-gate green.
