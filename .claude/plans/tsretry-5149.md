# tsretry-5149: retry codesign when Apple's timestamp service blips

Card: kosmos#5149. Branch: tsretry-5149.

## Done looks like
- A codesign at bundle build (step 4) that fails with "The timestamp service is not available" is tried
  again after 5, 15 and 45 s (four tries), each retry printed; after the last it fails exactly as before.
- Any other codesign failure (identity, keychain, errSecInternalComponent) fails at once with codesign's own
  exit status and message, no retry.
- Both Developer ID signs in tools/build-kosmos-bundle.sh (the Plus connector and the native app) use it.

## Steps
- [x] tools/lib/codesign-retry.sh: codesign_ts_retry. Delays from KOSMOS_CODESIGN_TS_DELAYS (default "5 15 45";
      empty = one try); codesign from KOSMOS_CODESIGN_CMD (the test's seam). Output indented four spaces as before.
- [x] tools/build-kosmos-bundle.sh: source it; both `codesign ... 2>&1 | sed` signs become `codesign_ts_retry ...`.
- [x] tools/test-codesign-retry-5149.sh (20 checks, function stubs; also: an upper-case message is retried, nocasematch is restored, a `*` delay is not glob-expanded): blip twice then succeed; locked keychain stops
      at once with exit 3; never answers -> 4 tries then fail; first-try success; argv verbatim; empty delays;
      the build script signs through it and has no bare timestamped codesign (incl. --timestamp=). Wired into test:shell.
- [x] Controls: a lib that never retries reds 6 checks; origin/main's build script reds the 3 wiring checks.
- [x] Smoke with the real codesign (ad-hoc, --timestamp=none) through the wrapper: signs, exit 0.

## Not in scope
- productsign (step 3c, the installer) also timestamps against Apple, with a message I have not seen.
  Not guessed at here; a separate card if it blips.
- release.sh resuming after step 3 (the card's 70-minute cost) is a different change.
