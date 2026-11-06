package io.kosmos.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import io.kosmos.app.shell.AppTabs

/**
 * kosmos#8046 slice 1 (hybrid shell): the app's native bottom tab bar, mirroring the TabView bar in iOS
 * ContentView. It draws exactly AppTabs.visible(tasksTab) in Mona Lisa's order, marks the selected tab, and
 * reports a tap. The tested AppTabs logic decides which tabs show and which is selected; this is just the draw.
 *
 * (The SF-Symbol icon names AppTabs.Tab.symbol carries are iOS assets; this slice labels tabs by title until
 * the native tab glyphs land. The per-tab native screens and the full PressTracker press/answer lifecycle are
 * following increments; see BoardApp for how a tap is wired transitionally through the board's JS door.)
 */
@Composable
fun BoardTabBar(
    selected: AppTabs.Tab,
    tasksTab: Boolean,
    modifier: Modifier = Modifier,
    onSelect: (AppTabs.Tab) -> Unit,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface),
        horizontalArrangement = Arrangement.SpaceAround,
    ) {
        for (tab in AppTabs.visible(tasksTab)) {
            val isSelected = tab == selected
            Column(
                modifier = Modifier
                    .weight(1f)
                    .clickable { onSelect(tab) }
                    .padding(vertical = 10.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    text = tab.title,
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.labelMedium,
                    color = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
