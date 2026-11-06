package io.kosmos.app.sweep

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.SystemClock
import android.provider.Settings
import android.util.AttributeSet
import android.view.View
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * kosmos#8046 slice 1: the board's Sweep loader on Android, a custom View that draws the eight gold
 * dots on a ring (SweepLogic has the numbers). Ported from ios/Kosmos/SweepDots.swift (SwiftUI Canvas);
 * this is its direct Android analog, a Canvas drawn from the view's clock.
 *
 * It is the app's ONLY loading indicator (Josh 2026-11-05 18:33: dots only in the mobile app, everywhere;
 * mirrored from iOS #8058). SweepGuardTest fails the build if any app source brings back a ProgressBar,
 * a Material progress indicator, a ProgressDialog, or a SwipeRefreshLayout spinner.
 *
 * With no [label] it is hidden from TalkBack, for a place whose words already say what is loading; with
 * one, TalkBack reads that label. It grows with the person's text size (unless [scales] is false). Drawn
 * at up to [framesPerSecond] (30 by default, as the board); with Reduce Motion the dots stay where they
 * are and pulse together, unless [stillWhenReduced] holds them on one frame.
 */
class SweepDots @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0,
) : View(context, attrs, defStyleAttr) {

    /** The ring's side in dp at the default text size: the iOS default (20 pt), which this replaces. */
    var sizeDp: Float = 20f
        set(value) { field = value; requestLayout() }

    /** The dot colour. Defaults to the board gold; wire to the palette once slice 1 lands a palette. */
    var dotColor: Int = DEFAULT_GOLD
        set(value) { field = value; paint.color = value; invalidate() }

    /** What TalkBack says for it; null hides it from TalkBack. */
    var label: CharSequence? = null
        set(value) { field = value; applyAccessibility() }

    /** false keeps [sizeDp] at every text size (the launch mark is a fixed picture; its words still grow). */
    var scales: Boolean = true
        set(value) { field = value; requestLayout() }

    /** The most frames a second it draws. iOS uses 15 inside a lazy thread, 30 elsewhere (the board's rate). */
    var framesPerSecond: Double = 30.0

    /** With Reduce Motion, one still frame and no clock, rather than the pulse. */
    var stillWhenReduced: Boolean = false
        set(value) { field = value; invalidate() }

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = dotColor; style = Paint.Style.FILL }
    private var shownAtMs: Long = SystemClock.uptimeMillis()
    private val frameTick = Runnable { invalidate() }

    init {
        applyAccessibility()
    }

    private val reduceMotion: Boolean
        get() = Settings.Global.getFloat(
            context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f,
        ) == 0f

    private fun applyAccessibility() {
        if (label != null) {
            contentDescription = label
            importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
        } else {
            contentDescription = null
            importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        }
    }

    /** The side in px: [sizeDp] in px, grown by the font scale unless [scales] is false. */
    private fun sidePx(): Int {
        val density = resources.displayMetrics.density
        val fontScale = if (scales) resources.configuration.fontScale else 1f
        return (sizeDp * density * fontScale).roundToInt().coerceAtLeast(1)
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val wanted = sidePx()
        setMeasuredDimension(
            resolveSize(wanted, widthMeasureSpec),
            resolveSize(wanted, heightMeasureSpec),
        )
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        shownAtMs = SystemClock.uptimeMillis()   // the loop runs from when the ring appears (launch frame first)
        invalidate()
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(frameTick)
        super.onDetachedFromWindow()
    }

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        if (visibility == VISIBLE) {
            shownAtMs = SystemClock.uptimeMillis()
            invalidate()
        } else {
            removeCallbacks(frameTick)
        }
    }

    override fun onDraw(canvas: Canvas) {
        val still = reduceMotion && stillWhenReduced
        val side = min(width, height).toDouble()
        val elapsed = if (still) 0.0 else (SystemClock.uptimeMillis() - shownAtMs) / 1000.0
        // iOS ring(elapsed, still) draws SweepLogic.shown(elapsed, side, reduceMotion && !still).
        val dots = SweepLogic.shown(elapsed, side, reduceMotion && !still)
        for (d in dots) {
            paint.alpha = (d.opacity * 255).roundToInt().coerceIn(0, 255)
            canvas.drawCircle(d.x.toFloat(), d.y.toFloat(), (d.diameter / 2).toFloat(), paint)
        }
        // Keep drawing unless we are on a single still frame or off-screen.
        if (!still && isAttachedToWindow && windowVisibility == VISIBLE) {
            removeCallbacks(frameTick)
            val delayMs = (1000.0 / framesPerSecond).toLong().coerceAtLeast(1L)
            postOnAnimationDelayed(frameTick, delayMs)
        }
    }

    private companion object {
        /** The board's --gold; a stand-in until slice 1 brings the palette over from iOS (Palette.starGold). */
        val DEFAULT_GOLD = Color.rgb(0xCB, 0xA1, 0x4B)
    }
}
