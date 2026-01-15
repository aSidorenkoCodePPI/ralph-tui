/**
 * ABOUTME: Built-in tracker plugin exports and registration.
 * Provides factory functions for all built-in tracker plugins
 * and a function to register them with the registry.
 */

import { getTrackerRegistry } from '../registry.js';
import createJsonTracker from './json.js';
import createBeadsTracker from './beads.js';
import createBeadsBvTracker from './beads-bv.js';

/**
 * All built-in tracker plugin factories.
 */
export const builtinTrackers = {
  json: createJsonTracker,
  beads: createBeadsTracker,
  'beads-bv': createBeadsBvTracker,
} as const;

/**
 * Register all built-in tracker plugins with the registry.
 * Should be called during application initialization.
 */
export function registerBuiltinTrackers(): void {
  const registry = getTrackerRegistry();

  for (const factory of Object.values(builtinTrackers)) {
    registry.registerBuiltin(factory);
  }
}

export { createJsonTracker, createBeadsTracker, createBeadsBvTracker };
