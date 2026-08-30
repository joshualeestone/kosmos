# b8comment-1575: a comment that says something false about the board it names

## The defect

`tools/browser-checks.sh` said the render-create-made check needed its own board
*"rather than joining B8 (which runs without AGENT_WORKFORCE_DRY_RUN)"*.

**B8 runs under dry-run.** Measured on a fresh checkout of main:

```
line 594   boot_board "$sb7" "$P8"     <- B8 is booted by boot_board
line 596   B8="http://127.0.0.1:$P8"
boot_board                             sets AGENT_WORKFORCE_DRY_RUN=1
```

Every real server boot in the script does: six of them, all under dry-run, none
without. (A seventh `node ./server.js` is inside a comment.)

## Why a comment is worth a card

**It already produced a wrong conclusion.** Reviewing #1573, the PM read that line,
concluded a non-dry-run board already existed, and told me my "every board" claim was
overstated. It was not. He had not misread anything: he read the file and the file was
wrong.

A name collision makes it worse: `sb8` is a sandbox with its own explicit boot, and
`B8` is a URL on port `$P8` booted from `sb7`. Adjacent numbers, unrelated objects, so
reasoning from the names gives a defensible wrong answer.

⇒ A comment is unverified prose sitting inside verified code. Nothing tests it, nothing
goes red when it rots, and it borrows the authority of the tested code around it.

## What I changed, and what I deliberately did NOT

**Removed the false clause.** Recorded that it was false, what the measurement is, and
that anyone designing around "the board that runs without dry-run" is looking for one
that does not exist.

🛑 **I did not invent a replacement rationale.** If the stated reason is false, the
temptation is to supply the true one, and I have not established it. What I measured
and stated as measured: the dedicated board omits three vars `boot_board` sets
(`TMUX_BIN`, `FAKE_PANES`, `CONFIG_ROOT`), and B8 is shared by eight other checks while
this one presses a real Create button. **Whether either is the reason it was split out,
I do not know, and the comment now says so.** Replacing a false claim with an
unverified one would leave the file exactly as trustworthy as it was.

## Verification

Comment-only; no behaviour changes. `bash -n` clean. All 19 test files that reference
`browser-checks` pass (4 of them name the script file literally), including `tools.browser-checks-wired`,
`browser-checks-indexed`, `browser-checks-selectors` and `server.test.js`.

Found while working #1556. Card is #1575.
