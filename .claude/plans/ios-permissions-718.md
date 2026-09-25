# ios-permissions-718: permission strings and iPhone only

Card: kosmos #718. Owner: Johnny Cage. From the iOS polish audit (2026-09-25); decisions by
Liu Kang (m634).

## Finished means
- The app carries a permission sentence for the camera, the microphone and adding to Photos, as
  well as Face ID, so iOS does not close it when the board's photo pickers or a long-pressed image
  use them. iOS CI fails if any of the four is missing from the built app, Debug or Release (the
  store build is Release and the strings are set per configuration).
- The app targets iPhone only.
- docs/phone-push-go-live.md lists what App Store Connect will ask before the first upload
  (version, export compliance, push entitlement), whose call each is, and what waits on the runtime
  (app icon, launch screen).

## Decisions
- **Which strings.** Six board inputs are `type=file` (web/index.html): three take images (an
  agent's image, an avatar, "a picture of you"), two take any file (agent and project attachments),
  and one imports Markdown. In a WKWebView those
  offer Take Photo or Video (camera; microphone for video) and the photo library; long-pressing an
  image offers Add to Photos. So camera, microphone and photo-add.
- **Not added: `NSPhotoLibraryUsageDescription` (read).** Choosing from the library in a web file
  input goes through the system picker, which runs outside the app and needs no permission; the app
  never reads the library itself. What would change this: the simulator showing a permission
  prompt, or a crash, when picking from the library.
- **Wording** is Liu Kang's, adjusted to what the pages do: plain, says what it is used for.
- **Checked in the built app, not the project file**, because the strings are build settings; the
  check script is usable by hand.
- **iPhone only** (Liu Kang, decided): iPad is not designed or tested, so no iPad layouts or
  screenshots. An iPad still runs it in a scaled iPhone window. The iPad orientation setting is
  removed with it. One setting to undo.
- **Not in code, on purpose:** the store version (Josh's at submission) and export compliance (a
  declaration Josh makes to Apple). Both are in the doc.

## Weakest part
None of this has run on a device: whether iOS offers exactly these options in a WKWebView file
picker, and that the photo-library path needs no read permission, are from Apple's documented
behaviour, not observed here. The simulator pass should use each picker once and long-press an image.
