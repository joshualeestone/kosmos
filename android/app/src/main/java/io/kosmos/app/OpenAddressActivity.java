package io.kosmos.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

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
 * goes through AddressChoice: a rejected one opens the sign-in page, never the given URL, and
 * an address is trusted full screen only when the intent carries the nonce KosmosLauncherActivity
 * gave the sign-in page (HandoffNonce).
 */
public class OpenAddressActivity extends Activity {

    // The intent:// extras the sign-in page sets (S.address, S.addresses, S.kst).
    static final String EXTRA_ADDRESS = "address";
    static final String EXTRA_ADDRESSES = "addresses";   // comma-separated hosts
    static final String EXTRA_TOKEN = "kst";
    static final String EXTRA_NONCE = "nonce";

    private TwaLauncher launcher;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState != null) {   // recreated after the TWA already launched
            finish();
            return;
        }
        Intent in = getIntent();
        AddressChoice choice = AddressChoice.choose(
                getString(R.string.hostName),
                in.getStringExtra(EXTRA_ADDRESS),
                AddressChoice.split(in.getStringExtra(EXTRA_ADDRESSES)),
                in.getStringExtra(EXTRA_TOKEN),
                getSharedPreferences(KosmosLauncherActivity.PREFS, MODE_PRIVATE)
                        .getString(KosmosLauncherActivity.PREF_NONCE, null),
                in.getStringExtra(EXTRA_NONCE));

        TrustedWebActivityIntentBuilder builder = new TrustedWebActivityIntentBuilder(
                Uri.parse(choice != null ? choice.target : getString(R.string.launchUrl)));
        if (choice != null && !choice.trustedOrigins.isEmpty()) {
            builder.setAdditionalTrustedOrigins(choice.trustedOrigins);
        }
        // The same system-bar colours LauncherActivity reads from the manifest metadata.
        builder.setColorScheme(CustomTabsIntent.COLOR_SCHEME_SYSTEM)
                .setDefaultColorSchemeParams(bars(R.color.status_bar_color, R.color.navigation_bar_color))
                .setColorSchemeParams(CustomTabsIntent.COLOR_SCHEME_DARK,
                        bars(R.color.status_bar_color_dark, R.color.navigation_bar_color_dark));

        // With no browser that supports a TWA, TwaLauncher opens a Custom Tab, URL bar and all.
        launcher = new TwaLauncher(this);
        launcher.launch(builder, null, null, this::finish);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (launcher != null) launcher.destroy();
    }

    private CustomTabColorSchemeParams bars(int toolbar, int navigation) {
        return new CustomTabColorSchemeParams.Builder()
                .setToolbarColor(getColor(toolbar))
                .setNavigationBarColor(getColor(navigation))
                .build();
    }
}
