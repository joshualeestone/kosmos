# shots-desktop: a desktop size for mobile-shots.js (claude-setup#100 item 4)

Josh's ask (claude-setup#100): /design-shots takes light and dark x desktop and phone, in one folder named per card,
for the design reviewer. mobile-shots.js is the one screenshot path with the real-account leak guard ("THE ONLY
SANCTIONED WAY TO TAKE SCREENSHOTS FOR A PR"), and it has phone sizes only.

## Change
- `desktop: { width: 1280, height: 800, dpr: 1 }` in SIZES, not in the default sweep.
- For desktop: no touch and no isMobile, and the tap-target / field-font audits (phone rules) are skipped; the
  console line and report.md say `n/a` for them rather than a 0 that reads as "audited and clean".
- A screen can declare `phoneOnly: true`; the desktop size skips it with a `skip` line. `nav-menu` is one (it
  photographs the ☰ menu, which does not exist at desktop width).
- The gate's existing mobile-shots arm now runs `--sizes se,desktop`, so the desktop path and the phone-only skip
  are exercised in CI (a separate arm is not possible: the driver requires a label to equal its check's file name).
- README row: the new size and the four-shot command /design-shots uses.

## Decided
- Extend mobile-shots rather than have the skill take desktop shots another way: any other path skips the leak
  guard, and these shots go to GitHub.
- 1280x800 at dpr 1: the width most render checks already use for "computer", and small files.

## Verified (review round 1 found my first claim too narrow: I had run 2 of 20 screens)
- The page leak control at desktop (`MSHOTS_LEAK_CONTROL=page --sizes desktop --screens home`): exit 3 with "this screen shows real data", 0 shots written.
- The gate arm exactly (both engines): 14 shots, 0 overflow, 0 errors, nav-menu skipped at desktop, exit 0.
- Full desktop sweep, light and dark, Chromium, all 20 screens: 38 shots, nav-menu skipped, and one screen errors:
  `allow-card`. It errors on origin/main too, at the smallest phone, measured in a detached worktree at 0bc05dc99
  (main's own mobile-shots.js). Filed as kosmos#4524, not fixed here.
- `--sizes desktop,iphone15 --themes light,dark --engines chromium --screens home,settings`: 8 shots, 0 errors;
  the desktop dark shot shows the desktop tab layout, the phone light shot the burger layout, and the tap audit
  reports on the phone only (home: 7) and prints `n/a` at desktop.
- Main's SIZES has no `desktop` (0 mentions), and parseArgs throws `unknown size` for any name not in SIZES (read from source, not run).
- browser-checks-reason-grep, tools.mobile-shots-leak-718 and browser-checks-pr-select-4119 tests: 32/32 (no new
  FAIL lines, so the reason-grep count is unchanged).

## Review round 2 (opus), fixed
- A skipped screen is recorded: `report.md` lists every phone-only skip, `report.json` carries them as entries with
  `skipped: "phone-only screen"`, and the summary counts them.
- A run that takes no shot at all (every requested screen phone-only at the sizes asked for) now fails with exit 2,
  through the existing top-level FAIL line, so the reason-grep count is unchanged. (An unknown --screens name was
  already refused by parseArgs.)
- `audited` is true only once the phone audits actually ran; a phone row whose screen errored reads `n/a`.
- Header, README and this plan's wording brought into line with the desktop size.

## Review round 3 (sonnet), fixed
- report.json entries are one shape: skipped entries carry every field a shot row has, and shot rows carry
  `skipped: null`.
- The zero-shot refusal is decided before Playwright loads or a board starts, so it is unit-tested:
  tools.mobile-shots-desktop.test.js (the refusal, plus a control where a planned shot gets past the check and stops
  at loading Playwright, which the test hides). With the check disabled, the refusal test fails.
- The console line and report.md agree: both say n/a where the phone audits did not run.
- My first version of the refusal also claimed "no screen matched --screens"; that cannot happen (parseArgs refuses
  an unknown screen first), so the claim and its test case are gone.

## Review round 4 (opus), fixed
- My round-3 wording said `--sizes desktop` "adds" a computer screen; `--sizes` REPLACES the default list, so that
  run shoots desktop only. The header and README now say what the flag does instead of making a claim about it.
- The refusal test matches only the exact missing-module text (a checkout path containing "playwright" can no
  longer fail it); the allow-card status line left the README (it would go stale; #4524 is recorded above).

## Review round 5 (sonnet), fixed
- The test no longer depends on Playwright being absent: `MSHOTS_PLAN_ONLY=1` (a test hook, like MSHOTS_LEAK_CONTROL)
  stops the tool right after it decides its plan. The refusal case exits 2; the control (one more screen that is not
  phone-only) exits 0 with "planned 1". Round 4's recorded-not-fixed dependency is gone.
- Skipped report.json entries carry `file: null`.
