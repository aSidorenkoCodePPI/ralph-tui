/**
 * ABOUTME: Setup module for Ralph TUI interactive project configuration.
 * Exports the setup wizard and related utilities.
 */

export type {
  SetupWizardState,
  SetupAnswers,
  SetupResult,
  SetupOptions,
  PluginDetection,
  AnySetupQuestion,
} from './types.js';

export {
  runSetupWizard,
  checkAndRunSetup,
  projectConfigExists,
} from './wizard.js';

export {
  promptText,
  promptBoolean,
  promptSelect,
  promptPath,
  promptNumber,
  promptQuestion,
  printSection,
  printSuccess,
  printError,
  printInfo,
} from './prompts.js';
