# board-origin-scriptpath-2515 — key on the board's CODE tree, not its cwd

## Problem (kosmos#2515, follow-up to #708)
`board_origin_label` (tools/lib/board-origin.sh) is called by run-tests.sh `seen_before()`
on the board's **cwd**. But the installed board runs `node server.js` with cwd `$HOME`
while its **code** is the main checkout. So the single most consequential live
main-checkout board (this machine's, holding :16180) was reported as an ordinary `$HOME`
directory — the exact case #708 exists to name. Measured: `board_origin_label "/Users/agent1"`
declines (bare path); the code lives at `/Users/agent1/work/agent-workforce`.

## Root cause
The cwd and the code are two different questions; #708 only ever asked the cwd. The defect is
the input, not the classifier. The `$HOME` decline is correct and stays.

## Change
- **board-origin.sh** adds two functions:
  - `board_script_path_from_args <argv>` — pure: the first whitespace token ending in `.js`
    (the node script; flags before it are skipped, args after come later). Empty for a no-.js
    argv (installed-bundle `kosmos start`). `lsof -d txt` returns the node interpreter, not the
    script (measured on the live board), so the argv is the only source — this settles the
    filer's weakest premise.
  - `board_code_dir_from_args <argv> <cwd>` — the script's dir: resolve a relative script
    against cwd, `dirname`, then LOGICAL `cd`/`pwd` (resolves `..`, keeps the symlink spelling
    ps/lsof report; board_origin_label handles symlinks via -ef/-d). Empty when no .js script,
    so the caller falls back to the cwd rather than guessing.
- **run-tests.sh `seen_before()`**: resolve `codedir` from `ps -p <pid> -o args=`, key
  `board_origin_label` on `${codedir:-$cwd}`, and note the cwd only when it is a different tree
  than the code (the #2515 disagreement is the interesting fact). The codedir resolution sits
  OUTSIDE the fail-open ANCHOR block (the block the test extracts by awk stays keyed on
  cwd/codedir and structurally 1 if / 1 else / 1 fi).
- **test-board-origin.sh**: argv-parser arms, resolver arms (abs / relative-to-cwd / `..` /
  no-.js / relative-no-cwd), the #2515 end-to-end property (code=main-checkout, cwd=`$HOME` ->
  MAIN CHECKOUT) with a control that the old cwd input still declines, updated INTEGRATION greps
  (call shape + the new `board_code_dir_from_args` wiring), and the fail-open guard-block
  extraction threads `codedir` through plus a new arm proving the block keys on the code tree.

## Validation
- test-board-origin.sh: all arms pass under its own shebang.
- Live board (pid on :16180): OLD label declined to `/Users/agent1`; NEW label names
  `the MAIN CHECKOUT /Users/agent1/work/agent-workforce`.
- Red-capability: reverting the caller to `board_origin_label "$cwd"` reds the INTEGRATION call
  grep, the `board_code_dir_from_args` grep, and the fail-open `#2515` block arm.

## Scope / decisions
- Kept #708's real-git-fixture test shape and the `$HOME` decline. Kept the accepted-limitation
  and residual arms untouched.
- Logical `pwd` (not `-P`): a board's reported path uses macOS firmlinks (/Users, /var); `-P`
  would rewrite them and disagree with the cwd lsof reports. Correctness is unaffected because
  board_origin_label compares by inode (-ef) and follows symlinks (-d).
- Weakest premise: `board_code_dir_from_args` is unit-tested via fixture argv strings; the one
  untestable line is the caller's `ps -p <pid> -o args=`, a thin probe beside the existing lsof.
  An installed-bundle `kosmos start` argv with no .js yields empty and falls back to the cwd —
  the safe direction — rather than resolving a bundle path; naming that board's code tree is a
  separate follow-up if it ever matters.
