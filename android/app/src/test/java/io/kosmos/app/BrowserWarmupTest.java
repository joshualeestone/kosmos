package io.kosmos.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.google.androidbrowserhelper.trusted.TwaProviderPicker.LaunchMode;

import org.junit.Test;

/** #4109: when KosmosLauncherActivity binds to the browser early and warms it up. */
public class BrowserWarmupTest {

    private static final String CHROME = "com.android.chrome";

    @Test
    public void warmsForATrustedWebActivityOrACustomTab() {
        assertTrue(KosmosLauncherActivity.shouldWarm(false, true, CHROME, LaunchMode.TRUSTED_WEB_ACTIVITY));
        assertTrue(KosmosLauncherActivity.shouldWarm(false, true, CHROME, LaunchMode.CUSTOM_TAB));
    }

    @Test
    public void doesNotWarmWhenRecreatedOfflineOrWithoutACustomTabsBrowser() {
        // Each case differs from the warming one above in exactly one argument.
        assertFalse("recreated", KosmosLauncherActivity.shouldWarm(true, true, CHROME, LaunchMode.TRUSTED_WEB_ACTIVITY));
        assertFalse("offline", KosmosLauncherActivity.shouldWarm(false, false, CHROME, LaunchMode.TRUSTED_WEB_ACTIVITY));
        assertFalse("no provider", KosmosLauncherActivity.shouldWarm(false, true, null, LaunchMode.TRUSTED_WEB_ACTIVITY));
        assertFalse("plain browser", KosmosLauncherActivity.shouldWarm(false, true, CHROME, LaunchMode.BROWSER));
    }
}
