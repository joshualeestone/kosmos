# rebuildhide-7420 (kosmos#7420): a rebuild does not show old messages

**Finished looks like:** when the chat's repair rebuilds a list, the person never sees the oldest rows. By video frames with a forced rebuild: control shows them, this does not, and the newest is showing afterwards every time. Clean opens are untouched because nothing here runs without a rebuild.

**Evidence:** video on the simulator, 11-07: after a rebuild the list shows "Friday 23 October, Message 42 of 260" for about two frames at 30 a second, then the newest. Josh's phone count on build 54: 2 rebuilds in 6 opens, so he may see this.

**Change:** while a rebuild is getting to its newest, the list has opacity 0, until the end marker appears, for at most 0.6 s. Debug control: KOSMOS_SAMPLE_NOREBUILDHIDE.

**Rejected:** creating the new list already anchored at the end: its own comment records that a long list on iOS 27 then opened on estimated rows and stayed empty. Looking for a blank sooner (card): more rebuilds, and each carried this flash.

**Weakest premise:** that the end marker appears promptly on a real phone. If it does not, the empty stretch lasts up to 0.6 s where today it would show old rows. A blank a little longer is judged better than a flash of the wrong messages. A phone is where that gets judged.

**Not covered:** this does not stop a blank happening or shorten the empty stretch before the rebuild. Nothing that shows while the list is hidden is touched: the top bar and composer stay.

**What would change my mind:** seeing a longer blank on a phone, or VoiceOver losing its place during the hide.
