# hoverflake-5298: render-newlook-4470's Agents-list hover-border arm stops flaking (kosmos#5298)

## Why
listLook hovered the first plain #alist .lrow, slept 150 ms, then read borderTopColor. Two full runs failed the arm with
exactly the RESTING value (rgba(0, 0, 0, 0)), then passed on retry. A resting value, not an in-between one, says :hover
had not applied at read time. Reasoned mechanism: the board redraws the list between the hover and the read, and a
replaced row is not :hover until the pointer moves.

## Change (docs/browser-checks/render-newlook-4470.js only)
- Up to three tries: move the pointer away, hover the row, then waitForFunction (1 s) until the row matches :hover, and
  read the border, background image and colour IN THAT SAME page turn. A replaced row fails the :hover gate and is
  re-hovered.
- The wait gates on :hover ONLY, never on the border, so a missing hover rule still reads the resting border and goes red.
- If no try sees :hover, it falls back to the old read, so the arm reports what it sees instead of throwing.
- Deviates from the card's proposal (wait until the border is not transparent): that wait would turn a removed hover
  rule into a pass-after-timeout or a timeout, not a clean red with the value.

## Proof (browser-checks.sh, allowlist render-newlook-4470, on Agent1s 10-06 11:05-11:07)
- PASS arm at the fix 118e98232: rc 0, 301/301, all 3 hover arms PASS.
- CONTROL, a COMMITTED throwaway (1b20da031, the hover rule removed; never pushed): rc 1, the hover arm FAILS 9/9
  (3 views x 2 runs + retry), reading the resting rgba(0, 0, 0, 0). Two earlier controls were vacuous (uncommitted:
  browser-checks.sh serves the committed HEAD).
- After the rebase onto main 10-06 (web/index.html moved ~2,000 lines; this file did not): run alone headless, 301/301.

## Weakest premise
That the flake is the harness race and not a real moment where a row under the pointer shows no border. Not measured:
the original two failures were never reproduced on demand.
