# kosmos#5744 (Mac half, precondition 1): refuse a grant naming another key epoch

The coordinator half (kosmos-relay#363, branch epoch-5744) files every backup object under the member's CURRENT key
epoch, chosen per request, and lets a member who lost their key move to the next one. The shipped uploader never
compared a grant's `epoch` with the key it sealed under. Recorded on #5744 (comment 6100291554) as an ordering
condition: this check ships before, or with, any engine code that registers epoch 2.

## What changes
- engine/backupupload.js: uploadChunks and uploadManifest take `opts.epoch`, the member key epoch the bytes were
  sealed under (a context id, as backupkeys.js uses: '1'; a number is read as its string). When given, a grant whose
  answer's `epoch` is not that integer, or any of whose keys' third segment (`<org>/<account>/<epoch>/...`) is not
  that epoch, is refused before any byte is sent, and no new grant is asked for. An `opts.epoch` that is not a
  context id (`'01'`, `'0'`, `'x'`, -1, 1.5) is refused before any grant.
- engine/backupsnapshot.js: refuses a context whose epoch no grant can name (backupupload's `isKeyEpoch`) before
  anything is read, and both upload calls pass `ctx.epoch`, the epoch the chunks and the manifest were sealed under. The
  keyProblem comment no longer says the coordinator writes a constant epoch.

## Decided
- `opts.epoch` is optional in the uploader (no epoch given, no check), and its one caller, backupsnapshot, always
  passes it. Rejected: required. Every existing uploader test would change for a rule its one caller already meets;
  the snapshot test pins that the caller passes it.
- The manifest's OWN key must be under the epoch; the chunks it names are not checked: an index entry from an earlier
  run may sit under an earlier epoch and still restore with that epoch's key (the entry's memberKeyId binds it).
- A refused grant spends that grant's allowance (it answered); nothing new is asked, as for any other refused grant.

## Not in this slice
- Detecting a lost member key, making a new one and registering the next epoch.
- A structured field for the current epoch on the coordinator's refusal (precondition 2, #5744 comment 6100366859).

## Weakest premise
That `ctx.epoch` is the epoch of the member key the chunks were sealed with. backupsnapshot seals with `memberPk` and
`ctx` together and nothing here checks that the key belongs to that epoch; the caller supplies both.

## Tests
- backupupload: a chunk grant with epoch 2, with a string epoch, and with keys under /2/ is refused with nothing sent
  and no second grant; '1', 1 and no epoch upload; '01', '0', 'x', -1, 1.5 are refused before a grant. A manifest
  grant with epoch 2 or a key under /2/ is refused (grantSpent true, nothing sent); the matching one stores; '01'
  is refused before a grant.
- backupsnapshot: every chunk batch and the manifest are uploaded with opts.epoch = ctx.epoch.
- Red without the product change (main's two files): 3 fail; green with it: 196 pass.

## Review 1 (opus)
- FIXED: a context epoch backupkeys accepts but no grant can name ('01', 'e1') was refused only at the first upload,
  after the walk and the sealing; backupsnapshot now refuses it up front with the uploader's own predicate (tested).
- NIT taken: the chunk refusal test asserts grantSpent true. NIT not taken: a structured code for an epoch mismatch
  (the caller that would act on it is the later lost-key slice, which sets that contract with precondition 2).

## Review 2 (sonnet)
- No BLOCKER, WARNING or CONVENTION. Taken: the snapshot comment said the uploader SENDS the epoch with a grant; it
  checks the answer against it. Checked, not changed: the coordinator's grant answer `epoch` is an integer
  (kosmos-relay coordinator/src/backup.rs, `pub epoch: i64`), as the uploader requires. Not taken: a snapshot test
  for a mid-run epoch refusal (the uploader's refusal shape is the one the existing failure-path tests cover).
