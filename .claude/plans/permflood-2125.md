# kosmos#2125 - fresh-install macOS permission flood (SLICE 1: the Documents-TCC prompt)

Josh live-tested a fresh macOS user (2026-09-04) and hit a wall of prompts on the install-success
screen: (1) `"Installer" would like to access files in your Documents folder` (denying it BREAKS the
first-run scan), and (2) a burst of `"bash" can run in the background` notices. Card kosmos#2125.
Josh: "I've always been able to just immediately go to this screen, not get prompted... We need to
see what changed."

## Root cause (corrected from the handoff)

The handoff pointed Symptom 1 at `appLocationCheck` (the "checking where the icon is" step). That is
a MISATTRIBUTION: `appLocationCheck` (engine/machine.js:684) only `fs.statSync`s `/Applications` and
`~/Applications`, needs no Documents access, and is unchanged since #2088. It just PAINTS on the same
screen as the real trigger, so the prompt looked tied to it.

The real Documents-TCC trigger is the first-run disk scan, `discover.scan()` (engine/discover.js),
fired from the fresh-install empty-state via `GET /api/scan-agents` -> `web/index.html frScanAgents()`.
`defaultScanRoots()` deep-walked `~/Documents` (it was in `SCAN_DEEP_NAMES`) and shallow-walked it via
the `$HOME` root (Documents was NOT in `SCAN_SKIP`), and separately reached `~/Downloads`/`~/Desktop`
as #1652 import-only roots. Reading any of those TCC-protected folders fires the macOS prompt.
What changed: #1938/#1971 added Documents to the deep scan; #1652 added Downloads/Desktop; #2129
pretrust makes a fresh user actually reach the agent-empty first-run state that fires the scan; and
#2080/#2103 made the installer/launchd the responsible process, so the prompt reads "Installer".
There is no `NSDocumentsFolderUsageDescription`/entitlement/pre-grant anywhere, so the prompt is
unavoidable once the scan reads a TCC folder.

## Fix (this slice: engine-only, restores the pre-regression behavior)

Stop the auto-fired scan from entering any TCC-protected home folder:
- Remove `Documents` from `SCAN_DEEP_NAMES` (no deep-walk of ~/Documents).
- Add `Documents` to `SCAN_SKIP` (the shallow $HOME walk, HOME_DEPTH=2, no longer descends into it).
- Remove the #1652 `Downloads`/`Desktop` import-only roots from `defaultScanRoots()` (they fire their
  own TCC prompts; they remain in SCAN_SKIP so the $HOME walk skips them too).

This RESTORES the behavior Josh remembers ("go to this screen, not get prompted") - the TCC scan is a
post-#1938/#1652 addition. Standard agent/code parents (work, projects, Projects, Developer, dev, src,
code, repos, Kosmos) are all still scanned; only the prompt-triggering, non-standard-for-agents TCC
roots are dropped. `appLocationCheck` needs no change (the card's "narrow it to /Applications +
~/Applications" is already its state).

Note (deferred, minor): `SCAN_SKIP` matches by folder NAME at every depth, so adding `Documents`
also skips a nested folder literally named `Documents` (e.g. `~/work/clientX/Documents/<agent>`),
not only the top-level `~/Documents` that TCC protects. This is deliberately CONSISTENT with the
pre-existing global-name skipping of `Downloads`/`Desktop`/`Music`/`Movies`/`Pictures`/`Public`
(each already over-reaches a same-named nested folder); making Documents alone top-level-only would
be inconsistent and add a path-based special case. The follow-up user-triggered rescan slice should
be aware the skip is global-by-name, not $HOME-scoped.

Tradeoff (deliberate): auto-discovery of agents living inside ~/Documents/~/Downloads/~/Desktop is
dropped. These trigger prompts and are non-standard for agent/Claude work folders; discovery there can
return as an explicit USER-TRIGGERED rescan (which carries its own consent) rather than an auto scan
that prompts a brand-new user. `SCAN.DROP_DEPTH` and the `importOnly` plumbing in scan() are retained
(now dormant) for that follow-up.

## Tests

`engine/discover.tcc-roots-2125.test.js` (3 arms): a `Documents/` folder is skipped by the walk
(SCAN_SKIP) with a `work/` control that IS found; Downloads/Desktop likewise skipped with a
`projects/` control; `defaultScanRoots()` names none of Documents/Downloads/Desktop but DOES still
include work/projects/dev/src/code/repos. Existing discover.scan-1938 (18) and discover.import-1652
(9) stay green.

## NOT in this slice (follow-up slices of #2125)

- **Symptom 2: the "bash can run in the background" notice burst.** macOS Background Task Management
  posts one notice per launchd job whose Program is `/bin/bash` -- that is `com.kosmos.board`
  (install/setup.sh:3578) plus every `com.kosmos.agent.*` (engine/create.js:1702), all bootstrapped at
  once on a fresh install (amplified by #2129 pretrust bringing agents online together).
  `AssociatedBundleIdentifiers=com.chaoskosmos.kosmos` files them under Kosmos in Login Items but does
  NOT suppress the per-item notice because the executable is still bash. Suppressing it needs the
  persistent items launched under an APP-IDENTITY binary (SMAppService / a real login item) rather than
  bare bash -- a re-architecture of the launch path that deserves its own design + card discussion with
  Splinter before building (it touches the core spawn path just changed for #2129). Also found: the
  one-shot `com.kosmos.open-once` (setup.sh:3911) deletes its own plist file but never `bootout`s
  itself, so it lingers in the launchd registry until logout (a self-teardown gap; runs /bin/sh, not
  the bash-notice source).
- **Symptom 3 (handoff/Splinter): the Accessibility Continue-gate** (what-to-enable guidance +
  gate Continue on a11y actually enabled). Separate slice.

## Verification

Runtime is Josh's fresh-macOS clean-machine pass (no window server / no fresh account in CI). Done for
this slice = a fresh user reaches the success/first-run screen with NO Documents prompt. Reporting to
Splinter. Merge-on-green per beta; issue #2125 left OPEN until all three slices land + Josh confirms.
