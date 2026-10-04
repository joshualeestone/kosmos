# phone-taps: Monday's phone sweep, the newcomer's first screens (#5218, #5219, #5220, #5221)

Splinter 23:42: audit the screens a Kosmos+ newcomer hits on a phone; card; fix as after-Monday PRs. MERGE AFTER
MONDAY (main is frozen until the 07:00 pin).

## Done looks like (touch screens and any coarse pointer only; desktop unchanged)
- #5218, the agents board: each agent's name (.namego) has a 44px hit area (centred ::after); a notice's close the
  same; the menu's tabs and Sort agents are 44 tall.
- #5219, a project's room: a document row and Try again are 44 tall.
- #5220, AI settings: the terminal box (#d-term-say) is 16px text, because under 16 iPhone Safari zooms the page on
  a tap, and 44 tall; Open Terminal, Remove this agent, Send and Trust & Restart are 44 tall.
- #5221: Sort projects, Upload an org chart and Join Kosmos+ are 44; the Tasks back chevron keeps its 32px circle with
  a 44px hit area.
- Deliberately KEPT, measured, not missed:
  - the room header's 36px areas (#4663): at 44, render-room-msgbox-2806's pixel scan found 64px of the breadcrumb
    answering as Back, and View All as + New task on a tablet; reverted to 36
  - the composer's file, emoji and Post: #4108's row
  - the reaction chips (36): repeated in every message
  - Answer (about 40): a 44 area reaches the next row (its own comment)
- docs/browser-checks/mobile-shots.js gains a covers audit beside taps:
  - across every control's own box (every 3px, edges included), a tap must land on that control
  - a point answered by another control OUTSIDE that control's drawn box (1px slack for a snapped shared edge) is a
    cover: a hit area taking a neighbour's tap
  - a control drawn on top (an open menu) is stacking and does not count

## Measured
- mobile-shots, 9 screens x SE and iPhone 15 x light and dark (36 shots):
  - small taps: before home 7, login-notice 8, nav-menu 9, project-room 13, AI settings 5, others 1 each; after
    0 except the kept ones above
  - covers 0
- Covers audit controls:
  - the room header back at 44 reads a cover (View All <- + New task), as the pixel scan does; a 15-point sample did
    not, hence the dense scan
  - the open menu over Sort agents is not a cover
  - edge-to-edge view toggles are not covers (1px slack)
- render-phone-taps-5218.js, all PASS:
  - light and dark at 390 with touch
  - desktop control: the name keeps its 16px line and no hit area; the terminal box keeps 15px
  - against main: 8 FAILs (names, Sort agents, the 15px terminal box, 34px buttons)
  - a 600px name area: covers FAIL (the scan can fail)
  - names have no control within even a 160x120 area (0 covers in both datasets), so 44 is safe there
- render-room-msgbox-2806 passes (the room header kept at 36). Wiring 12/12.

## Weakest premise
- WebKit not re-run tonight (the box hung on WebKit earlier); Chromium with touch + isMobile stands in.
