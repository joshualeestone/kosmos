# kosmos#7281 slice C3: a site deploy carries the Linux family (branch linuxdeploy-7281)

Design in .claude/plans/linuxrelease-7281.md (branch linuxrelease-7281, item 7). C1 review 1 (W2) handed this half
here: a LATER deploy from a checkout without the Linux tarball would serve a Linux pointer that 404s.

## Built (2026-10-26 23:3x)
- tools/lib/deploy-linux.sh: for each Linux pointer committed at the deploy's commit $H (never the working tree):
  validate it names kosmos-<v>-linux-x64.tar.gz and a 64-hex sha256; carry the local copy when it hashes to that sha,
  else fetch the live copy and hold it to BOTH the served .sha256 and the committed sha; refuse when neither exists,
  and refuse a local copy with other bytes (the dist/*.tar.gz glob would ship it unchecked). Both pointers on one
  build are carried once. deploy_linux_export_ok: the export carries each with a .sha256 that verifies in place.
- tools/deploy-site.sh: the lib loads beside the setup-floor checks; the committed Linux pointers meet the setup floor;
  the carry runs after carry_staged_mac; the export check sits with the other honest-marker checks; the live-pointer
  snapshot watches the two Linux pointers too.
- Test tools/test-deploy-linux-7281.sh: 27 checks (fake git site, file:// host), 6 mutants red.

## Decided, not missed
- Mirrors carry_staged_mac's rule (#4819) without its superseded-build exception: a Linux pointer is always a live
  install target (lockstep makes prod and staging Linux pointers current with the Mac ones), so a missing build is
  always a refusal.
- No post-deploy served verification of the Linux pair yet (the Mac has served_matches). Weakest premise: the pre-
  deploy carry plus the export check are enough while Vercel serves the export as-is; a served check is a follow-up.

## Review 1 (23:4x): 1 BLOCKER, 4 warnings, 2 nits
- BLOCKER FIXED: kosmos_setup_floor_pointer_ok (tools/lib/setup-floor.sh) read the version from the artifact name
  with a greedy match, so kosmos-0.7.80-linux-x64.tar.gz read as 0.7.80-linux and EVERY deploy with a Linux pointer
  would have refused. Now the version is the part before the first hyphen. My test only grepped that the call was
  wired and never ran it; it now runs the floor on a real Linux pointer, a Mac control and a mismatch (mutant back to
  greedy: red). Checked: release.sh's floor (kosmos_setup_floor_tree_ok) reads only the Mac pointers, so C1's cut
  path never hit it.
- W2 FIXED: the fetch made one attempt with no speed limit and returned 1 on anything, so a 503 read as "not served"
  and autodeploy parked the commit. Now deploy-site's retries and speed limit; 404 refuses (1); anything else after
  the retries returns 75 and deploy-site exits 75 (try again later, #5589).
- W3 FIXED: the temps in the shared dist/ sit in deploy-site's _FETCH_TMP_A/_FETCH_TMP_S slots, so its INT/TERM/HUP
  traps remove them.
- W4 FIXED: a committed Linux pointer older than the live one is refused (a checkout behind main), unless
  KOSMOS_LINUX_ROLLBACK names that version.
- W5 RECORDED: no post-deploy served check of the Linux pair (the plan's weakest premise; follow-up).
- NITs FIXED: the served .sha256 is compared before the large download; files are written through a temp, mode 644.
Test: 37 checks, 4 more mutants red. NB: I edited the branch while its deploy-site sweep ran; that sweep is
discarded and re-run on the committed head (log linuxdeploy-tests2.log).

## Review 2 (23:5x): 0 blockers, 2 warnings, 2 nits
- W1 FIXED: `|| code="${code:-000}"` kept the status curl had already printed, so a transfer cut off after its 200
  read as 200: the backwards check skipped silently and a corrupt tarball refused with 1 instead of 75. Now
  `|| code=000` (deploy-site.sh's own form), tested with a stand-in curl that prints 200 and exits 18. And a live
  pointer that answers 200 with no readable version returns 75 instead of passing the backwards check by default.
- W2 FIXED: review 1's non-greedy floor parse ACCEPTED kosmos-0.7.80-rc-arm64 and kosmos-0.7.80-arm64-evil under
  version 0.7.80 (the greedy one refused them). The floor now lists the archs a release publishes (arm64, x64,
  linux-x64); refusal tests for -rc-, -evil and an unknown arch (mutant: loosen the list -> 3 red).
- Found by the full sweep, not the review: tools/test-deploy-site-exit-trap-6826.sh requires every exit in
  deploy-site.sh to be a literal code (#6826); my `exit "$_dlc"` broke it. Now
  `|| { [ $? = 75 ] && exit 75; exit 1; }`.
- NITs RECORDED: the live pointers were already read for LIVE_PTRS_BEFORE (reuse them later); the 75 branches of the
  .sha256 and tarball fetches are untested (the live-pointer branch is).
Sweep 3 on the committed head 3e5e56ccc7 (every deploy-site and setup-floor shell test): 15/15 rc 0.
