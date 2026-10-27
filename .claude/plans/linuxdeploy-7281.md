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
