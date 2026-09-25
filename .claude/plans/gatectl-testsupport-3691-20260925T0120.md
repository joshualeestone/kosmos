# gatectl-testsupport-3691: the install gate's control copies test-support/, and the gate refuses a missing fake tmux

## Problem (measured on Mortals, 2026-09-25, bundle built at ef6c9820 = 0.6.94)
`tools/test-install-gate-control.sh` failed its own control arm ("the untouched copy fails the gate") on every run, whatever the bundle. The red read "expected, not added: ./Kosmos/prompter-nudges.json". A direct `test-install.sh` run on the same bundle passed 107/0.

## Root cause
- `test-install.sh` exports `AGENT_WORKFORCE_TMUX_BIN="$HERE/test-support/fake-tmux.sh"` (#1651).
- The control copies only `install tools package.json dist` into its scratch repo. `test-support/` is absent, so the board cannot read its roster. The board log shows "we could not check which agents are running".
- With the roster unreadable, `prompternudge.shouldWrite(on, null)` is false by design, so the first tick writes nothing and the data diff reds on the missing file.
- Instrumented runs: no prompter-nudges file anywhere under the sandbox, and `data/Kosmos` held only `bin ping.json source-channel`.

## Call
1. The control copies `test-support/` in both of its copies.
2. `test-install.sh` refuses at once, naming the cause, when the fake tmux is not executable. That turns a symptom three steps away into a line that names the missing file.

## Rejected
- Relaxing EXPECTED_ADDS so prompter-nudges.json is allowed rather than required. That was #3691's first guess, and it was wrong: the file is reliably written when the roster is readable. Loosening the diff would have hidden the real defect and weakened the gate.
- Copying the whole repo into the control. That would change what the control isolates, and it is slower.

## Weakest premise
That nothing else under the repo root that the control does not copy is read by test-install.sh. The fixed control's untouched arm is green, which is the evidence: a missing input would make it red again, as test-support did.

## Proof (Mortals, the 0.6.94 tree)
- The fixed control passes with 0 failures. The untouched arm is green, and a bundle missing app/bin/kosmos-tunnel turns the gate red in both the staged tree and the tarball.
- The guard fires in a copy without test-support/: GUARD_RC=1 with the named FAIL line.
