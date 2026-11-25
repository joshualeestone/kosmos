# agerating-7352: the store docs say what is entered in App Store Connect (kosmos#7352)

**Posture:** documentation only (ios/store/*.md). No app or board code.

**Finished looks like:** age-rating.md holds every answer entered for 1.0, and README.md says what was entered and what was not.

## Change
- age-rating.md: three rows Apple now requires (social media No, guns or other weapons None, health or wellness topics No),
  the six fields left blank, and that the set was entered and read back on 2026-11-24 (Apple's result: 4+).
- README.md, listing.md and privacy-label.md: "nothing entered in App Store Connect" was true until 2026-11-24 and is replaced.

## Checked
- The 23 entered answers were read back through the App Store Connect API and match, field by field.
- ios/store/check-listing.sh passes (it also checks these files for em dashes).
- "No location code": no CoreLocation, CLLocation, MapKit or location prompt under ios/ on main. "No dating feature": "dating" in the
  Swift sources is only part of "updating". "No public feed": true of the native screens, and of the web view only with kosmos#9028.
- Price, rights, countries and the 11-17 entries: read back through the API the day each was entered (kosmos#7352).

## Not in this change
README.md's "For Josh" list below is from October and several of its items are done; #7352 holds the current list.
