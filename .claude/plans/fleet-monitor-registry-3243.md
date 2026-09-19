# Plan: enrich the fleet-monitor registry with provisioning metadata (#3243 slice A)

## Context

#3239 shipped the fleet-monitor MANIFEST + audit (detection of a monitor lost on a
box rebuild). #53 (claude-setup) shipped the first provisioning slice: committed plist
templates for two monitors + an idempotent installer. The remaining fresh-box gap is
the monitors that neither self-install (the relay four do) nor have a claude-setup
template: Josh-Brain's fleet-drift-check and board-served-tree-check. The #3243 design
(11:36 comment) resolved the seam as deploying-repo-owns-source + this registry as the
index, with the one claude-setup fleet installer provisioning `installer: fleet`
monitors BY REFERENCE from their deploying-repo checkout - so there is no per-repo
install script to build per monitor.

This slice adds the machine-readable metadata that makes that installer possible. It is
the registry half; the installer evolution (claude-setup) is the paired follow-up PR
that reads these fields.

## Change

`engine/fleet-monitors.js`: add three fields to every monitor entry:
- `repo`      - the checkout directory under ~/work that COMMITS the plist.
- `plist`     - the committed plist path relative to that checkout root.
- `installer` - 'self' (deploying repo installs it; fleet installer reports + skips) or
                'fleet' (the claude-setup fleet installer provisions it by reference).

Values verified against the real committed plists in each deploying repo:
- relay four -> repo kosmos-relay, deploy/<label>.plist, installer self.
- fleet-liveness + selfreport -> repo claude-setup, templates/fleet-monitors/<label>.plist,
  installer fleet (selfreport's plist migrating to agent-workforce is a later slice;
  `repo` records where it is TODAY so the installer resolves it correctly now).
- fleet-drift-check + board-served-tree-check -> repo Josh-Brain,
  Tools/fleet/<label>.plist, installer fleet. These are the fresh-box gap this
  registry lets the installer close.

`engine/fleet-monitor-audit.test.js`: extend the well-formedness test to require the
new fields, and add a test pinning the provisioning invariants the installer depends
on: `repo` is a bare checkout name (no separator, not `.`/`..`, not absolute), every
plist basename equals `<label>.plist` (a proxy for the internal Label launchd requires;
the real filename==Label match is enforced by the installer at load time), and no plist
path is absolute or contains `..`.

## Why this is safe / bounded

- Purely additive to a frozen data structure. The only consumer (tools/fleet-monitor-audit.js)
  reads `.length`, `.label`, `.source` - none of its logic is affected by the new fields.
- Backward-compatible, with one benign output change: `auditVerdict` puts whole monitor
  objects into `present`/`missing`, so `tools/fleet-monitor-audit.js --json` now emits the
  three new fields per entry. No test pins the object shape and consumers key on
  `.label`/`.length`, so this is additive, not a break. No control flow reads the new fields
  yet; the paired claude-setup installer PR is what will act on them.
- Reversible: deleting the three fields per row restores prior state.

## Weakest premise

The `repo` convention (checkout under ~/work/<repo>) is the fleet-box layout today. On a
truly bare box where a deploying repo is not yet cloned, the fleet installer must DEFER
that monitor (report, not fail), not resolve a missing path - that graceful-degrade is
the installer PR's responsibility, documented as its weakest premise there. If fleet
provisioning must run BEFORE repos are cloned, the registry model still holds but the
installer needs the repos present first.

## Verification

`node --test engine/fleet-monitor-audit.test.js` - all pass (17 tests).

Every `repo`+`plist` pair was checked first-hand against origin/main of its deploying repo
(not just for internal consistency), so a fresh checkout of any of those repos will hold the
declared plist. Reproduce per row with:

```
git -C ~/work/<repo> fetch origin
git -C ~/work/<repo> show origin/main:<plist> | grep -A1 '<key>Label'
```

Confirmed for all 8 rows that the file exists on origin/main at the declared path AND its
internal `<Label>` equals the registry `label` (hence equals the plist basename). The blind
worktree cannot re-run this because the sibling repos are not checked out inside it; the
commands above are how to verify it from a checkout that has them.
