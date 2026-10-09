# consentempty-5531: a company that says it backs up nothing gets "Nothing is backed up." (#5531 follow-up a)

Stacked on orgenroll-5531 (#5531); rebased onto main once that merges.

## Why
The coordinator's consent (kosmos-relay#310) sends `backsUp: []` until Enterprise backup (E0.6) ships. The page hid an
empty group, heading included, so the person read the consent with no "What is backed up" at all. A missing heading
reads as "not shown", not "nothing": the decision is better made on an explicit statement.

## What (as it stands after review 1)
- `cleanConsent` sets `backsUpNone` only when the company sent an explicit empty array. A missing field, a non-list,
  or lines that cleaned away to nothing are not that statement.
- `plusOrgList(id, items, none)`: with no items and a `none` sentence, one muted, unbulleted `li.plus-org-none`, and
  the group stays shown. The backed-up group passes "Nothing is backed up." only when `backsUpNone === true`; with no
  flag an empty group hides, as before. Reports, readers and never are unchanged.

## Proof
- Engine: four arms (stated, missing, non-list, cleaned to nothing with a control); mutating the flag to "any empty
  list" reddens it. The consent hash is unchanged by the flag (pinned).
- render-orgenroll-5531 O13: stated (the line, unbulleted), unstated (the group hides) and listed (the list, no none
  line). Removing the sentence from the call reddens it.

## Weakest premise
That an explicit empty array from the company means "we back up nothing". The contract has no "not told" state for an
array the company sends.

## Review 1
- The page said "nothing is backed up" on ANY empty list, but the engine turns a missing field, a non-list, and lines
  that cleaned away to nothing into an empty list too: a statement the company never made, on the consent screen. Now
  `cleanConsent` sets `backsUpNone` only for an explicit empty array, and the page shows the sentence only on it; an
  unstated empty list keeps the old behaviour (the group hides). Pinned in the engine (four arms; the mutation to
  "any empty list" reddens it) and on the page (O13 now has a stated, an unstated and a listed arm).
- The words: "Nothing is backed up." (no "yet": that would speak for the company's plans). The line is muted and
  unbulleted, so it does not read as one more backed-up item (O13 checks the bullet is gone).
- The consent hash covers the four lists only, so the flag changes no hash (pinned).
- Kept: the Never group's always-show stays its own rule (a different reason: this Kosmos's own line lives under it).

## Review 2
- The plan's opening sections and one check comment described the first version; rewritten to the code as it stands.
- Kept (nit): the -20px margin that cancels the list's 20px padding (O13 checks the bullet is gone).

## Review 3
- The consent hash kept with an enrollment did not tell a stated "Nothing is backed up." from a hidden group, though
  the person read different words. `consentHash` now adds `backsUpNone` only when true, so every consent with a list
  (and every hash recorded before) is unchanged. Pinned both ways (a stated empty list hashes apart; a listed consent
  keeps the four-list hash); removing the line reddens it. (The hash is local today; follow-up b moves the enrollment
  to the hash the company serves.)
- A server test shows the flag reaching the screen through the real /api/org/preview route, with a listed control.
- The test's zero-width input is written as escapes; O13 sits after O12 in the check's header.
