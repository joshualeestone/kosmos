# Plan: notif-mock-polish (Josh 0.6.45 fresh-install notes, screenshot 5.44.01)

## What finished looks like
On the first-run Notifications screen (fr-pane-4), the mock macOS notification's
title "App Background Activity" renders **bold** (font-weight 700) at the **same size
as the body** (not larger), and the cog glyph is **centred** in the gray icon box both
vertically and horizontally. A browser-check pins both against the computed style so
neither can silently regress again.

## Why it kept regressing (root cause)
Josh has asked three times. The title never became bold because `.s4-nt` is a **bare
class (0,1,0)** and loses the cascade to `#firstrun .fr-body p` (0,1,1,1), which forces
`400 1.0625rem` onto every first-run `<p>`. Every prior "make it 700" edit to the bare
class was silently overridden to weight 400 — a computed-cascade fact a source read and
a casual screenshot cannot see. (I myself told Josh earlier it was "already bold in the
code"; the code said 700 but the computed weight was 400.)

## Changes (web/index.html, fr-pane-4 <style>)
- Title: `.s4-nt` → `#firstrun .fr-body p.s4-nt{font:700 1.0625rem/1.6 ...}` — scoped to
  WIN the cascade, exactly as the sibling captions do (p.fc-eyebrow / p.s2-say /
  p.s3-step-cap, per the trap documented at the p.s2-say rule). Bold at the body's
  rendered size, so bold-not-larger.
- Cog: `.s4-gear` centred with `display:flex; align-items:center; justify-content:center;
  line-height:1` (was `display:grid; place-items:center` on a line box that let the
  U+2699 gear's ascent push it high-left). Cog glyph size unchanged (Josh: size is right).

## Tests
`docs/browser-checks/render-firstrun-stepcap-gear-0640.js` extended: assert the title
computed weight >= 700 AND its font-size == the body's (both arms), and the cog is
flex-centred (display:flex, align+justify center). chromium + webkit, 16/16 pass. The
weight assertion reds against the pre-fix page (ntWeight 400), which is how the bug was
found.

## Rejected
- Shrinking both title and body to the intended 0.6875rem (11px): the bare `.s4-*` rules
  were designed at 11px but the cascade bug renders them at 17px. Restoring 11px would be
  a size change Josh did not ask for (he approved the current cog size against the current
  text). "Bold, not larger" is satisfied by matching the body's rendered 17px, bold. Weakest
  premise: Josh may actually want the smaller, more realistic notification size — if so it
  is a one-line follow-up; I will show him the screenshot.
- Verifying by screenshot alone: my first render looked bold to the eye but the computed
  weight was 400. The computed-style assertion is the real check.

## Verify
Screenshot rendered (headless): title clearly bold at body size, cog centred. Browser-check
16/16. Full gate to run once the box is free.
