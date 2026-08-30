# #1599: say so when the sign-in list goes stale while the picker is visible

**Branch:** `stale-visible-1599`
**Card:** kosmos#1599, filed by Angel out of #1373's challenge loop.

## The problem

`fillSwitchAccounts` gated its three announcements on `appearing` (`sel.hidden`, sampled
before the reveal), so they covered **appears-while-stale** and not
**becomes-stale-while-visible**. If `ACCOUNTS_UNREADABLE` became true while the picker was
already on screen, the picker kept presenting rows the page had marked non-authoritative
and said nothing about it.

## What is and is not claimed

The card recorded this as an **uncovered case, not a demonstrated user-visible bug**, and
that is still the honest description. I did not find a user-reachable path to the state
either.

What I did establish is narrower and worth stating exactly: the state is **constructible in
the page's own terms**. `accountsUnreadable()` deliberately does not touch `ACCOUNTS` (a
failed read invalidates the list's authority, not the list), so a repaint in that state
still finds a non-empty list and still takes the visible branch, which is the branch that
had no way to speak. That is why the fix is worth making even with no reproduction: the
guard was aimed at the wrong question, and the next edit inherits that.

## The decision

The card offered two fixes. This takes the **second**: move the announcement out of the
`appearing` gate and dedupe, because it is closer to how the rest of that region works.

Rejected: a second announcement site keyed on the transition into unreadable. It adds a
third place that writes this region, and the region already has an ownership protocol
(`SWITCH_ACCT_SAID`) that a second site would have to re-implement.

**Dedupe on the region, not on the tracker.** Inside the ownership guard the two agree
except in one case: the region is empty and `SWITCH_ACCT_SAID` still names a sentence,
which `changeProviderNow`'s success path produces by blanking the tracker. Comparing
against the tracker would skip a write into a region that is actually silent while our
control is on screen.

**Weakest premise in my own reasoning, named rather than buried:** I am asserting that
gating on the sentence is strictly wider than gating on the transition. That holds for
every path I enumerated, but the enumeration is mine and the call sites are three. If
somebody finds a paint where re-writing an identical sentence is wanted, the dedupe is the
line to revisit.

**What would change my mind:** a reachable path where the picker should re-announce an
unchanged sentence, or a screen-reader behaviour where skipping the identical write loses
an announcement that the old gate delivered.

## Evidence

`web.stale-visible-1599.test.js` runs the real function against a fake DOM. It does not
read the source. The sibling tests on this feature assert on `PAGE` text, and the defect
was a guard that was present, correct on its own terms, and aimed at the wrong question -
the one shape a source assertion cannot catch.

The control rebuilds the pre-fix gate by surgery on the shipped page rather than fetching
`origin/main`, so it does not retire itself at merge and fails loudly if the region moves.

## Deliberately not done

- The residual the block already documents (when the region holds a sentence we did not
  write, the announcement is dropped) is untouched. It wants a second polite region, which
  is a markup change and its own card.
- The one-account-labelled-only-by-a-path silence is untouched. The block records it as a
  copy decision.
