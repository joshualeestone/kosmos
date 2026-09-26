package io.kosmos.app;

import android.content.Context;
import android.net.Uri;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

/**
 * The app's entry point: androidbrowserhelper's LauncherActivity, plus a fresh HandoffNonce in
 * the fragment of the sign-in page's launch URL (#2854). The nonce is per launch, not per user,
 * so nothing personal is built into the app.
 *
 * A launch URL that already has a fragment is left alone; the page then holds no nonce and opens
 * addresses the ordinary way.
 */
public class KosmosLauncherActivity extends LauncherActivity {

    static final String PREFS = "kosmos";
    static final String PREF_NONCE = "handoffNonce";

    @Override
    protected Uri getLaunchingUrl() {
        Uri url = super.getLaunchingUrl();
        if (url == null || url.getFragment() != null
                || !getString(R.string.hostName).equalsIgnoreCase(url.getHost())) {
            return url;
        }
        String nonce = HandoffNonce.fresh();
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(PREF_NONCE, nonce).commit();
        return url.buildUpon().encodedFragment(HandoffNonce.FRAGMENT_KEY + "=" + nonce).build();
    }
}
