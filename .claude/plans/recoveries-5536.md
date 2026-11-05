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
- web/index.html: Settings, under the reviewers, has "Who was given access to your backup in the last 30 days:". Each line
  reads "<name> was given your backup key, <day>" or "<name> opened N files from your backup, <day>". The name sits
  in a bdi and is written as text. A row with no name reads "Someone" (the coordinator sends null for a deleted
  account, which is not the same as leaving). The heading says when the list was last confirmed if that is over a day
  ago. Older than 30 days is dropped by the page. `recoveriesMore` is kept and shown as "Older ones are not listed
  here." (A first version also promised the admins can see every one; nothing here shows the admin log keeps them
  all, so that half was deleted.)

## Decided
- A key release says "was given your backup key", not "opened": a key alone opens nothing until a read follows. The
  heading says "given access" for the same reason, and names no role: the coordinator says who acted, not their role.
- Built dark: until a coordinator sends the field, nothing new shows.

## Accepted
- A read with no usable count (missing, or 0, which the engine drops) reads "opened files from your backup".
- A family is shown nothing: it has no backup, and the reviewers block already says so.

## Weakest premise
The wording. It is mine, written without a designer. Mona Lisa's or Josh's wording replaces it.

## Checks
- docs/browser-checks/render-recoveries-5536.js (gated, chromium and webkit) paints the real page with /api/org stubbed.
  It checks that the list is on screen, the wording, the "older ones" line, and nothing for none, a family or no
  company, and that a long name wraps at 375 px in both themes. Its first run found that a long name overflowed its
  line, in both engines. Fixed with overflow-wrap:anywhere, on the reviewers list too, which has the same name lines.
- server.recoveries-5536.test.js: /api/org on a real board. The screen gets them, an agent's token gets none, and
  neither does no company or another world.

## Not here
- A board notice when a new recovery appears (the reviewer notice's pattern, #6817): the next slice.
- Design shots for a designer's review: the browser check's own shots (1280 light, 375 light and dark) are attached
  to the PR. A design review follows.
