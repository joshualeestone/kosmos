# Android shell evidence for #718

![Seven-panel Android 15 contact sheet comparing the legacy Kosmos launcher icon with the new gold adaptive icon, wallpaper-themed monochrome icon, circle and rounded-square mask previews, gold K splash, light system bars, and dark system bars.](contact-sheet.png)

This sheet was captured from the `kosmos718` Android 15 AVD using the signed
release APK for `io.kosmos.app`.

- Before: the legacy density icon from the previously installed build.
- After: the adaptive icon under Pixel Launcher's circular mask.
- Android 13+: the monochrome K rendered by Pixel Launcher's themed-icon mode.
- Mask preview: the installed adaptive icon layers clipped on-device through
  circle and rounded-square paths. The Play system image exposes only Pixel's
  circular launcher mask and does not permit root overlay fabrication, so the
  second shape is explicitly labeled as a preview rather than another launcher.
- Cold start: Android Browser Helper's transferred TWA splash after adding its
  required private `FileProvider`. The gold field and centered white K replace
  the previous white handoff.
- Light and dark mode: the site remains dark, while Android-controlled status
  and navigation bars switch between the qualified shell colors.

The mask preview loads `io.kosmos.app` through Android's package manager and
draws its installed `AdaptiveIconDrawable` background and foreground. Both
shapes retain the complete dotted K with visible margin.
