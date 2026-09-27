# Your first phone test: Kosmos on the Moto G Play

This is one short script for trying the Kosmos app on your phone, in the order you will meet
things. Each step says what you should see, and what to send us if you see something else. A
screenshot is always enough: press the power and volume-down buttons together.

Some steps depend on updates that are not switched on yet, so they are marked:

- **Wait for the server update**: a Kosmos+ server update. Part of it is ready and you switch it on
  when you choose; the notification part (Kano's) is still in review.
- **Wait for the Mac update**: the next Kosmos release for your Mac.

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
3. Tap **Install**. If Google Play Protect warns that the app is unknown, choose to install anyway.
   It warns because the app is not in the store yet.
4. Tap **Open**.

**If it looks different:** a screenshot of any message that stops the install.

## 2. Open it and sign in

**You should see:** the Kosmos+ sign-in page filling the whole screen, with no browser address bar
across the top. (#4113, #4090)

Enter your Kosmos+ email, tap **Send the code**, type the six-digit code from the email, then your
second sign-in step, the same one you use on the web.

- There is no way to buy or subscribe inside the app. It only signs you in, and says Kosmos+ is set
  up at kosmosplus.com. That is deliberate. (#718)
- A small "Running in Chrome" note may show at the bottom the first time. Tap **Got it**.

**If it looks different:** a screenshot of the first screen, especially if you see an address bar.

## 3. Let your Mac allow the phone

The first time, Kosmos on your Mac shows a card asking whether to allow this phone, with a short
code. **Allow it only if the code matches the one on the phone** (it looks like FK-4H). The phone
then says the device is allowed. (#2854, #718)

**If it looks different:** a screenshot of the phone's page, and whether the Mac showed the card.

## 4. Open your board

Tap **Open my Kosmos**.

- **For now:** your board opens with a browser address bar across the top. That is expected.
  (#4090, #2854)
- **Wait for the server update and the Mac update:** your board opens full screen, with no address
  bar. Both are needed: the server hands your address to the app, and your Mac proves to the phone
  that the app may show it. (#2854; relay #171 and relay #161)
  - If instead nothing happens for a couple of seconds and then the page says **"Your Kosmos did not
    open in the app. Tap Open my Kosmos again to open it here."**, tap it again: your board opens
    with an address bar, and nothing is stuck. Please screenshot that sentence for us. (#4090)
  - If the board opens straight away but with an address bar, screenshot its top edge. (#4090)
- **If the phone ever shows a security or certificate warning, stop there** and send us a
  screenshot. Do not tap through it. The real Kosmos addresses should never show one.

**What to tell us after both updates:** which of these happened: full screen; an address bar with
no message; or the "did not open in the app" sentence.

## 5. Your Mac asleep

Put your Mac to sleep (or close its lid), then on the phone reopen Kosmos from its icon and tap
**Open my Kosmos**. Screenshot what the phone shows, then wake the Mac. (#4086, #4093)

We are still settling what the phone should say when your Mac is not answering, so there is no
wrong answer here. We just want to see it on a real phone.

## 6. Turn on notifications on the phone

Reopen Kosmos from its icon to get back to the sign-in page, and tap **Notify me on this phone**. If
the phone asks whether **Kosmos** may send you notifications, tap **Allow**. The page then says the
phone will be notified when an agent posts or needs you. (#4140, #718)

**If it looks different:** a screenshot, especially if it says notifications were not allowed.

## 7. Get a notification

**Wait for the Mac update.** Your Mac cannot send notifications to a phone yet: phone notifications
are switched off in Kosmos on the Mac until the release that turns them on, and after it you switch
them on in Kosmos's Settings on the Mac. Before that, asking an agent to need you sends nothing to
the phone, and that is expected. (#718)

Once they are on, ask an agent to need you (or wait for one to), with the phone locked or on its
home screen.

**You should see:** a notification titled like "Scorpion needs you", with the **Kosmos planet icon**
(a small circle with a ring around it), both at the top of the screen and when you pull the shade
down. Not Chrome's round logo. (#4151)

**If it looks different:** pull the shade down and screenshot it.

## 8. Tap the notification

This needs step 7 working first.

- **Before the server update:** tapping it opens the agent that needs you in a browser window with an
  address bar. That is expected for now. (#4140)
- **Wait for the server update:** tapping it opens the Kosmos app on the sign-in page, which says
  **"Tap Open my Kosmos to see what you were notified about."** Tap **Open my Kosmos**, and the
  conversation with the agent who needed you opens inside the app. (#4171, #4140)
  - After the update, **open Kosmos once from its icon before testing this**. A notification that
    arrived before you did that still opens the old way, in a browser window.
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

Turn on **Airplane mode**, then open Kosmos.

**You should see:** a Kosmos page saying Kosmos couldn't open, with a **Retry** button, not Chrome's
own "no internet" page. Turn Airplane mode off and tap **Retry**: the sign-in page opens. (#4093)

**If it looks different:** a screenshot.

---

## What waits for an update

| What you will notice | Step | Needs |
|---|---|---|
| Your board opens full screen, not with an address bar | 4 | the server update (relay #171, ready) and the Mac update (relay #161) |
| Notifications reach the phone at all | 7 | the Mac update that turns phone notifications on, then switching them on in the Mac's Settings |
| A notification tap opens the agent inside the app | 8 | the server update including Kano's notification change and a Mac update carrying its Mac half (both in relay #174, in review; #4140) |
| The sign-in page loads a little faster than it already does | 9 | the server update (relay #169, ready) |

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
  `ADB=<path to adb> python3 android/evidence/cct-warmup-4109/measure-cold-paint.py <the apk> phone 7`
  from the Kosmos repository on the Mac (it needs Python with Pillow). It reinstalls the app from the
  file you give it. It looks for a crop of the emulator's sign-in frame; on the real phone the fonts
  may differ enough that it never matches, and then it needs a reference frame taken on the phone.
  (#4109)
- **If step 4 shows an address bar with no message after both updates:** first check that the Mac
  runs the update carrying relay #161. Then, with the phone connected, open `chrome://inspect` in
  Chrome on the Mac and look at the sign-in page's console for the line "an app launch nonce arrived
  without the app's referrer". (#4090, #2854)
