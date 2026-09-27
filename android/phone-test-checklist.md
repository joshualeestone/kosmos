# Your first phone test: Kosmos on the Moto G Play

This is one short script for trying the Kosmos app on your phone, in the order you will meet
things. Each step says what you should see, and what to send us if you see something else. A
screenshot is always enough: press the power and volume-down buttons together.

Some steps only work after **the server update** is switched on (we have it ready; you switch it on
when you choose). Those steps are marked **Wait for the server update**. Until then they behave the
old way on purpose, and that is not the app being broken.

The card number after each step, like (#4151), is only for us, so we can trace your answer.

---

## 1. Install the app

Use the file **Kosmos-android-vc3.apk** (version 0.1.2) from your Files. If you already have an
earlier test build on the phone, this one updates it in place; nothing is lost and you do not need
to uninstall first. (#4165, #4132)

1. Open the file on the phone (from email, Google Drive, or a message to yourself) and tap it.
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

**How fast it feels:** see step 8.

## 3. Let your Mac allow the phone

The first time, Kosmos on your Mac shows a card asking whether to allow this phone, with a short
code. **Allow it only if the code matches the one on the phone** (it looks like FK-4H).
The phone then says the device is allowed. (#2854, #718)

**If it looks different:** a screenshot of the phone's page, and whether the Mac showed the card.

## 4. Open your board

Tap **Open my Kosmos**.

- **Before the server update:** your board opens with a browser address bar across the top. That is
  expected for now. (#4090, #2854)
- **Wait for the server update:** your board opens full screen, with no address bar. (#2854; needs
  the server update, relay #171)
  - If instead nothing happens for a couple of seconds and then the page says **"Your Kosmos did not
    open in the app. Tap Open my Kosmos again to open it here."**, tap it again: your board opens
    with an address bar, and nothing is stuck. Please screenshot that sentence for us. (#4090)
  - If the board opens straight away but with an address bar, screenshot its top edge. (#4090)
- The first time you open your own address, the phone may show a **security warning about the
  certificate**. That is expected while Kosmos is being set up, and it goes away when the real
  address arrives. (sign-in page wording)

**What to tell us after the update:** which of these happened: full screen; an address bar with no
message; or the "did not open in the app" sentence.

## 5. Turn on notifications

On the sign-in page, tap **Notify me on this phone**. If the phone asks whether **Kosmos** may send
you notifications, tap **Allow**. The page then says the phone will be notified when an agent posts
or needs you. (#4140, #718)

**If it looks different:** a screenshot, especially if it says notifications were not allowed.

## 6. Get a notification

Ask an agent to need you (or wait for one to), with the phone locked or on its home screen.

**You should see:** a notification titled like "Scorpion needs you", with the **Kosmos planet icon**
(a small circle with a ring around it), both at the top of the screen and when you pull the shade
down. Not Chrome's round logo. (#4151)

**If it looks different:** pull the shade down and screenshot it.

## 7. Tap the notification

- **Before the server update:** the tap may open your board in a browser window, with an address
  bar, rather than inside the app. That is expected for now. (#4140)
- **Wait for the server update** (and Kano's notification change, #4140): the tap opens the Kosmos
  app on the sign-in page, which says **"Tap Open my Kosmos to see what you were notified about."**
  Tap **Open my Kosmos**, and the conversation with the agent who needed you opens, not the board
  home. (#4171, #4140; needs the server update)
  - The extra tap on **Open my Kosmos** is deliberate for now. If it annoys you, tell us.

**If it looks different:** a screenshot of what the tap opened.

## 8. How fast it opens

Close Kosmos completely (swipe it away from the recent apps), then open it from its icon a few
times, closing it fully each time. Tell us which is closest:

- the sign-in card is there almost at once,
- it takes about a second,
- it takes a couple of seconds,
- it feels slow (a gold screen with the K for a long time).

(#4109, #4101) On the test phone we copy in the lab, the sign-in page appears in about 1.3 to 1.9
seconds. Your phone is the real measure.

## 9. With no connection

Turn on **Airplane mode**, then open Kosmos.

**You should see:** a Kosmos page saying Kosmos couldn't open, with a **Retry** button, not Chrome's
own "no internet" page. Turn Airplane mode off and tap **Retry**: the sign-in page opens. (#4093)

- If your phone is online but your Mac is asleep, the same page may say to check your connection.
  That wording is being fixed to say the Mac is not answering. (#4093, #4086)

**If it looks different:** a screenshot.

---

## What waits for the server update

These are ready but not switched on. Until you switch on the server update they behave the old way,
as described in each step:

| What you will notice | Step | Needs |
|---|---|---|
| Your board opens full screen, not with an address bar | 4 | the server update (relay #171) |
| A notification tap opens the app, then the agent who needed you | 7 | the server update and Kano's notification change (#4140, not yet merged) |
| The sign-in page loads a little faster | 2 | the server update (relay #169) |

Everything else in this script works now: installing, signing in, allowing the phone on your Mac,
turning on notifications, the Kosmos icon on notifications, how fast it opens, and the no-connection
page.

---

## If you ever plug the phone into your Mac

This part is for us, only if you want to help measure speed precisely. Turn on the phone's developer
options and USB debugging, and connect it with a cable.

- **One cold start, in Android's own numbers:**
  `adb shell am force-stop io.kosmos.app; adb shell am force-stop com.android.chrome; sleep 2; adb shell am start -W -n io.kosmos.app/io.kosmos.app.KosmosLauncherActivity`
  (This measures when Android handed over to Chrome, not when the page appeared.)
- **When the sign-in page actually appears, seven times, with the middle result:**
  `ADB=<path to adb> python3 android/evidence/cct-warmup-4109/measure-cold-paint.py <the vc3 apk> phone 7`
  from the Kosmos repository on the Mac (it needs Python with Pillow). It compares the screen with a
  720 by 1600 reference, the Moto G Play's size, and it reinstalls the app from the file you give it.
  (#4109)
- **If step 4 shows an address bar with no message after the update:** with the phone connected, open
  `chrome://inspect` in Chrome on the Mac and look at the sign-in page's console for the line
  "an app launch nonce arrived without the app's referrer". (#4090, #2854)
