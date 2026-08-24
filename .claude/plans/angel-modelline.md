# The model section says it in one line (Josh, 2026-08-23 19:56 family)

## What finished looks like

The agent dialog's model section shows ONE line naming the model and the
account together, "Runs on Claude Opus 5 (josh@stuff.io)", followed by the
three dropdowns and the two buttons Josh ruled to keep (Move, Change and
Restart). The separate "Signed in as ..." sentence under it is gone.

## Why

Josh, 19:56: the dropdown now shows the account email (landed as #491 by
Mona Lisa), so the sentence restating it above was the fourth
explains-the-visible line of the night. "Let's take that line out and we
just get back to the nice three drop-downs." The design's model line in the
pack composes model and account into one line.

## Changes

- web/index.html markup: remove the `d-account-now` paragraph.
- web/index.html runs-on paint: append the account email in parentheses
  when the engine knows it (acct.email, falling back to label), escaped.
- web/index.html paintAccountPicker: drop the removed element's writes; the
  cannot-tell state keeps its explanation on the existing msg element the
  disabled controls already use.

## Not changed

- The Move dropdown and its arming (hers, #491).
- The msg wording for an agent Kosmos did not start.
- Nav labels (separate ask, separate owner ruling).

## Verify

- Full suite green with the exit code read from the log file.
- Screenshot of the model section attached to the PR (house rule).
