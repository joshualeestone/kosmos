# #4585: the room composer's caret sits at the end of the visible text

## Finished looks like
- In the project room composer, typing any message, on any line and at any width, the caret sits at the
  end of the text the person sees, in Chromium and WebKit (the Mac app's engine), including once the box
  scrolls (it shows no scrollbar in either engine, which the check asserts). The Direct Message box and the task composers draw their own text, so
  they were never affected (asserted for the DM box).

## Cause (measured on origin/main)
The room composer's textarea text is transparent; the @mention mirror (#2922) draws what is seen, and the
caret belongs to the textarea. They wrapped differently: the mirror inherited the body's letter-spacing
(-0.006em) where a textarea does not, had word-break: break-word where the textarea has normal, and was
sized by offsetWidth (whole pixels, up to 1px narrower). So at some lengths the textarea had wrapped a word
to the next line while the mirror still showed it on the line above: the caret sat several characters from
the visible text (3 lengths of a long sentence at 1400px, 8 at 1180px, both engines).

## How
- CSS: the mirror's text box takes the textarea's letter-spacing, word-spacing and word-break (normal).
- pjMentionPaint places and sizes the mirror from the textarea's real (fractional) box, not offsetLeft/Top/
  Width. The width part is what mattered (587.25px wide at 1400px); the position part is defensive: at every
  layout measured, today's look and the new look, the textarea sits at a whole-pixel offset.
- A ResizeObserver on #pj-post repaints the mirror when the composer's width changes with no window resize.
- The textarea shows no scrollbar in either engine (.cinput hides it), so its full width is its text's width;
  the check asserts that premise rather than subtracting a scrollbar.

## Verification
- New gated check render-composer-caret-4585.js (29 arms in Chromium and WebKit, 15 in Chromium alone, gated on Chromium):
  layout properties equal; real width; text starts at the textarea's text (today and the new look; guards,
  their control does not fail at these layouts); a per-character wrap sweep at three widths (fails on
  origin/main); no scrollbar once scrolled; a width change with no resize re-sizes the mirror (fails
  without the ResizeObserver); the DM box. Against origin/main 14 of the then-23 arms passed.
- Neighbours: render-room-msgbox-2806 (178), render-chatbox-phone-4108 (48); web.*.test.js 2160.
