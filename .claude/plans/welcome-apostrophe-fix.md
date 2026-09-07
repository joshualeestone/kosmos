# welcome-apostrophe-fix — first-run Welcome eyebrow: "Lets do it" -> "Let's do it"

## Source
Angel's read-only QA sweep of the first-run install wizard (0.6.42/0.6.43, on Splinter's
directive to preempt Josh's "same problems every build" morning re-test). Routed by Splinter to
PR + fold before GO Baron.

## The defect
fr-pane-1 ("Welcome to Kosmos"), the very first install screen, has an eyebrow reading
`Lets do it` -- missing the apostrophe. `.fc-eyebrow` uppercases it, so it rendered "LETS DO IT".
First screen, first impression, and Josh is polish-sensitive.

## Fix
web/index.html:7956 `<p class="fc-eyebrow">Lets do it</p>` -> `<p class="fc-eyebrow">Let's do it</p>`.
A pure typo fix (apostrophe), not a copy rewrite -- so no copy-owner judgment needed (Splinter's call).

## What finished looks like
- The Welcome eyebrow reads "Let's do it" (renders "LET'S DO IT").
- No test asserted the old string (grep-confirmed), so nothing regresses.
- Full node suite green.

## Scope
One string, fr-pane-1. Disjoint from the active 0.6.43 fix-set (fr-pane-2 permission mechanism /
fr-pane-9 find-agents / the fr-pane switch modal Renet is building). Low collision.

## Weakest premise
That no downstream check pins the eyebrow text. Verified by grep across tests + browser-checks +
tools; none matched "Lets do it".
