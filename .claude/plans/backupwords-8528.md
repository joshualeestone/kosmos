# backupwords-8528: a company computer backs up only under accepted words that name backups (kosmos#8528)

## Why
Angel's #8528: `backuptick.mayBackUp` asked only `orgenroll.mayReport()` (enrolled here and SOME words accepted).
Nothing checked that the accepted words name a backup, unlike usage, policy and cap, which each send only when an
accepted line names them. A company's words list nothing under `backsUp` today.

## What (the coordinator half is kosmos-relay branch backupwords-8528)
- `engine/backuptick.js` `mayBackUp`: also needs `orgenroll.acceptedConsent().backsUp` to have a non-blank line, as
  `personalbackup.mayBackUp` already requires for a personal backup.
- Tests: `backuptick-inputs.test.js` review-7 test extended (empty backsUp, a blank line, a real line, words not
  remembered for the bound hash); `personalbackupjob-7404.test.js` stubs accepted words for its company-path routing
  test. Red-capability: with the gate reverted, the extended test fails (14 pass, 1 fail).

## Decided
- The words are not written here (lawyer, Josh 10-15 10:42). Until they are, a company computer backs up nothing.
- "Non-blank" after trimming, matching the coordinator's `consent_names_backup`.

## Weakest premise
That no shipped company relies on backup today. True: KOSMOS_ORG_BACKUP is off on the production coordinator.
