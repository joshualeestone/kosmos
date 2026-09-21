---
pre_challenge: true
method: challenge-loop
branch: tz-friendly-3338
diff_hash: 6fc9c5fc7108564e0e1d3b7a395dac734f264f951b138f5fa7f01b865771bfb3
validation: passed
subdir_audit: passed
timestamp: 2026-09-21T00:00:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (one adversarial review that found a real UX blocker + fixed it; a
second pass that re-verified and found nothing further).
**Converged:** Yes.
**Net:** #3338 replaces the raw ~400-entry Intl IANA `<select>` on the onboarding
About-you step and in Settings with a friendly US-first zone list plus a
"search by city or ZIP" accelerator. Renderer + static data only; no engine change.

#### Iteration 1 (adversarial self-review of the full diff)

- **[BLOCKER] the search resolver jumped the select on a single letter, mid-typing.**
  `youTzResolve` did an unguarded substring match over the friendly label AND the raw
  IANA id, so typing "d" (the first letter of "Dallas") matched `america/denver` and
  jumped the select to Denver, then cleared on "da". A picker that flickers to the wrong
  zone while the operator is still typing a city is exactly the "confusion" #3338 is
  meant to remove. FIXED: the free-text substring match is length-gated to >= 4 chars,
  and the short cases that SHOULD resolve (zone abbreviations ET/CT/MT/PT/AKT/HT) are
  added as exact `YOU_TZ_PLACES` keys. GUARDED by two new tests: "a single letter does
  NOT jump" and "abbreviations and zone words resolve (CT, central, pacific)".

- **[STRENGTH] the ZIP table is correct-or-silent, verified exhaustively on the risky
  cases.** A hand-built ZIP->zone table is error-prone at split-state borders, so only
  ranges wholly inside one zone are listed; split prefixes resolve to '' (no jump). An
  adversarial probe confirmed every split-state ZIP (El Paso 79901, Portland OR 97201,
  Nashville 37201, Indianapolis 46201, Idaho 83201, KC-KS 66101, ND 58101) returns ''
  — never a wrong zone — while McKinney (75454/75070), Beverly Hills (90210) and NYC
  (10001) resolve correctly.

- **[NIT] dead code + a redundant import.** `YOU_TZ_FALLBACK` and every
  `Intl.supportedValuesOf` call became unreachable once the friendly list replaced the
  raw enumeration. Removed the const; confirmed by grep that no runtime reference
  remains, and the real page renders with zero page errors (so no ReferenceError).

#### Iteration 2 (re-verification, no new findings)

- **[STRENGTH] the server contract is untouched.** The select's value is still the
  canonical IANA id and the save path still `POST /api/settings {timezone}`; the
  browser-check catches the REAL POST and asserts `posted === selected` (America/Chicago
  on this Central machine). The diff touches zero engine/server files — exactly Splinter's
  "no engine split" ruling.
- **[STRENGTH] detection + custom zones still honored.** `youTzFillSelect(sel, want)`
  inserts+selects a machine/saved zone that is outside the friendly set (e.g.
  Pacific/Chatham), so auto-detect and a previously-saved custom zone both survive the
  friendlier list. Covered by the "machine zone the enumeration omits is still
  selectable" test.
- **[STRENGTH] non-vacuous coverage.** Each new test can return the failing answer: the
  no-jump tests assert the value is UNCHANGED against a nonsense/short query; the jump
  tests assert a SPECIFIC zone; the browser-check drives real input events through the
  shipped `youTzWireSearch` in Chromium, not a stub.
- **[house style]** no em dashes in any user-facing string; the two visible strings
  ("Set to ... Save to confirm.", the hint) use plain punctuation.

### Validation
`web.timezone-1668.test.js` 11/11; `web.firstrun-you-behaviour.test.js` 2/2; the full
web suite 1512 pass / 0 fail; `server.test.js` 304/304; the page script `node --check`
clean; `render-firstrun-namestep-1994wiz.js` all arms pass in real Chromium (friendly
label, search input, Dallas->Central, 90210->Pacific, no-move, save POST correct);
adversarial ZIP probe all-correct. Pixel styling + night-mode is Josh's in-app QA on the
live cut (headless cannot reproduce the real compositor).
