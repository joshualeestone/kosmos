# #4585: the room composer's caret sits at the end of the visible text

## Finished looks like
- In the project room composer, typing any message, on any line and at any width, the caret sits at the
  end of the text the person sees, in Chromium and WebKit (the Mac app's engine), including once the box
  scrolls with a visible scrollbar. The Direct Message box and the task composers draw their own text, so
  they were never affected (asserted for the DM box).

## Cause (measured on origin/main)
The room composer's textarea text is transparent; the @mention mirror (#2922) draws what is seen, and the
caret belongs to the textarea. They wrapped differently: the mirror inherited the body's letter-spacing
(-0.006em) where a textarea does not, had word-break: break-word where the textarea has normal, and was
sized by offsetWidth (whole pixels, up to 1px narrower). So at some lengths the textarea had wrapped a word
to the next line while the mirror still showed it on the line above: the caret sat several characters from
the visible text (3 lengths of a long sentence at 1400px, 8 at 1180px, both engines).

## How
- CSS: #pj-post and the mirror's text box both set letter-spacing, word-spacing and word-break to the
  textarea's own values (normal).
- pjMentionPaint sizes the mirror to the textarea's real (fractional) width less any scrollbar it shows.

## Verification
- New gated check render-composer-caret-4585.js (23 arms in both engines): layout properties equal, width,
  a per-character wrap sweep at three widths, a scrolling arm with a real scrollbar, the DM box. Against
  origin/main 14/23. The scrollbar subtraction is needed on its own (the scrolling arm fails without it).
- Neighbours: render-room-msgbox-2806 (178), render-chatbox-phone-4108 (48); web.*.test.js 2160.
