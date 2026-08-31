# deployguard-1669: nothing refuses a production deploy made outside the export path

kosmos#1669, filed by Josh after I raised the gap.

## The measurement that decides the shape

There is exactly ONE scripted production deploy in the tree:

```
tools/release.sh:753   ( cd "$_site_export" && vercel deploy --prod --yes )
```

Control: `vercel` appears in 9 files; only this one invokes a deploy.

⇒ The legitimate path always deploys from the export. Every other production deploy is,
by construction, a bare command typed by an agent.

🛑 That kills the obvious fix. A preflight inside our scripts cannot refuse the deploy that
caused the outage, because that deploy never went through our scripts. Anything added to
`site-deploy.sh` or `release.sh` alone guards only the path that was already correct.

## This change: half one of two

**The export marks itself.** `site_deploy_export` writes `.kosmos-release-export` at the
export root, carrying the commit and an export timestamp.

This is the enabling half and is useless alone, deliberately so. It makes "is this directory
a release export?" an answerable question instead of an inference from a path name, which any
checkout could imitate.

**Half two is a `PreToolUse` hook** that refuses a production deploy from a directory with no
marker. It ships separately, in `book-io/claude-setup`, because that is where hooks live and
because it is fleet-wide and wants its own review.

## Ordering, and why this half goes first

The marker must exist before anything requires it. Shipping the hook first would refuse
legitimate releases, which is a worse failure than the one being fixed.

## Two properties I am holding it to

**Best-effort.** A failure to write the marker must not fail a release. The consuming guard
fails toward permitting for the same reason: a check that blocks releases when it breaks is
worse than the defect it prevents.

**A mistake-guard, not a security boundary.** Anyone can create the file. That is the right
strength for the failure it addresses: a careful agent doing a reasonable thing in the wrong
directory, not an adversary.

## Verification

Four arms in `tools/test-site-deploy-export.sh`, and they were proven able to fail: removing
the marker write reds three of them (3 failures) while the CONTROL correctly stays green,
because it asserts the marker is absent from the SOURCE tree and that is unaffected by the
write. Without that control, a stray marker in any checkout would satisfy the other three and
the guard built on them would be worthless.

The pre-existing suite is unchanged and still reports 0 failures.
