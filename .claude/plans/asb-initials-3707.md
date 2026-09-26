# #3707: the setup assistant shows the guide's initial when it has no picture

Found in 0.6.94 staging QA (PigeonPete): with no picture saved for the guide, the bubble and the chat's header showed a
broken image, while the guide's board card showed "J".

## Finished looks like
A guide with no picture shows its initial on its disc (the board card's tint and ink, face()'s colours) in both the
bubble and the chat's header; a guide with a picture still shows it.

## How
asbAvatar returns a data: SVG wrapping the board card's own face() (review: one renderer of the disc) when the row says
hasAvatar is false, so the two <img>s keep one src each
and their size rules. The disc's colours come from discTint / discInk on the guide's name, as the card's do.

## Decided
Rejected: an onerror swap to initials (it shows the broken icon for a moment and depends on a failed request).

## Weakest premise
The board's hasAvatar is what decides; a picture that exists but fails to load would still show broken (not this card).

## Verification
render-assistant-bubble-3034 B2: both images are the drawn disc with "J" (the old route fails this arm, as the first
run showed); CONTROL: a row with a picture returns the avatar route. 76 pass.
