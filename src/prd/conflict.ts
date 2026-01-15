/**
 * ABOUTME: PRD conflict resolution module for ralph-tui.
 * Handles detection and resolution of existing prd.json files.
 * Provides options: Skip, Overwrite, Merge, and Backup & Overwrite.
 */

import { access, constants, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Options for resolving PRD file conflicts.
 */
export type PrdConflictResolution = 'skip' | 'overwrite' | 'merge' | 'backup';

/**
 * Description of conflict resolution options for display.
 */
export const CONFLICT_RESOLUTION_OPTIONS: {
  key: PrdConflictResolution;
  name: string;
  description: string;
}[] = [
  {
    key: 'skip',
    name: 'Skip',
    description: 'Abort without making changes',
  },
  {
    key: 'overwrite',
    name: 'Overwrite',
    description: 'Replace the existing file',
  },
  {
    key: 'merge',
    name: 'Merge',
    description: 'Combine existing and new content (keep manual additions)',
  },
  {
    key: 'backup',
    name: 'Backup & Overwrite',
    description: 'Create prd.json.bak before replacing',
  },
];

/**
 * Result of conflict detection.
 */
export interface PrdConflictCheckResult {
  /** Whether a conflict exists (prd.json already exists) */
  hasConflict: boolean;

  /** Path to the existing prd.json file */
  existingPath: string;

  /** The existing PRD content (if conflict exists) */
  existingContent?: PrdJsonContent;
}

/**
 * Result of conflict resolution.
 */
export interface PrdConflictResolutionResult {
  /** Whether resolution was successful */
  success: boolean;

  /** The action taken */
  action: PrdConflictResolution;

  /** Message describing what happened */
  message: string;

  /** Path to backup file (if backup was created) */
  backupPath?: string;

  /** Error message if resolution failed */
  error?: string;
}

/**
 * Minimal structure for prd.json content used in merge operations.
 */
export interface PrdJsonContent {
  name: string;
  description?: string;
  branchName?: string;
  userStories: PrdUserStoryContent[];
  metadata?: {
    createdAt?: string;
    updatedAt?: string;
    version?: string;
    source?: string;
    [key: string]: unknown;
  };
}

/**
 * User story structure for merge operations.
 */
export interface PrdUserStoryContent {
  id: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
  priority?: number;
  passes: boolean;
  labels?: string[];
  dependsOn?: string[];
  notes?: string;
  completionNotes?: string;
}

/**
 * Check if a prd.json file already exists at the given path.
 * @param prdPath Path to check for existing prd.json
 * @returns Conflict check result with existing content if found
 */
export async function checkPrdConflict(prdPath: string): Promise<PrdConflictCheckResult> {
  try {
    await access(prdPath, constants.F_OK);

    // File exists, try to read it
    try {
      const content = await readFile(prdPath, 'utf-8');
      const parsed = JSON.parse(content) as PrdJsonContent;

      return {
        hasConflict: true,
        existingPath: prdPath,
        existingContent: parsed,
      };
    } catch {
      // File exists but can't be read/parsed - still a conflict
      return {
        hasConflict: true,
        existingPath: prdPath,
      };
    }
  } catch {
    // File doesn't exist
    return {
      hasConflict: false,
      existingPath: prdPath,
    };
  }
}

/**
 * Create a backup of the existing prd.json file.
 * @param prdPath Path to the prd.json file
 * @returns Path to the backup file, or null if backup failed
 */
export async function createPrdBackup(prdPath: string): Promise<string | null> {
  const backupPath = `${prdPath}.bak`;

  try {
    await copyFile(prdPath, backupPath);
    return backupPath;
  } catch (err) {
    console.error('Failed to create backup:', err);
    return null;
  }
}

/**
 * Merge new PRD content with existing content.
 * Strategy:
 * - Keep stories from existing file that aren't in new content (manual additions)
 * - Update stories that exist in both (from new content)
 * - Add new stories from the new content
 * - Preserve completion status (passes) from existing stories
 * - Preserve notes/completionNotes from existing stories
 *
 * @param existing Existing PRD content
 * @param incoming New PRD content to merge
 * @returns Merged PRD content
 */
export function mergePrdContent(
  existing: PrdJsonContent,
  incoming: PrdJsonContent
): PrdJsonContent {
  // Create a map of existing stories by ID for quick lookup
  const existingStoriesMap = new Map<string, PrdUserStoryContent>();
  for (const story of existing.userStories) {
    existingStoriesMap.set(story.id, story);
  }

  // Create a map of incoming stories by ID
  const incomingStoriesMap = new Map<string, PrdUserStoryContent>();
  for (const story of incoming.userStories) {
    incomingStoriesMap.set(story.id, story);
  }

  // Merged stories array
  const mergedStories: PrdUserStoryContent[] = [];

  // First, process all incoming stories (update or add)
  for (const incomingStory of incoming.userStories) {
    const existingStory = existingStoriesMap.get(incomingStory.id);

    if (existingStory) {
      // Story exists in both - merge them
      // Keep completion status and notes from existing
      mergedStories.push({
        ...incomingStory,
        passes: existingStory.passes, // Preserve completion status
        notes: existingStory.notes || incomingStory.notes,
        completionNotes: existingStory.completionNotes || incomingStory.completionNotes,
        // Merge labels (union)
        labels: mergeLabels(existingStory.labels, incomingStory.labels),
      });
    } else {
      // New story from incoming
      mergedStories.push(incomingStory);
    }
  }

  // Then, add any stories that exist only in existing (manual additions)
  for (const existingStory of existing.userStories) {
    if (!incomingStoriesMap.has(existingStory.id)) {
      // This story was manually added - preserve it
      // Add a label to indicate it's a manual addition
      const manualLabels = existingStory.labels || [];
      if (!manualLabels.includes('manual-addition')) {
        manualLabels.push('manual-addition');
      }
      mergedStories.push({
        ...existingStory,
        labels: manualLabels,
      });
    }
  }

  // Sort by priority and then by ID
  mergedStories.sort((a, b) => {
    const priorityDiff = (a.priority ?? 99) - (b.priority ?? 99);
    if (priorityDiff !== 0) return priorityDiff;
    return a.id.localeCompare(b.id);
  });

  return {
    name: incoming.name || existing.name,
    description: incoming.description || existing.description,
    branchName: incoming.branchName || existing.branchName,
    userStories: mergedStories,
    metadata: {
      ...existing.metadata,
      ...incoming.metadata,
      updatedAt: new Date().toISOString(),
      mergedFrom: existing.metadata?.source || 'existing',
    },
  };
}

/**
 * Merge two label arrays, removing duplicates.
 */
function mergeLabels(
  existing?: string[],
  incoming?: string[]
): string[] | undefined {
  if (!existing && !incoming) return undefined;
  if (!existing) return incoming;
  if (!incoming) return existing;

  const merged = new Set([...existing, ...incoming]);
  return Array.from(merged);
}

/**
 * Resolve a PRD conflict based on the chosen resolution strategy.
 * @param prdPath Path to the prd.json file
 * @param newContent New content to write
 * @param resolution How to resolve the conflict
 * @param existingContent Existing content (required for merge)
 * @returns Resolution result
 */
export async function resolvePrdConflict(
  prdPath: string,
  newContent: PrdJsonContent,
  resolution: PrdConflictResolution,
  existingContent?: PrdJsonContent
): Promise<PrdConflictResolutionResult> {
  try {
    switch (resolution) {
      case 'skip':
        return {
          success: true,
          action: 'skip',
          message: 'Skipped - no changes made to existing prd.json',
        };

      case 'overwrite':
        await writeFile(prdPath, JSON.stringify(newContent, null, 2), 'utf-8');
        return {
          success: true,
          action: 'overwrite',
          message: `Overwrote existing prd.json at ${prdPath}`,
        };

      case 'backup': {
        const backupPath = await createPrdBackup(prdPath);
        if (!backupPath) {
          return {
            success: false,
            action: 'backup',
            message: 'Failed to create backup',
            error: 'Could not create backup file',
          };
        }

        await writeFile(prdPath, JSON.stringify(newContent, null, 2), 'utf-8');
        return {
          success: true,
          action: 'backup',
          message: `Created backup at ${backupPath} and overwrote prd.json`,
          backupPath,
        };
      }

      case 'merge': {
        if (!existingContent) {
          return {
            success: false,
            action: 'merge',
            message: 'Cannot merge without existing content',
            error: 'Existing content required for merge operation',
          };
        }

        const merged = mergePrdContent(existingContent, newContent);
        await writeFile(prdPath, JSON.stringify(merged, null, 2), 'utf-8');

        const existingCount = existingContent.userStories.length;
        const newCount = newContent.userStories.length;
        const mergedCount = merged.userStories.length;

        return {
          success: true,
          action: 'merge',
          message: `Merged ${newCount} new stories with ${existingCount} existing stories → ${mergedCount} total stories`,
        };
      }

      default:
        return {
          success: false,
          action: resolution,
          message: `Unknown resolution: ${resolution}`,
          error: 'Invalid resolution strategy',
        };
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      action: resolution,
      message: `Failed to resolve conflict: ${errorMessage}`,
      error: errorMessage,
    };
  }
}

/**
 * Get the default prd.json path for a project.
 * @param cwd Current working directory
 * @param outputDir Output directory (default: 'tasks')
 * @returns Full path to prd.json
 */
export function getDefaultPrdJsonPath(cwd: string, outputDir = 'tasks'): string {
  return join(cwd, outputDir, 'prd.json');
}
