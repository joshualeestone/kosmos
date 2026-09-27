# Your first phone test: Kosmos on the Moto G Play

This is one short script for trying the Kosmos app on your phone, in the order you will meet
things. Each step says what you should see, and what to send us if you see something else. A
screenshot is always enough: press the power and volume-down buttons together.

Some steps depend on updates that are not switched on yet, so they are marked:

- **Wait for the server update**: one Kosmos+ server update, ready now, which you switch on when
  you choose.
- **Wait for the Mac update**: a Kosmos release for your Mac. Three separate Mac-side pieces are
  involved, listed in the table at the end; one of them may already be on your Mac.

Until then those steps behave the old way on purpose, as each step says. That is not the app being
broken. The table at the end lists them in one place.

The card number after each step, like (#4151), is only for us, so we can trace your answer.

---

## 1. Install the app

Use the file **Kosmos-android-test.apk** (version 0.1.2) that Liu Kang puts in your Files, with its
own install note. (#4165, #4090)

1. Get the file onto the phone (email, Google Drive, or a message to yourself) and tap it.
2. Android will say your phone is not allowed to install unknown apps from this source. Tap
   **Settings**, turn on **Allow from this source**, then go back.
3. Tap **Install** (or **Update**, if an earlier test build is already on the phone; nothing is
   lost). If Google Play Protect warns that the app is unknown, choose to install anyway,
   for this file from Liu Kang only. It warns because the app is not in the store yet.
4. Tap **Open**.

**If it looks different:** a screenshot of any message that stops the install.

## 2. Open it and sign in

**You should see:** the Kosmos+ sign-in page filling the whole screen, with no browser address bar
across the top. (#4113, #4090; android/evidence/vc3-4165)

Enter your Kosmos+ email, tap **Send the code**, type the six-digit code from the email, then your
second sign-in step, the same one you use on the web.

- There is no way to buy or subscribe inside the app. It only signs you in. That is deliberate.
  (#718)
- A small "Running in Chrome" note may show at the bottom the first time. Tap **Got it**.
  (android/evidence/cct-warmup-4109)
- If it asks whether Kosmos may send you notifications, tap **Allow**.

**If it looks different:** a screenshot of the first screen, especially if you see an address bar.

## 3. Let your Mac allow the phone

The first time, Kosmos on your Mac shows a card asking whether to allow this phone, with a short
code. **Allow it only if the code matches the one on the phone** (it looks like FK-4H). The phone
then says "Your Mac allowed this device. Opening your Kosmos..." and, for now, opens your board by
itself, with an address bar across the top. That is expected. (#718, #2854)

**If it looks different:** a screenshot of the phone's page, and whether the Mac showed the card.

## 4. Open your board

Close Kosmos completely (swipe it away from the recent apps), open it from its icon, and tap
**Open my Kosmos**.

- **For now:** your board opens with a browser address bar across the top. That is expected.
  (#4090, #2854)
- **Wait for the server update and the Mac update:** your board opens full screen, with no address
  bar. Both are needed: the server hands your address to the app, and your Mac proves to the phone
  that the app may show it. Your Mac may already have its part (Kosmos 0.6.97 or later probably
  does); if the board still shows an address bar after the server update, tell us which Kosmos
  version your Mac runs. (#2854; relay #171 and relay #161)
  - If instead nothing happens for a couple of seconds and then the page says **"Your Kosmos did not
    open in the app. Tap Open my Kosmos again to open it here."**, tap it again: your board opens
    with an address bar, and nothing is stuck. Please screenshot that sentence for us. (#4090)
  - If the board opens straight away but with an address bar, screenshot its top edge. (#4090)
- **If the phone ever shows a security or certificate warning, stop there** and send us a
  screenshot. Do not tap through it. The real Kosmos addresses should never show one.

**What to tell us after both updates:** which of these happened: full screen; an address bar with
no message; or the "did not open in the app" sentence.

## 5. Your Mac asleep

Put your Mac to sleep (Apple menu, **Sleep**). Your agents pause while it sleeps, so wake it again
right after this step. On the phone, close Kosmos completely (swipe it away from
the recent apps), open it from its icon, and tap **Open my Kosmos**. Screenshot what the phone
shows, then wake the Mac. (#4086, #4093)

Whatever it shows is useful to us, and it does not mean your phone is offline. Today the message
may be a plain browser error, or one written for the Mac. Better wording for when your Mac is not
answering is written but not switched on yet, so there is no wrong answer here. We just want to see
it on a real phone.

## 6. Turn on notifications on the phone

Close Kosmos completely (swipe it away from the recent apps) and open it from its icon to get back
to the sign-in page, then tap **Notify me on this phone**. If
the phone asks whether **Kosmos** may send you notifications, tap **Allow**. The page then says the
phone will be notified when an agent posts or needs you. (#4140, #718)

**If it looks different:** a screenshot, especially if it says notifications were not allowed.

## 7. Get a notification

**Wait for the Mac update.** Your Mac cannot send notifications to a phone yet: phone notifications
are switched off in Kosmos on the Mac until the release that turns them on, and after it you switch
them on in Kosmos on the Mac: **Settings, Computer**, then **Turn on** next to "Buzz my phone when
an agent needs me". Before that, asking an agent to need you sends nothing to
the phone, and that is expected. (#718)

Once they are on, ask an agent to need you (or wait for one to), with the phone locked or on its
home screen.

**You should see:** a small **Kosmos planet icon** (a circle with a ring around it) in the status
bar at the top of the screen, and, when you pull the shade down, a notification titled like
"Scorpion needs you" with the same icon. Not Chrome's round logo. (#4151;
android/evidence/vc3-4165)

The Mac sends at most one of these per agent every five minutes, so to try again, use a different
agent or wait five minutes. (#718)

**If it looks different:** pull the shade down and screenshot it.

## 8. Tap the notification

This needs step 7 working first.

- **Before the server update:** tapping it opens the agent that needs you in a browser window with an
  address bar. That is expected for now. The first time, Chrome may show a one-time notice about ad
  privacy first; that is Chrome, not Kosmos. (#4140)
- **Wait for the server update and the Mac update:** tapping it opens the Kosmos app on the sign-in
  page, which says
  **"Tap Open my Kosmos to see what you were notified about."** Tap **Open my Kosmos**, and the
  conversation with the agent who needed you opens inside the app. (#4171, #4140)
  - After the updates, **open Kosmos once from its icon, then close it fully** (swipe it away from
    the recent apps) before testing this. A notification that arrived before that still opens the
    old way, in a browser window. The phone can also take up to a day to pick up the new
    behaviour, so if the first tap still opens a browser window, try again later that day.
  - If your board opens on its home page instead of that agent, your Mac does not have its part yet
    (the server update and the Mac update arrive separately); tell us which Kosmos version your Mac
    runs.
  - The extra tap on **Open my Kosmos** is deliberate for now. If it annoys you, tell us.

**If it looks different:** a screenshot of what the tap opened.

## 9. How fast it opens

Close Kosmos completely (swipe it away from the recent apps), then open it from its icon a few
times, closing it fully each time. Tell us which is closest, and whether this was before or after
the server update:

- the sign-in card is there almost at once,
- it takes about a second,
- it takes a couple of seconds,
- it feels slow (a gold screen with the K for a long time).

(#4109) On the phone we imitate in the lab, the sign-in page appears in about 1.3 to 1.9 seconds
(#4090). Your phone is the real measure.

## 10. With no connection

Close Kosmos completely (swipe it away from the recent apps), turn on **Airplane mode**, then open
Kosmos from its icon.

**You should see:** a Kosmos page saying Kosmos couldn't open, with a **Retry** button, not Chrome's
own "no internet" page. Turn Airplane mode off and tap **Retry**: the sign-in page opens. (#4093;
android/evidence/vc3-4165)

**If it looks different:** a screenshot.

## 11. After both updates, three quick extras

Once your board opens full screen (step 4), try these and tell us if any surprises you (#2854,
android README):

- From your board, press **Back**. Tell us where it goes.
- Open Kosmos from its icon, tap **Open my Kosmos**, go home, and do it again twice. Then look at
  your recent apps: tell us if you see one Kosmos or a stack of them.
- With auto-rotate on, turn the phone sideways just as you tap **Open my Kosmos**. Your board should open once, not
  twice.

---

## What waits for an update

| What you will notice | Step | Needs |
|---|---|---|
| Your board opens full screen, not with an address bar | 4 | the server update, and a Mac piece probably already in Kosmos 0.6.97 or later (relay #171, #161) |
| Notifications reach the phone at all | 7 | the Mac release that turns phone notifications on (not made yet), then switching them on in the Mac's Settings (#718) |
| A notification tap opens the agent inside the app | 8 | the server update, and the Mac release carrying the part that keeps the agent (relay #174, #4140) |
| The sign-in page loads a little faster than it already does | 9 | the server update (relay #169) |

The other server and relay changes waiting to go out (relay #170, #172, #173 and #175) change
nothing you can see on the phone, so no step tests them.

Everything else works now: installing, signing in, allowing the phone on your Mac, turning on
notifications on the phone, the Mac-asleep check, and the no-connection page. How fast it opens
(step 9) can be tried now; the server update makes it a little faster again.

---

## If you ever plug the phone into your Mac

This part is for us, only if you want to help measure speed precisely. Turn on the phone's developer
options and USB debugging, and connect it with a cable.

- **One cold start, in Android's own numbers:**
  `adb shell am force-stop io.kosmos.app; adb shell am force-stop com.android.chrome; sleep 2; adb shell am start -W -n io.kosmos.app/io.kosmos.app.KosmosLauncherActivity`
  (This measures when Android handed over to Chrome, not when the page appeared.)
- **When the sign-in page actually appears, seven times, with the middle result:**
  `ADB=<path to adb> ANDROID_SERIAL=<the phone's serial> python3 android/evidence/cct-warmup-4109/measure-cold-paint.py <the apk> phone 7`
  from the Kosmos repository on the Mac (it needs Python with Pillow). It reinstalls the app from the
  file you give it. It looks for a crop of the emulator's sign-in frame; on the real phone the fonts
  may differ enough that it never matches, and then it needs a reference frame taken on the phone.
  It also needs the phone signed out, since it looks for the "Sign in to Kosmos+" heading. (#4109)
- **If step 4 shows an address bar with no message after both updates:** first check that the Mac
  runs the update carrying relay #161. Then, with the phone connected, open `chrome://inspect` in
  Chrome on the Mac and look at the sign-in page's console for the line "an app launch nonce arrived
  without the app's referrer". (#4090, #2854)
- **Three checks that need the cable, after both updates** (android README, #4113): an open without
  the app's own code shows a URL bar; the app started at another address opens the sign-in page
  instead; a refused open does nothing and the next "Open my Kosmos" still goes full screen. The
  exact commands are in `android/README.md`, "Not yet seen on a device".
