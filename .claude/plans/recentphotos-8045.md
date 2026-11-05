# recentphotos-8045: the + opens recent photos at once (kosmos#8045)

Finished means: on a real iPhone in TestFlight, + then a photo puts it in the box, in a chat and a room; Don't Allow and
Select Photos both still add a photo; camera and files stay reachable; the motion looks smooth on the device.

Calls, with reasons, are on the card (comment of 11-05). In short:
- The first + opens the tray and iOS's prompt with no screen of ours before it (Josh ruled asking is fine).
- Access off: "Choose photos" opens the system picker, which needs no permission. Limited: the chosen ones, plus All photos.
- A tap adds the photo, the tray stays open; a second tap takes it back. Send stays a separate tap, on purpose.
- Photos are re-encoded as the camera's are (JPEG 0.85, location left behind); PNG and GIF kept.

Motion, measured frame by frame in a simulator:
- While the tray is open the screen ignores the keyboard (.ignoresSafeArea(.keyboard)), and the tray has the keyboard's height.
  So the keyboard drops off it and rises over it, and the box does not move.
- The tray goes on keyboardDidShow, when the keyboard's room comes back at the same height. A timer covers a hardware keyboard.
- Rejected: a transaction disabling animations (the keyboard lost its slide and the X stopped turning); removing the tray
  at the box's focus or at will-show (the box dropped, then rose with the keyboard).

Tests: AttachMenuUITests (sample tiles, every answer, box held by repeated reads), PhotoTrayRealLibraryUITests (iOS's real
prompt and library, left out of CI), logic suites for wording and rules.

Costs accepted: tray photos land in the order they finish (each add starts at once, so the count and the x hold). Taking a photo
back removes it from the message, and the Mac keeps the file it was sent, as the chip's x does today. Thumbnails may use the
network for an iCloud photo, for any tile drawn, and a request is not cancelled when its tile scrolls off; if that shows on the
phone, make them local with a placeholder. One full-size photo is decoded at a time, so a very large one is a brief memory peak. A GIF goes up whole.

Weakest premise: real Select Photos and a real camera were not run in a simulator; both are on the phone check.
