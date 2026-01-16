/**
 * ABOUTME: Auto-update module that checks npm for newer versions and automatically updates.
 * Runs before CLI startup to ensure users always have the latest version.
 */

import { spawnSync } from 'node:child_process';

const PACKAGE_NAME = '@asidorenkocodeppi/ralph-tui';

interface NpmViewResult {
  version: string;
}

/**
 * Compare two semver version strings.
 * @returns -1 if a < b, 0 if a === b, 1 if a > b
 */
function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] ?? 0;
    const bPart = bParts[i] ?? 0;

    if (aPart < bPart) return -1;
    if (aPart > bPart) return 1;
  }

  return 0;
}

/**
 * Get the latest version from npm registry.
 * @returns The latest version string, or null if check fails
 */
function getLatestVersion(): string | null {
  try {
    const result = spawnSync('npm', ['view', PACKAGE_NAME, 'version', '--json'], {
      encoding: 'utf-8',
      timeout: 10000, // 10 second timeout
      shell: true,
    });

    if (result.status !== 0 || !result.stdout) {
      return null;
    }

    // npm view returns the version as a JSON string
    const version = JSON.parse(result.stdout.trim()) as string | NpmViewResult;
    return typeof version === 'string' ? version : version.version;
  } catch {
    // Silently fail - network issues, npm not available, etc.
    return null;
  }
}

/**
 * Perform the auto-update using npm.
 * @returns true if update succeeded, false otherwise
 */
function performUpdate(): boolean {
  console.log('\x1b[36m⬆ Updating ralph-tui...\x1b[0m');

  try {
    const result = spawnSync('npm', ['install', '-g', PACKAGE_NAME], {
      encoding: 'utf-8',
      timeout: 120000, // 2 minute timeout for install
      shell: true,
      stdio: 'inherit', // Show npm output
    });

    if (result.status === 0) {
      console.log('\x1b[32m✓ Update complete!\x1b[0m\n');
      return true;
    } else {
      console.log('\x1b[33m⚠ Update failed. Continuing with current version.\x1b[0m\n');
      return false;
    }
  } catch {
    console.log('\x1b[33m⚠ Update failed. Continuing with current version.\x1b[0m\n');
    return false;
  }
}

/**
 * Check for updates and auto-update if a newer version is available.
 * This function is designed to be called at CLI startup.
 *
 * @param currentVersion - The current installed version
 * @returns true if the CLI should restart (update was performed), false to continue
 */
export async function checkAndAutoUpdate(currentVersion: string): Promise<boolean> {
  // Skip update check in development
  if (process.env.RALPH_SKIP_UPDATE === '1' || process.env.NODE_ENV === 'development') {
    return false;
  }

  const latestVersion = getLatestVersion();

  if (!latestVersion) {
    // Could not check - network issue, npm not available, etc.
    // Silently continue with current version
    return false;
  }

  if (compareVersions(currentVersion, latestVersion) >= 0) {
    // Already up to date
    return false;
  }

  // Newer version available
  console.log(
    `\x1b[33m📦 New version available: ${currentVersion} → ${latestVersion}\x1b[0m`
  );

  const updated = performUpdate();

  if (updated) {
    // Tell user to re-run the command
    console.log('\x1b[36mPlease re-run your command to use the new version.\x1b[0m');
    process.exit(0);
  }

  return false;
}
