# ptrfreeze-6620: freeze the release pointer at a known-good version (kosmos#6620 part 3, O04 playbook e step 1)

Card: kosmos#6620 (security hardening O04-5: "the release-pointer freeze plus the fleet auto-update pause"). The pause
is the board half (PR #6783) and the coordinator half (kosmos-relay updpause-6620). This is the other part.
Owner: PigeonPete.

## The problem, measured on main 4ffffb33ab (2026-10-20)

The incident runbook's first step for a compromised release ("stop the pointer: pin latest.json / latest-win.json to
the last known-good version") is PARTIAL: there is no freeze or rollback-pointer command, and nothing a release tool
honours. A pin done by hand today can be undone by the very next thing the fleet does on a normal day:
- `tools/release.sh` (a prod cut) rewrites `dist/latest.json` and deploys it itself (`vercel deploy --prod`, not
  through deploy-site.sh), release.sh:1475-1477, :1752-1772;
- `tools/promote-channel.sh` copies the (possibly bad) staging pointer onto prod, :460-466;
- `tools/publish-staging-pointer.sh` moves `latest-staging.json`, :68-81;
- `tools/publish-kosmos-windows.sh` writes `latest-win(-staging).json`, :202-204.
Agents cut releases all day, so during an incident the realistic way a pin is lost is our own automation.

What already works for a pin (so this does not rebuild it):
- `tools/deploy-site.sh --promote` is the sanctioned prod pointer move and allows an OLDER version (tested by
  tools/test-deploy-site-promote.sh:245-295). It still refuses a pin below the setup floor (0.7.45, no override), an
  artifact no longer served from the host, or a pointer whose `setup_sha256` does not match the committed installer.
- Boards: `available()` offers only a strictly newer version (engine/update.js:185-200), and the verifier refuses a
  downgrade (engine/manifest-verify.js:42-45, :95). So a pin stops boards BELOW the bad version from taking it, leaves
  boards already on it where they are (they need a newer clean release), and stops fresh installs (`/setup` reads the
  pointer) from getting it.

## What it does

`tools/pointer-freeze.sh`, run in the site checkout (KOSMOS_SITE, default ~/work/chaoskosmos-site):
- `on --mac <version> [--because <words>]`: finds the newest site commit whose `dist/latest.json` names `<version>`,
  restores that pointer and its installer pair (`setup`, `setup.sha256`, #5032) from it, and writes the tracked marker
  `dist/POINTER_FROZEN` (`mac=<version>`, `because=`, `at=` UTC). Refuses below the setup floor and when the version's
  artifact is not served from the host with the pointer's sha (the same two refusals deploy-site.sh would give later,
  given now, before anything is written). Commits locally. Prints the next command: `tools/deploy-site.sh --promote`.
  It does not deploy (the same boundary as promote-channel.sh).
- `off`: removes the marker (commits locally); the next normal release moves the pointer again.
- `status`: the marker, the committed pointer's version, and the live one.

Every pointer writer refuses while `dist/POINTER_FROZEN` exists, before it changes anything: release.sh (early, before
the cut starts), promote-channel.sh, publish-staging-pointer.sh, publish-kosmos-windows.sh. deploy-site.sh refuses to
publish a `latest.json` other than the frozen version while the marker exists. One shared check
(`tools/lib/pointer-freeze.sh`) so the writers cannot disagree about what frozen means.

## Decided

- The marker lives in the site checkout and is tracked, so every machine that cuts from a synced checkout sees it, and
  so does git history (who froze, when, why). A marker only on one Mac would not stop a cut from another.
- Staging is frozen too: a release-infrastructure compromise reaches staging subscribers through the same pointers.
- Windows prod is served from R2 (`tools/windows/publish-r2.ps1 -Promote`), which this Mac tooling does not run and
  cannot test. v1 freezes the site's Windows pointers and says plainly that the R2 pin is a manual step in the
  runbook; a publish-r2.ps1 check of the marker is a follow-up card.
- A freeze is not a defence against an attacker who controls the release Mac itself: they control the checkout.
  It is containment for the operator and the fleet's own automation, which is the realistic failure.

## Weakest premise

That every prod pointer write goes through one of the five tools above. The map (2026-10-20, every writer under tools/)
found these plus two shared writer libs (tools/lib/write-latest-pointer.js, write-latest-win-pointer.js) that only
these tools call, release_site_restore (which only restores the committed pointer on an abort), and R2. A pointer
edited by hand and deployed is not stopped by a marker; deploy-site.sh's check is what catches that one.

## Not in this PR

- publish-r2.ps1 honouring the marker (Windows, untestable here): follow-up.
- Vercel Instant Rollback bypasses every check (docs/staging-channel.md:203-210): stated in the runbook.
