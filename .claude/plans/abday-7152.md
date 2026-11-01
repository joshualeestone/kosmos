# The autobalance check's "three days ago" is by the calendar (#7152)

render-autobalance-7152 built its older entry 72 hours before noon. Across the fall-back that is 1:00 PM, the check wants 12:00 PM, and the 0.7.80 cut stopped at step 3. It would stay red for three days, and again around the spring change. Test only.
