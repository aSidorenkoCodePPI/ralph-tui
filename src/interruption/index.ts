/**
 * ABOUTME: Interruption handling module exports.
 * Provides graceful Ctrl+C handling with confirmation dialog and double-press detection.
 */

export * from './types.js';
export { createInterruptHandler } from './handler.js';
