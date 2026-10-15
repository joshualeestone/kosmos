# relayhook-6245: the CI mini's job-cleanup hook spares the kosmos-relay runner

## Why
kosmos#6245 put a second GitHub runner (the kosmos-relay repo's, `~kosmos-ci/actions-runner-relay`) on the CI mini under
the kosmos-ci user. The kosmos runner's job-cleanup hook (`tools/ci-runner-setup.sh`, hook_body cleanup) ran
`pkill -u kosmos-ci -x node`, and an Actions runner's service host on macOS is `node RunnerService.js`. Measured: the relay
runner stopped at 19:00:04Z, three seconds before a kosmos `suite (node)` job completed at 19:00:07Z. A relay job's node
would die mid-run the same way.

## Call
Keep ending every leftover tmux/node of the user, but spare (a) the hook's own ancestors, as pkill did, and (b) any
process whose ancestry reaches a command under `~/actions-runner-relay/` (the relay runner and the job it is running).
A leftover that detached (parent launchd) is ended, whoever started it, so kosmos cleanup loses nothing.
Rejected: a working-directory match (kosmos tests start boards in temp folders, which would escape); a separate macOS user
for the relay runner (needs a system LaunchDaemon and sudo on her Mac; headless WebKit without a GUI session unproven).
Weakest premise: that every relay-runner process keeps an ancestor whose command names `~/actions-runner-relay/`
(measured on the mini: runsvc.sh is launched by absolute path, and Listener/Worker/job nodes descend from it).

## Evidence
- tools/test-ci-cleanup-relay-6245.sh: real tagged node processes under a temp HOME, hook run with --list only (it never
  kills here): a detached leftover is listed; a node under a fake relay runner (spared by ancestry, not its own command)
  is not; the hook's node-named ancestor is not; CONTROL: with the exception removed, the relay node is listed. 6/6.
- tools/test-ci-runner-setup-4601.sh: all passed.

## Review
### Round 1 (Opus, blind): no blocker
Confirmed: the ancestor exemption is exactly pkill's (only the hook's own ancestors); RunnerService/Listener/Worker of the
kosmos runner survive; Bash 3.2 fine; hook_body stays the single source for install and the byte compare; the test only
uses --list and its control really removes the exception.
WARNINGs (low), taken as comment lines: the exemption can be spoofed by a kosmos job naming the folder in argv, and a
relay job's detached process (tmux always detaches) is still ended. Taken NITs: `ps -ww` (no COLUMNS truncation); the
test refuses a hook with no --list. Left NITs: the walk fails toward killing if an ancestor exits mid-walk; HOME unset
falls back to the old behaviour; 64-hop cap; the trap's "Terminated" notice.
