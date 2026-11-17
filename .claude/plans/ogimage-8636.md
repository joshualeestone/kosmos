# ogimage-8636: link preview pictures show quickly, and a picture that cannot be fetched shows no box (kosmos#8636)

## Finished looks like
- A preview picture that can be fetched shows within a few seconds, on the card's first appearance.
- A picture that cannot be fetched shows no picture box at all; the title and description stay.
- A link without og:image still shows words only (control).

## Measured (11-17, through engine/unfurl from Mortals)
- name.com: page ok (173 ms), its og:image /_nuxt/ogimage.WjYw3rHo.jpeg answers 404 to everyone (curl with and
  without a browser user agent): the site's own broken tag. This is the broken "?" Josh saw.
- github.com: page ok (302 ms), picture ok (147 ms, 126 KB jpeg).
- nytimes.com: page refused 403 (no card at all, as today).

## Cause
- The board put the picture's address on a card whenever the page named one, whether or not the picture could be
  fetched; the picture was first asked for only when the page drew an empty box, so a 404 became a broken box and a
  slow one an empty box that filled late.

## Design (decided)
- warm() fetches the picture with the page. engine/unfurl remembers per picture address whether it loaded (a day,
  1000 addresses), apart from the image bytes cache (ten minutes, 32 MB), so a card never flips when bytes are dropped;
  a verdict older than ten minutes is refreshed in the background while the old one answers.
- withPreviews carries a card only once its picture's verdict is known: good, with the picture; bad, words only.
- The direct /api/unfurl route fetches the picture before answering and leaves out one that fails.
- The page removes a preview's picture box when the picture still fails in the browser (lpvImageFailed, capture).
- Rejected: reserving space or a placeholder (the box is the problem); retrying a 404 sooner (it is the site's answer).

## Weakest part
- "Takes forever" was not reproduced: every fetch measured was under half a second. The likely cause is the picture
  being fetched only on draw, which this removes; a real-board check with Josh's sites is still owed.
