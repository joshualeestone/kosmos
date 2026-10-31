# hiddencase-7226: reply attachments' rule 1 finds home by identity, not spelling

Card: joshualeestone/kosmos#7226 (Renet Tilley, follow-up of #6726). Mac half; the Windows separator case is #7221 (Homer).

## Finished looks like
`kosmos reply --file` refuses a file reached through a hidden name in home (~/.aws as a link into a project folder)
however home is spelled in the path: another case on a case-insensitive volume, or home reached through a link.

## Measured
On main, both new arms attach the credentials file ("DANGEROUS: it was kept: {kept:true, attached: credentials}").
With the change both are refused, and the controls hold: the correctly spelled path is refused, and the real,
non-hidden path (and a non-hidden file through the same link) still attaches.

## Change
- engine/replyfile.js: `givenHiddenUnderHome(given, homeId)`. It walks the path as given one component at a time, finds
  the component whose identity (device and inode, via the module's own idOf, links in the prefix followed) is home, and
  refuses when a later name as given starts with a dot. It runs after the existing spelling test, which stays.
- server.reply-file-6726.test.js: two #7226 arms beside r5-5 (another case, skipped where the volume tells the cases
  apart; a link to home), each with controls.

## Rejected
- Case-folding the spelling compare on darwin and win32: it would still miss home reached through a link, and APFS
  can be case-sensitive; identity is the filesystem's own answer either way.

## Weakest premise
One stat per path component per attach. A path is a handful of components and an attach is a person-paced action,
so the cost is not measurable.

## Checks
- server.reply-file-6726, server.attachment-stream-6734 and engine.reachable: 99/99. cli.reply-file-6726 and the
  standing guards (fixture-discipline, sandbox-data-4796, no-brand-refs, no-name-refs, the Windows guards): 77/77.
