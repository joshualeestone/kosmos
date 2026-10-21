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

## Review decisions

- Review 1 (two blockers, five warnings):
  - `on` and `off` build their commit on the freshly fetched origin/main in a temporary index and PUSH it (as the
    release's site push does), then fast-forward this checkout. Before, the freeze lived only on one disk, so another
    machine's cut never saw it.
  - The site push (tools/lib/site-push.sh) refuses a frozen fetched tip on every attempt, which catches a freeze
    pushed while a cut runs. release.sh asks origin/main again just before its own `vercel deploy`.
  - The marker is never served: the export drops it, because its reason may name a live incident.
  - `on` refuses a pointer whose commit lacks its installer pair, or whose setup is not the pointer's setup_sha256,
    before writing anything.
  - Writers read the marker from the working tree OR HEAD. deploy-site reads it from $H OR origin/main (a stale
    checkout cannot publish over a freeze it has not pulled; a failed fetch is said, and $H decides).
  - The wording is narrowed to the Mac pointers: the Windows prod pointer is pinned in R2 by hand.
  - An end-to-end arm runs `on` and then the deploy it prints.
- Review 2 (six warnings):
  - Every writer (through tools/lib/pointer-freeze.sh) fetches origin/main and honours a marker there, so a stale
    checkout refuses before it changes anything. release.sh's early check therefore sees a freeze pushed elsewhere
    before the build, not only at the site push. A failed fetch is said, and the checkout decides.
  - `on` builds the pin in the temporary index from the found commit's own blobs (with their file modes) and the
    marker's blob. The shared working tree is never written, so a cut or promote on the same box cannot read a
    half-made pin, and a checkout not on main is left exactly as it was.
  - The push retry re-checks the freeze on every tip: `on` never overwrites a freeze pushed meanwhile, and `off`
    never lifts one already gone.
  - `on` refuses a pin whose signed manifest or `.sig` is not served.
  - The docs say what is not covered (the site's Kosmos.pkg, Windows R2, a Vercel rollback) and that `--because` is
    committed to the site repo.
  - New arms: a freeze only on origin/main refuses deploy-site; a stale writer refuses; `on` off main.
- Review 3 (nine warnings):
  - `on` no longer refuses uncommitted pointer files: it never touches them, and a cut dying (or running) here leaves
    exactly such files when a freeze is needed. It prints the deploy that will work: --publish when prod already
    serves the pinned version (--promote refuses that), --promote otherwise.
  - The marker records the pinned pointer's sha256, and deploy-site compares the bytes, not only the version.
  - deploy-site asks origin/main again just before vercel. That, and release.sh's re-check, narrow the window to the
    deploy itself and are worded so.
  - Fails closed: a writer whose site origin cannot be fetched refuses (KOSMOS_POINTER_FREEZE_OFFLINE=1 decides on
    the checkout). Every fetch has no credential prompt, a stall limit and one retry (ref-lock collisions).
  - A trailing --mac or --because with no value is refused (bash 3.2's shift 2 looped forever).
  - The docs and messages name the Windows site pointers as not pinned.
- Review 4 (seven warnings; the root fix): every git network call the freeze makes (the writers' fetch, `on`/`off`'s
  fetch and push, deploy-site's two fetches, release.sh's late fetch) goes through one helper, pointer_freeze_git:
  no prompt, ssh in batch mode with a connect timeout, a stall limit, and a hard time limit (git has no https
  connect timeout). deploy-site's early check fails closed like the writers (KOSMOS_POINTER_FREEZE_OFFLINE=1 decides
  on $H), and its late re-check covers the staging pointer too. `on` checks the installer against its own
  setup.sha256 even when the pointer names none; a same-version re-run verifies origin/main still holds the pin; `off`
  says other checkouts keep refusing until they pull. Left as it is: the fast-forward after `on` can move a clean
  checkout under a cut that has not written yet, which that cut's own site push then refuses (said in the header).
- Review 5 (three warnings, one convention): every curl in pointer-freeze.sh has a connect and a total time limit; the
  hard limit on git sends SIGTERM (git cleans its ref locks on TERM, not on ALRM) and keeps a configured
  core.sshCommand; `on` checks the manifest and .sig are in origin/main's tree (a deploy ships the committed tree
  whole) as well as served; test:shell runs `sh -n` on the lib deploy-site.sh sources; a mid-run arm proves
  deploy-site's re-check just before vercel (the fake curl pushes a freeze while the deploy fetches). release.sh's
  matching late re-check has no harness that can reach it (a real cut): reasoned from the same code, not run.
- Review 6 (four warnings): an optional `--sha256` (from outside the site repo, whose history an incident may have
  tainted) must match the pointer `on` finds, and the docs recommend it; deploy-site's late re-check says when its
  fetch fails; release.sh's late re-check is pinned structurally (present, refusing, before `vercel deploy`), since
  only a real cut reaches it. DECIDED, not missed: the freeze is all-or-nothing, so publish-kosmos-windows.sh refuses
  during a Mac-only pin too. A release-infrastructure compromise is not scoped to a platform, and a partial freeze is
  one more state to reason about mid-incident; to publish Windows during a pin, lift it (`off`) deliberately.
- Review 7 (two warnings, both operator guidance): the printed deploy is chosen by bytes, as deploy-site decides
  (live byte-identical to the pin is --publish; a re-cut under the same version, or any other build, is --promote; a
  live pointer that cannot be read is said); when this checkout could not reach the pushed commit, `on` says the
  deploy only works after it does; deploy-site says "pull" (not "off") when the freeze it sees is only on
  origin/main. The lib is #!/bin/sh and says it must stay POSIX.
