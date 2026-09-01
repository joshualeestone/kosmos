# #1664: say what the deploy actually ships, at the line that misled a reader

**Branch:** `carrydoc-1664` · **Card:** kosmos#1664, which is **CLOSED**. This is the comment
that stops the card being filed a second time, not a fix.

## The defect, and it is in the prose rather than in the code

The deploy step is one line:

```
site_deploy_export "$SITE" "$_site_export" "$SITE_SHA" || { ... }
```

**The name does not say where its content comes from.** A careful reader with only that line to
go on inferred that the deploy publishes the shared site checkout's WORKING TREE, filed #1664,
and proposed making the deploy commit-only.

🛑 **That change would have removed the only path by which release artifacts reach the site.**
The premise was wrong and the reasoning from it was sound, which is exactly the shape a comment
fixes and a test does not.

## What is actually true, verified against the code before the comment was written

```
PAGES AND EVERYTHING TRACKED   from the COMMIT, via git archive       site-deploy.sh:69
dist/*.tar.gz and .sha256      from the WORKING TREE, on purpose      the carry path
_site_carry_allowed            REFUSES a carry-path that is tracked   ls-files --error-unmatch
_site_left_behind              prints what the tree held and did not ship
```

⇒ **A half-edited page in the shared site checkout cannot ship. That is not a hazard, it is the
guarantee.** The working-tree carry exists because the release writes the bundles there and git
does not carry them, and it is untracked-only because `_site_carry_allowed` refuses otherwise.

## Division of labour, stated in the comment itself

**The comment stops the change being STARTED. The test stops it LANDING.** Neither substitutes
for the other, and **#1664 is the evidence that the test alone was not enough**: the card was
filed and a fix proposed, and that fix would have reddened `test-site-deploy-export.sh` only
after the work had been done.

## Verification

Every claim in the comment was checked against the code, with a control phrase reading 0. Then
the cited test was **RUN rather than cited**, because a committed comment asserting a guard that
is not there is a defect I shipped once already today and the suite stays green through it:

```
bash tools/test-site-deploy-export.sh
EXIT CODE = 0            <- the verdict, not the tally
site-deploy-export: 0 failures

PASS  the versioned bundle pair ships          <- both arms the comment names,
PASS  the untracked stray does not ship        <- present in the RUN OUTPUT
```

## Weakest premise

**I did not reproduce the original misreading with a second reader.** What #1664's author
inferred comes from the card, not from watching anyone read the line. If the spot is still
unclear, the fix is to sharpen the comment rather than to conclude it was unnecessary.

## Scope

`tools/release.sh` only, 22 added lines, all of them comment. No other queued item touches that
file. Held for the post-demo batch.
