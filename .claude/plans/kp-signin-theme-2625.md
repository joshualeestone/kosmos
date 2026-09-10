# Plan - #2625: Kosmos Plus tab sign-in + brighter navy theme + Join Kosmos+ CTA

**Card:** joshualeestone/agent-workforce#2625 (labels: claimed:monalisa, josh-review)
**Surface:** the in-app Kosmos Plus tab, `web/index.html` state1 (`#plus-state1`).
**Reference (source of truth):** `kosmos-relay/deploy/www/kosmosplus/design/first-step.html` HOME view.

## Why

Josh product-review of the live in-app Kosmos Plus tab against the established design.
Three defects, all in state1 (the resting, unpaid view most people see):

1. The Kosmos Plus sign-in affordance that first-step.html shows **above the logo**
   ("Already have Kosmos+? Sign in") is missing in the app.
2. The `#1615` blue reskin painted the whole-app ground flat near-black `#070c16` and
   reads "super duper dark". first-step.html / kosmosplus.com use `#070c16` only as an
   outer frame; the dominant, on-brand ground is the navy radial-gradient.
3. The bottom button reads "See Kosmos+"; Josh wants "Join Kosmos+" with an
   "Already a member? Sign in" link beside it (both matching first-step.html's foot CTA).

## What changes (web/index.html only, plus one test-comment)

1. **Sign-in above the logo.** Add `<p class="plus-topbar">Already have Kosmos+?
   <a id="plus-signin-top" ...>Sign in</a></p>` immediately above the `#plus-mark`
   canvas.
2. **Theme.** In `body.plus-active`, paint the navy radial-gradient (stops copied
   verbatim from first-step.html's `.app`) as the ground, and lift `--k-bg`/`--bg`
   off `#070c16` to `#132140` so no solid patch stays near-black.
3. **Bottom CTA.** `See Kosmos+` -> `Join Kosmos+`; add `<a id="plus-signin-bottom"
   ...>Already a member? Sign in</a>` beside it; wrap both in `<p class="plus-cta">`.
4. **JS.** In `paintPlus()`, set the two new links' `href` to `KOSMOS_SITE + '/plus'`
   (the same served route as `plus-site-link`).
5. New CSS: `.plus-topbar`, `.plus-cta`, `.plus-signin-link`.

## Design decisions (and weakest premises)

- **All three affordances are `<a>` links, not `<button>`s.** This keeps state1
  control-free so `web.plus-tab.test.js`'s no-controls-in-state1 rule holds, and it
  matches first-step.html's own top "Sign in" (an `<a>`). It also honors #1115
  (signup happens on the site, not in the app): every affordance points at the site.
- **All three point at `KOSMOS_SITE + '/plus'` (installkosmos.com/plus), which serves
  (200).** The `/+` route 404s (measured in-code) and a link onto a 404 is the exact
  "misleading link" the pane's own guards forbid. **Weakest premise:** Josh asked the
  sign-in links to go to "the sign-in on the website"; ideally the two Sign-in links go
  to login.kosmosplus.com's direct sign-in. That relay is not yet live/branded (#2626),
  so pointing at the served /plus (which routes onward to Join/Sign in) is the honest
  interim. When login.kosmosplus.com is live and branded, move the two sign-in links to
  its direct sign-in route. Reversible one-line JS change.
- **The "Sign-up is not open yet" honesty paragraph (#1115) is left in place**, out of
  scope for #2625's three asks, and the site is the source of truth for open/not-open.
  (Left as a hyphen-only file per Josh's no-em-dash rule.)

## Verification

- Full node suite (`node --test engine/*.test.js *.test.js`): expect all pass.
- `web.plus-tab.test.js` + `web.plus-route.test.js`: green (no `<button>` in state1;
  `plus-site-link` id kept; markup carries no hostname; paintPlus keeps
  `KOSMOS_SITE + '/plus'`).
- Browser: the Plus tab is JS/canvas-driven and this session cannot drive Playwright.
  Static + unit verified; theme values copied verbatim from first-step.html. A live
  `claude-fe` browser verify of the navy theme + the two links is the documented
  follow-up (Browser-check trailer on the commit).

## Out of scope

- The kosmos-relay signup/login screens branding (#2626).
- The `/+` site route (Angel, chaoskosmos-site).
- Removing the "not open yet" paragraph or restructuring the state2 sign-in flow.
