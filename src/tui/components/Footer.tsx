/**
 * ABOUTME: Footer component for the Ralph TUI.
 * Displays keyboard shortcuts for user reference.
 */

import type { ReactNode } from 'react';
import { colors, keyboardShortcuts, layout } from '../theme.js';

/**
 * Footer component showing keyboard shortcuts
 */
export function Footer(): ReactNode {
  // Format keyboard shortcuts as a single string
  const shortcutText = keyboardShortcuts
    .map(({ key, description }) => `${key}:${description}`)
    .join('  ');

  return (
    <box
      style={{
        width: '100%',
        height: layout.footer.height,
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
        backgroundColor: colors.bg.secondary,
        paddingLeft: 1,
        paddingRight: 1,
        border: true,
        borderColor: colors.border.normal,
      }}
    >
      {/* Keyboard shortcuts */}
      <box style={{ flexShrink: 1, overflow: 'hidden' }}>
        <text fg={colors.fg.muted}>{shortcutText}</text>
      </box>
    </box>
  );
}
