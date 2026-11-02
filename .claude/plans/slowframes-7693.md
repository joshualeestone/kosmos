# slowframes-7693

Finished means: a slow-spawn line reaches past snapshot() to the timer that called it. On the live board six frames, and V8's default of ten, stopped inside snapshot().

Rejected for now: a time budget inside the blocking snapshot. Those callers act on what they read, so reading unknown past a budget changes behaviour; naming the caller and moving it to the async form is safer.
