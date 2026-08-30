# b8comment-1575: a comment that says something false about the board it names

## The defect

`tools/browser-checks.sh` said the render-create-made check needed its own board
*"rather than joining B8 (which runs without AGENT_WORKFORCE_DRY_RUN)"*.

**B8 runs under dry-run.** Measured:

```
:601   boot_board "$sb7" "$P8"     <- B8 is booted by boot_board
:603   B8="http://127.0.0.1:$P8"
:290   boot_board sets AGENT_WORKFORCE_DRY_RUN=1
```

Every `node ./server.js` boot site in the script sets it: six sites, at 280, 292, 522,
549, 551, 583, none without.

⚠️ **That scoping is load-bearing, not decoration.** `boot_thread_server` (line 298,
invoked at 769) is a real, invoked server boot that sets NO dry-run. It runs
`thread-server.js` rather than `server.js`, so it falls outside the claim as worded and
would falsify the looser "every server boot".

## Why a comment is worth a card

**It already produced a wrong conclusion.** During review of #1573, the PM read that
line, concluded a non-dry-run board already existed, and reported that my "every board"
claim was overstated. It was not. He had not misread anything: he read the file and the
file was wrong.

A name collision makes it worse: `sb8` is a sandbox with its own explicit boot, and
`B8` is a URL on port `$P8` booted from `sb7`. Adjacent numbers, unrelated objects.

⇒ A comment is unverified prose sitting inside verified code. Nothing tests it, nothing
goes red when it rots, and it borrows the authority of the tested code around it.

## What the comment now says

The false clause is gone, **paraphrased rather than quoted**, so a substring search for
the false form no longer surfaces this file. The causal claim that rested on it ("and it
is why this check needed a dedicated board") is gone with it: if the stated reason was
false, the claim built on it cannot stand either.

🛑 **It does NOT supply a replacement rationale.** When a stated reason is false the
temptation is to supply the true one, and I have not established it. The comment says
the reason is not recorded anywhere I could find, and stops. Replacing a false claim
with an unverified one would leave the file exactly as trustworthy as it was.

## Three of my own claims that had to be corrected during review

Recorded because the card is about false prose and my corrections kept producing more.

1. **A count of how many checks share B8.** I wrote half the real number. It is
   SIXTEEN; I counted a `head -8`
   display instead of the data, inside a paragraph headed "measured rather than
   assumed". I fixed it in the comment and **left it standing in this plan**, where a
   third review pass found it.
2. **A claim that no server boot lacked dry-run.** Findable-false, per `boot_thread_server`
   above. Narrowed to `node ./server.js` boot sites in the comment, and again left
   stale here.
3. **An orphaned sentence.** My correction paragraph pushed "restated by Ice Cream
   Kitty (#826)" away from its subject so it read as describing my #1575 correction. I
   gave that sentence a subject and did not notice the identical problem one clause
   later in "before this PR wired it in".

⭐ **The pattern in all three: I fixed the instance in front of me and left its copies.**
That is the same defect as the comment this card exists to fix, committed three times
while fixing it.

## Scope: not quite comment-only, and this plan should say so exactly

Three em dashes were removed. Two are in comments. **The third is inside a
`log "PASS ..."` string that prints to whoever reads the gate output**, which is an
emitting surface rather than a reviewing one. That is the single executable line this
diff changes.

Checked before touching it: `tools/release.sh:371` is the only consumer and filters with
an anchored `grep -E '^PASS |^FAIL |...'`. `log()` is a bare `printf '%s\n'`, so
`^PASS ` still matches, and `on retry:` does not newly match the unanchored `retried:`
alternative. Nothing asserts the wording.

Verified mechanically: stripping comment lines from this file and from `origin/main` and
diffing leaves exactly that one line.

## Verification

`bash -n` clean. All 19 test files referencing `browser-checks` pass (4 of them name the
script literally). Full validation PASSED, 3105 tests, 0 fail. Em dashes: 0 in the file
across all five spellings, against a control showing 3 on `main`.

Card is #1575. The wider em dash spread across `tools/` is #1381, where I recorded the
measurement rather than opening a duplicate.
