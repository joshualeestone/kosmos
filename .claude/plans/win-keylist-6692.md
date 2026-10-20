# win-keylist-6692: the Windows updater takes the release key list before the manifest (kosmos#6692)

**Card.** #6692. Builds on origin/main; overlaps #6691 (the recovery test runs on the Windows job) and #6687
(`retry: true` on "taken meanwhile"), each by a few identical or neighbouring lines.

**Done when.**
1. With no recovery keys (as shipped), prepare() fetches nothing more and refuses exactly as before.
2. With recovery keys, release-keys.json and its .sig are fetched first (one fresh query per attempt, shared by both),
   taken through manifest-verify.trustedKeys, and the release manifest is checked with the list's keys.
3. The record lives under the per-user anchor folder, and its access list is read first; anything beyond the owner,
   SYSTEM and Administrators (or a FAT/exFAT drive) refuses with what to fix.

## Change
- engine/win32update.js: releaseKeys(ctx) before readSignedManifest; 404 refuses; a list that does not verify is asked
  for again (three attempts) then refused with "try again"; trustedKeys refusals are final except retry: true.
- engine/win32recordacl.js (new): reads owner and entries through Windows PowerShell (.NET, no modules), judge() is the
  pure rule. Never changes an access list.
- engine/manifest-verify.js: a record write failing on a drive without hard links says so; retry: true on "taken
  meanwhile".
- tools/windows-tests.js: the recovery test runs on the Windows job; its read-only arm skips there.

## Tests
- engine/win32update.keylist-6692.test.js, engine/win32recordacl.test.js, engine/manifest-verify.recovery-6609.test.js.
- Each new arm was run with its fix reverted and failed (the old updater: 9 of 11 fail, the dropped-key test among them;
  no access-list refusal: 2 fail; the rule letting others in: 4 fail; no FAT branch: 1 fails; no hard-link sentence: 1
  fails; fetching while off: the off test fails).

**Weakest part.** The FAT and hard-link error codes are read from documentation and the existing lock code, not measured
on a FAT drive here; the refusal says "may" for that reason.
