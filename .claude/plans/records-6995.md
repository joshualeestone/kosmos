# records-6995: teach `kosmos records` in the operating block (kosmos#6995)

## Finished means
An agent reading the operating block learns that a project keeps one shared list of what it tracks, how to read it
(`kosmos records <project-id>`) and how to add or update a row (`kosmos records set`), so it stops keeping such
lists in files of its own. The boot-file size canary passes with the growth written down.

## The change
- engine/defaults.js: a paragraph in "Making a project"; the tasks section's fingerprint paragraph in fewer words
  (every fact and every pinned phrase kept); DOCTRINE_VERSION 40 with its log entry.
- engine/defaults.test.js: pins v40 (25e4303042b14af1). engine/doctrine-past.js regenerated.
- engine/create.test.js: the size canary MAX_BYTES / 4 -> / 3 (65,738 bytes of text measured), with the growth
  history beside it.

## Decided, and why
- Teach it in the block (agents learn every other task verb there), and make room rather than only raise the line.
- Rejected: shortening other sections (nearly every phrase is pinned by a behaviour test, e.g. 16 in the browser-tabs
  section); leaving the verb to `project show` alone.
- Weakest premise: that agents need the block to find the verb; `project show` already names it.
- Known: `set` without `--confirmed` refreshes a row's date to today even when only the status changed. The sentence
  says "left out, it is today".

## Order and rollback
After #6994 (merged 6ccbbbce08). Rollback: revert (an agent's next refresh then offers v39's block again).
