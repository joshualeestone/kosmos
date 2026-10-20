# avatarcrop-6722: a picture editor before saving

Card: #6722. Josh, Kosmos DM 2026-10-20 08:51: "How hard would it be to create a little avatar editor so if I upload an
image I get some basic cropping tools before i save?"

## Done when
- Choosing a picture for an agent (its page, `#d-file`), for a new agent (`#create-avatar`), or for the person
  (`#you-file`) opens an editor first: the picture under a circle, dimmed outside it.
- Drag moves it; a zoom slider, the wheel, a pinch and +/- zoom it (1x to 4x); arrow keys move it (Shift for larger
  steps); Enter saves, Escape cancels; Tab stays inside the editor; focus returns to what opened it.
- Save gives a 512 x 512 PNG of the square inside the circle; Cancel changes nothing and uploads nothing.
- A phone photo with a rotation tag comes in upright; a very large picture is scaled to 2048 px on its long side
  before editing, so the editor stays quick.
- It works in Chromium and WebKit (the Windows app's and the Mac app's engines), at desktop and phone sizes.

## Decisions
- **One shared function, `cropPicture(file, verb)`**, resolving to a File or null (cancelled), called before the
  existing upload code in all three places. The existing paths are unchanged after it: agent pictures still go through
  `fitPicture` (#4885), which already fits the community's size and type rules, so the editor's output is a clean PNG
  and the encoding stays in one place.
- **GIF skips the editor** and is handed back as chosen: cropping would freeze an animated one. Weakest premise: a
  still GIF also skips it; rare, and still uploads as before.
- **An animated WebP or PNG (APNG) goes through the editor and is saved still** (review 3). Only GIF is exempted by
  type; telling an animated WebP/APNG from a still one means parsing its chunks, and nearly every picture chosen for an
  avatar is a still photo. Weakest premise: someone who picks an animated WebP on purpose loses the motion without being
  told. What would change it: a report of that happening, then exempt by sniffing the ANIM / acTL chunk.
- **A picture the browser cannot open skips the editor** (returned as chosen) rather than blocking the upload; the
  existing paths already cope with such a file.
- **The saved File keeps the chosen file's name** (its type is PNG), so the new-agent hint "<name> will be its
  picture." names what the person picked.
- **The button says "Save" where pressing it uploads** (agent page, the person's picture) **and "Use picture" in the
  new-agent dialog**, where nothing is uploaded until the agent exists.
- **Output is the square, not a circle-cut image**: every place shows avatars round already, and the card asks for
  the square.
- Buttons in the editor are at least 44 px tall (the shared `.btn` is 42).

## Files
- web/index.html: CSS `.crop-*`; markup `#cropmodal`; JS `cropRead`, `cropSide`, `cropClamp`, `cropDiameter`,
  `cropPaint`, `cropMove`, `cropZoomTo`, `cropFinish`, `cropPicture`, `wireCrop`; the three pickers call it.
- docs/browser-checks/render-avatar-crop-6722.js (new, hermetic, chromium + webkit), its README row and gated.txt line.
