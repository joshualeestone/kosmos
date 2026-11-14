# devbucket-8529: a Mac backs up to a local bucket only when its own coordinator is on this machine (kosmos#8529)

Splinter's ask (11-14 14:01), the Mac half of #8529's "for a test on a throwaway coordinator" list, plus the one real
end-to-end run for #8526. The coordinator half and the fake bucket are kosmos-relay branch devbucket-8529.

## Changes

- `engine/backupupload.js`: besides the test seam (`allowHttpForTests`, node --test only), a loopback upload url
  (and a bucket path with a port) is accepted only while this board's coordinator (`remote.COORDINATOR()`) is NOT the
  default production one AND is on this machine (a loopback address, or a `*.localhost` name, RFC 6761; the e2e reaches
  its coordinator as login.<x>.localhost because a board refuses an IP-addressed one for joins), AND the url itself is
  loopback (127.0.0.1 or localhost, no user part; not [::1], round 1). It reads the board's existing coordinator
  setting (AGENT_WORKFORCE_TUNNEL_COORDINATOR); it adds no setting of its own.
- `engine/backupupload.test.js`: the rule, both arms: production default and explicit, remote and LAN coordinators
  refused; a local coordinator accepts each loopback spelling and refuses LAN hosts and look-alikes; `.localhost` names
  and their look-alikes.
- `tools/companybackup-e2e-8529.js` (from tools/family-e2e-6239.js): coordinator with company backup to the local
  bucket, relay, fake bucket, two boards; company join; an agent with a chat; ONE backup with the tick's own steps
  (`tools/companybackup-run-once-8529.js`, started by hand: the tick first fires an hour after start); the bucket's
  objects and lock headers; the coordinator's manifest record against the bucket's bytes.
- `tools.fedproof-helpers-in-sync-6287.test.js`: the new copy is held to the shared helpers too (each copy against
  fed-own-e2e.js).
- `tools/family-e2e-6239.js` and the new harness: COMPANY_CONSENT_HASH updated to relay's current pin (d19c46c8...,
  kosmos#6842 slice 3). The old value (34a95f58...) left the family harness's "not the company's words" check unable to
  fail for its reason. Found by this run's equality check.

## Measured

- The new upload test passes; against main's backupupload.js it fails (control). All 17 backup test files: 522/522.
- The sync test 3/3; a changed helper in the new copy turns only its own test red.
- End to end: 30/30 in 9 s; the same run with main's backupupload.js: backup refused ("upload 0 is not https"),
  B2-B4 red (control). Posted on #8526 (comment 6883992644).

## Review round 1 (fixed)

- An `[::1]` bucket was accepted for chunks and then refused for the manifest (its bucket path regex has no brackets),
  so a run would upload chunks and never its manifest. `[::1]` is dropped on both sides (here and in kosmos-relay).
- The manifest arms (`localUploadOk(data.upload)` and `localBucketOk`) had no unit test with the seam off. New test: a
  manifest lands in a local bucket with a local coordinator, and is refused at the bucket path (no grant asked) with
  the production one. Measured: deleting either arm turns that test red.
- The DEFAULT_COORDINATOR comparison could never decide anything (the checks after it already refuse that address):
  removed. The e2e's B3 bucket-path check now needs at least one object. All 17 backup files: 523/523.

## Review rounds 2 and 3 (fixed)

- Round 2: the comments no longer say the rule "adds no switch" (it reads AGENT_WORKFORCE_TUNNEL_COORDINATOR) or that the
  test seam is "the only way". The e2e can leave a reader handoff (FEDPROOF_KEEP=1): Angel's browser reader opened that
  backup end to end (#8529).
- Round 3 (measured by the reviewer): loosening the manifest url arm to accept any url left every test green. New test:
  a plain-http manifest url to an S3 host is refused with the production coordinator and with a local one, and no
  request is sent (a recording fetch that answers 403; a thrown fetch is retried as "may have landed" and only hangs).
  The reviewer's exact loosened mutant now fails in 49 ms. Also: the comment names the ssh-tunnel case (a forwarded
  localhost turns the rule on for that coordinator's grants: loopback ports only, sealed bytes, allowlisted headers);
  two comments made stale by this change corrected; run-once keeps every snapshot id and requires inside its try.
  All 17 backup files 524/524; sync test 3/3.

## Weakest premise

That `*.localhost` always resolves to this machine. RFC 6761 says it should; the e2e checks it before starting (it
refuses a name that resolves anywhere else). On a resolver that sends `.localhost` names elsewhere, a board pointed at
such a name would accept a loopback bucket address, which still reaches only this machine.

## Not done

- The by-hand run skips the tick's Antigravity staging (no Antigravity agent in the run).
- A reviewer reading the backup back (Angel's reader, Mona's screens).
