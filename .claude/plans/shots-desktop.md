# shots-desktop: a desktop size for mobile-shots.js (claude-setup#100 item 4)

Josh's ask (claude-setup#100): /design-shots takes light and dark x desktop and phone, in one folder named per card,
for the design reviewer. mobile-shots.js is the one screenshot path with the real-account leak guard ("THE ONLY
SANCTIONED WAY TO TAKE SCREENSHOTS FOR A PR"), and it has phone sizes only.

## Change
- `desktop: { width: 1280, height: 800, dpr: 1 }` in SIZES, not in the default sweep.
- For desktop: no touch and no isMobile, and the tap-target / field-font audits (phone rules) are skipped.
- README row: the new size and the four-shot command /design-shots uses.

## Decided
- Extend mobile-shots rather than have the skill take desktop shots another way: any other path skips the leak
  guard, and these shots go to GitHub.
- 1280x800 at dpr 1: the width most render checks already use for "computer", and small files.

## Verified
- `--sizes desktop,iphone15 --themes light,dark --engines chromium --screens home,settings`: 8 shots, 0 errors;
  the desktop dark shot shows the desktop tab layout, the phone light shot the burger layout, and the tap audit
  reports on the phone only (home: 7) and 0 on desktop.
- Main's SIZES has no `desktop` (0 mentions), and parseArgs throws `unknown size` for any name not in SIZES (read from source, not run).
- browser-checks-reason-grep, tools.mobile-shots-leak-718 and browser-checks-pr-select-4119 tests: 32/32 (no new
  FAIL lines, so the reason-grep count is unchanged).
