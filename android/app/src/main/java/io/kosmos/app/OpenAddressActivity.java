package io.kosmos.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;

import androidx.browser.customtabs.CustomTabColorSchemeParams;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.browser.trusted.TrustedWebActivityIntentBuilder;

import com.google.androidbrowserhelper.trusted.TwaLauncher;

/**
 * Opens the person's own Kosmos address full screen (kosmos #2854).
 *
 * A Trusted Web Activity trusts only the origin it was launched with, and the app is launched
 * at the one fixed front door, login.kosmosplus.com. The board lives on each person's own
 * address, so a navigation there from the sign-in page shows Chrome's URL bar. Instead, the
 * sign-in page hands this activity the address (an intent:// link to this package, see
 * kosmos-relay signin.html) and this launches a new TWA at that address with it added as a
 * trusted origin at runtime. Chrome verifies it against the address's own assetlinks.json
 * (kosmos-relay #161). Nothing per-user is built into the app.
 *
 * Exported because Chrome delivers the intent. Anything else can deliver one too, so every value
 * goes through AddressChoice: a rejected one is ignored, and a
 * choice without the nonce KosmosLauncherActivity gave the sign-in page (HandoffNonce) opens in
 * a plain Custom Tab, never a TWA.
 */
public class OpenAddressActivity extends Activity {

    // The intent:// extras the sign-in page sets (S.address, S.addresses, S.kst, S.nonce).
    static final String EXTRA_ADDRESS = "address";
    static final String EXTRA_ADDRESSES = "addresses";   // comma-separated hosts
    static final String EXTRA_TOKEN = "kst";
    static final String EXTRA_NONCE = "nonce";

    private static final String STATE_BROWSER_LAUNCHED = "browserLaunched";
    // Log lines name the failure only: the extras carry a sign-in token and the person's address.
    private static final String TAG = "OpenAddressActivity";

    private TwaLauncher launcher;
    private boolean browserLaunched;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState != null && savedInstanceState.getBoolean(STATE_BROWSER_LAUNCHED)) {
            finish();
            return;
        }
        AddressChoice choice = null;
        String address = null, addresses = null, token = null, nonce = null;
        boolean readable;
        try {
            Intent in = getIntent();
            address = in.getStringExtra(EXTRA_ADDRESS);
            addresses = in.getStringExtra(EXTRA_ADDRESSES);
            token = in.getStringExtra(EXTRA_TOKEN);
            nonce = in.getStringExtra(EXTRA_NONCE);
            readable = true;
        } catch (RuntimeException unreadableExtras) {   // e.g. BadParcelableException from another app
            Log.w(TAG, "open intent extras unreadable, ignored: "
                    + unreadableExtras.getClass().getName());
            readable = false;
        }
        if (readable) {
            choice = AddressChoice.choose(
                    getString(R.string.hostName), address, AddressChoice.split(addresses), token,
                    getSharedPreferences(KosmosLauncherActivity.PREFS, MODE_PRIVATE)
                            .getString(KosmosLauncherActivity.PREF_NONCE, null),
                    nonce);
            if (choice == null) Log.i(TAG, "open intent refused by AddressChoice, ignored");
        }

        if (choice == null) {
            finish();
            return;
        }
        if (!choice.fullScreen) {
            openInCustomTab(Uri.parse(choice.target));
            finish();
            return;
        }

        launchTrustedWebActivity(choice);
    }

    // Package-visible so Robolectric can replace the browser boundary while still driving the
    // real onCreate decision. The production implementation remains the only TWA construction.
    void launchTrustedWebActivity(AddressChoice choice) {
        TrustedWebActivityIntentBuilder builder = new TrustedWebActivityIntentBuilder(
                Uri.parse(choice.target));
        builder.setAdditionalTrustedOrigins(choice.trustedOrigins);
        // The same system-bar colours LauncherActivity reads from the manifest metadata.
        builder.setColorScheme(CustomTabsIntent.COLOR_SCHEME_SYSTEM)
                .setDefaultColorSchemeParams(bars(R.color.status_bar_color, R.color.navigation_bar_color))
                .setColorSchemeParams(CustomTabsIntent.COLOR_SCHEME_DARK,
                        bars(R.color.status_bar_color_dark, R.color.navigation_bar_color_dark));

        // With no browser that supports a TWA, TwaLauncher opens a Custom Tab, URL bar and all.
        launcher = new TwaLauncher(this);
        try {
            launcher.launch(builder, null, null, () -> browserLaunched = true);
        } catch (ActivityNotFoundException noBrowser) {
            Log.w(TAG, "no browser can open the address; the address was not opened");
            finish();
        }
    }

    // As LauncherActivity does: stay alive while the browser opens, and finish when the person
    // comes back here.
    @Override
    protected void onRestart() {
        super.onRestart();
        if (browserLaunched) finish();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        outState.putBoolean(STATE_BROWSER_LAUNCHED, browserLaunched);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (launcher != null) launcher.destroy();
    }

    // Package-visible for the same reason as launchTrustedWebActivity.
    void openInCustomTab(Uri uri) {
        CustomTabsIntent tab = new CustomTabsIntent.Builder()
                .setUrlBarHidingEnabled(false)
                .setShowTitle(false)
                .setColorScheme(CustomTabsIntent.COLOR_SCHEME_SYSTEM)
                .build();
        try {
            tab.launchUrl(this, uri);
        } catch (ActivityNotFoundException noBrowser) {
            Log.w(TAG, "no browser can open a Custom Tab; the address was not opened");
        }
    }

    private CustomTabColorSchemeParams bars(int toolbar, int navigation) {
        return new CustomTabColorSchemeParams.Builder()
                .setToolbarColor(getColor(toolbar))
                .setNavigationBarColor(getColor(navigation))
                .build();
    }
}
