# recoveries-5536 (board half): show a member the recoveries of their own backup

Card comment with the design: https://github.com/joshualeestone/kosmos/issues/5536#issuecomment-6654545736
Relay half: kosmos-relay PR #781 (the `recoveries` and `recoveriesMore` fields on the full org status answer).

## Change
- engine/orgenroll.js: `cleanRecoveries` keeps a row only with `key_released` or `files_opened` and a whole `at`,
  strips `who` to text as cleanReviewerGrants does, and keeps `epoch` and `count` (reads only) as whole numbers. At
  most 50, newest first as sent. The status refresh keeps them on the enrollment record with `recoveriesAt`, by the
  coordinator's rule: [] means none, and a missing field means it could not read, so the confirmed list is kept for
  the same world and company. A review's Accept carries the list as it carries reviewerGrants.
- server.js: /api/org sends them to the screen only, when joined here, as it does reviewerGrants.
- web/index.html: Settings, under the reviewers, has "Reviewers given access to your backup in the last 30 days:". Each line
  reads "<name> was given your backup key, <day>" or "<name> opened N files from your backup, <day>". The name sits
  in a bdi and is written as text. A row with no name reads "A reviewer" (the coordinator sends null for a deleted
  account, which is not the same as leaving). The heading says when the list was last confirmed if that is over a day
  ago. Older than 30 days is dropped by the page. `recoveriesMore` is kept and shown as "Older ones are not listed
  here. Your company's admins can see every one in its log."

## Decided
- A key release says "was given your backup key", not "opened": a key alone opens nothing until a read follows. The
  heading says "given access" for the same reason.
- Built dark: until a coordinator sends the field, nothing new shows.

## Weakest premise
The wording. It is mine, written without a designer. Mona Lisa's or Josh's wording replaces it.

## Not here
- A board notice when a new recovery appears (the reviewer notice's pattern, #6817): the next slice.
- A browser check and design shots: the section is hidden with no relay data, and none is served yet. Both come
  once relay #781 is deployed and a real recovery row can be painted.
