# #4151: Kosmos pushes on Android showed Chrome's icon

## Cause
The delegated-notification small icon (`@drawable/ic_notification`, named on `DelegationService`
in `AndroidManifest.xml`) was a vector drawable. androidx.browser 1.4.0's
`TrustedWebActivityService.onGetSmallIconBitmap` hands it to the browser as
`BitmapFactory.decodeResource(getResources(), onGetSmallIconId())` (checked with `javap`), and that
returns null for a vector, so Chrome drew its own icon.

## Fix
The icon is now a white-on-transparent PNG at each density (24dp: 24, 36, 48, 72 and 96 px),
rendered by `make-icons.py` from the old vector's shape. `IconResourceTest` fails if the icon is an
XML drawable again, if a density is missing, or if a PNG is not a white RGBA silhouette of the
right size.

## Proof on the API 35 Moto AVD (2026-09-27)
One real web push through Kano's #4140 local setup (dev coordinator, HTTPS proxy, the real
kosmos-tunnel Mac state), posted each time by `io.kosmos.app` (`usagestats`
`NOTIFICATION_INTERRUPTION package=io.kosmos.app`).

| | Build | Notification icon (`dumpsys notification`) | Shade |
|---|---|---|---|
| Before | installed vc2, vector icon | `Icon(typ=RESOURCE pkg=com.android.chrome ...)` | `before-shade.png`: Chrome's icon |
| After | this branch, vc2, PNG icons | `Icon(typ=BITMAP size=40x40)` | `after-shade.png`: the Kosmos planet |

The records are in `before-notification.txt` and `after-notification.txt`.

Setup notes: the sign-in made a new device, which Kano's test Mac had to allow before the
coordinator would push to it; and `POST_NOTIFICATIONS` had been refused on the AVD before this run,
so it was granted with `pm grant` (the prompt is not what this card tests).
