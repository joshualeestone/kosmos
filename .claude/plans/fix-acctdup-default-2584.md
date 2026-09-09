# fix-acctdup-default-2584 — disambiguate a second default account's reauth name

## Problem

The 0.6.51 release cut of latest main (frozen e6d5afd3) failed browser-checks
step 3b on a real accessibility check, reproduced twice:

    settings: accounts: no two controls answer to the same name  -> 1 FAILED

Introduced by #2584 (89c23027), which wired the OpenAI ChatGPT "Sign in again"
reauth-in-place affordance. #2584 + April's #2580 are stranded off main until 3b
goes green again.

## Root cause

Settings > Accounts renders each account row's reauth control with

    aria-label = "Sign in again as " + who + (qual ? " (" + qual + ")" : "")

where `who = acctPrimaryName(a)` and `qual = accountQualifiers(list).get(dir)`.

`accountQualifiers` computes a per-account qualifier ONLY within a "key-group" —
rows that share a key (`acctChosenName || email || openai keyTail`). Within a
group it hands out distinct qualifiers so two rows never read alike, and it
reserved the token `main` for "the default row".

That reservation assumed exactly ONE default per key-group. It is not: each
PROVIDER has its own default. On this box the accounts are josh@book.io on
~/.claude (the Claude default) and josh@book.io on ~/.codex (the OpenAI ChatGPT
default). They share the key `josh@book.io`, so both landed in one group, and
BOTH took `qual = 'main'`. Their aria-labels were therefore identical —
"Sign in again as josh@book.io (main)".

Before #2584 only Claude subscription rows carried a reauth button, so the two
`main` rows never both rendered one and the collision was latent. #2584 gave the
OpenAI ChatGPT default a reauth button too, making it live. The code comment in
`accountQualifiers` predicted this exactly: deferred finding 9 was "moot only
while there is exactly one default ... if you widen what a row can be further,
re-check finding 9." #2584 widened it.

## Fix

Let `main` participate in the same per-key `used-set` as every other qualifier.
The FIRST default in a key-group keeps `main`; a SECOND default falls through to
the ordinary path — its label, else its unique `dir` (dir is unique per row by
construction, the existing collision-proof last resort). So the two reauth
controls stay distinct.

The change is confined to the `usedByKey` loop in `accountQualifiers`
(web/index.html): both branches now consult and populate the used-set, and the
default branch only claims `main` when `!used.has('main')`.

## Decisions and rejected alternatives

- **Rejected: add the provider name to every reauth aria-label** (Baron's initial
  hint). The qualifier mechanism already handles same-provider collisions and is
  the single disambiguation seam; threading provider into the label everywhere is
  redundant on the common case and would touch render sites and other browser-check
  assertions. Reusing the existing used-set is the minimal, in-architecture fix.
- **Rejected: a friendlier fallback than `dir` for the second default** (e.g. the
  provider). `dir` is the existing collision-proof last resort the code and the
  qualifier unit test already endorse; a provider fallback is not collision-proof
  (two same-provider defaults could recur) and adds a code path. The dir path is
  rare (two defaults, same email, cross-provider) and correct.

## Weakest premise

That `dir` is always unique per row. This is true by construction today (`list()`
skips a directory it has already seen) and is the same assumption the pre-existing
non-default fallback already rests on, so the fix inherits no new fragility. If a
future `list()` could yield duplicate dirs, both the old and new fallbacks break
together, and the qualifier unit test's "duplicated row with no label" arm guards
that seam.

## Verification

- web.account-qualifier.test.js: added a two-default cross-provider test. It reds
  on the pre-fix page (both defaults get `main`) and greens on the fix. Confirmed
  by extracting `accountQualifiers` from origin/main (both -> `main`) vs the fix
  (Claude default -> `main`, OpenAI default -> its dir).
- Full account test set green: qualifier, reauth-1492, openai-subscription-picker-2338,
  account-name-2095, accounts-add/badge/history, acct-picker-1917, create-account,
  openai-add-978, openai-alldead-1561, openai-only-banner-2096, openai-row-2568,
  reauth-reach-1918, switch-account-1373.
- Live docs/browser-checks/named-controls.js against a board reading this box's
  real accounts: the three "settings: accounts" assertions PASS post-fix
  ("no two controls answer to the same name" PASS). Negative control on the
  pre-fix board reproduced the exact failure: "Sign in again as josh@book.io (main) x2".
- Full-suite validation (tools/run-tests.sh) is gated on the release machine claim
  (release 0.6.51 holds the box until ~16:13 CDT); run against the freed box before merge.
