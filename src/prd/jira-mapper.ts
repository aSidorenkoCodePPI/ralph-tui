/**
 * ABOUTME: Jira field mapper for PRD generation.
 * Maps Jira issue fields to PRD document sections.
 * Handles missing fields gracefully with defaults or omission.
 * Supports linked issues as sub-tasks with dependency relationships.
 * Generates prd.json output compatible with ralph-tui.
 */

import { writeFile, mkdir, access, constants } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { JiraIssue, JiraLinkedIssue, JiraLinkType } from '../commands/jira-prd.js';
import type { GeneratedPrd, PrdUserStory, PrdGenerationOptions } from './types.js';
import { slugify, generateBranchName } from './generator.js';

/**
 * Configuration for field mapping behavior.
 */
export interface JiraFieldMappingConfig {
  /** Default priority when not specified in Jira (1-4, 1 = highest) */
  defaultPriority?: number;
  /** Default story points when not specified */
  defaultStoryPoints?: number;
  /** Prefix for story IDs (default: "US-") */
  storyPrefix?: string;
  /** Whether to include empty sections in PRD */
  includeEmptySections?: boolean;
  /** Whether to include linked issues as user stories (default: true) */
  includeLinkedIssues?: boolean;
  /** Link types to include (default: ['blocks', 'is blocked by', 'relates to']) */
  includeLinkTypes?: JiraLinkType[];
}

/**
 * Result of mapping Jira fields to PRD.
 */
export interface JiraFieldMappingResult {
  /** The generated PRD */
  prd: GeneratedPrd;
  /** Fields that were mapped successfully */
  mappedFields: string[];
  /** Fields that were missing and used defaults */
  defaultedFields: string[];
  /** Fields that were skipped (not available) */
  skippedFields: string[];
  /** Number of linked issues included as user stories */
  linkedIssueCount: number;
  /** The source Jira issue key (e.g., PROJECT-123) */
  issueKey: string;
}

/**
 * Map Jira priority string to numeric priority (1-4).
 * 1 = Highest/Critical, 4 = Lowest/Trivial
 */
export function mapPriorityToNumber(priority: string | undefined, defaultPriority = 2): number {
  if (!priority) return defaultPriority;

  const normalizedPriority = priority.toLowerCase().trim();

  // Critical/Blocker = P1
  if (normalizedPriority.includes('critical') ||
      normalizedPriority.includes('blocker') ||
      normalizedPriority.includes('highest')) {
    return 1;
  }

  // High = P1
  if (normalizedPriority.includes('high')) {
    return 1;
  }

  // Medium/Normal = P2
  if (normalizedPriority.includes('medium') ||
      normalizedPriority.includes('normal') ||
      normalizedPriority.includes('major')) {
    return 2;
  }

  // Low = P3
  if (normalizedPriority.includes('low') ||
      normalizedPriority.includes('minor')) {
    return 3;
  }

  // Trivial/Lowest = P4
  if (normalizedPriority.includes('trivial') ||
      normalizedPriority.includes('lowest')) {
    return 4;
  }

  return defaultPriority;
}

/**
 * Parse acceptance criteria from text.
 * Handles various formats: bullet points, numbered lists, newlines.
 */
export function parseAcceptanceCriteria(text: string | undefined): string[] {
  if (!text || !text.trim()) {
    return [];
  }

  const criteria: string[] = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    // Remove common list markers and trim
    const cleaned = line
      .replace(/^[\s]*[-*•◦▪▸►→][\s]*/g, '') // Bullet points
      .replace(/^[\s]*\d+[.)]\s*/g, '') // Numbered lists
      .replace(/^[\s]*\[[xX\s]?\]\s*/g, '') // Checkbox markers
      .replace(/^[\s]*Given|When|Then|And\s+/gi, '') // BDD keywords (keep the rest)
      .trim();

    if (cleaned && cleaned.length > 0) {
      criteria.push(cleaned);
    }
  }

  // If no line breaks found, try splitting on semicolons or "AND"
  if (criteria.length === 0) {
    const parts = text.split(/[;]|\s+AND\s+/gi);
    for (const part of parts) {
      const cleaned = part.trim();
      if (cleaned && cleaned.length > 0) {
        criteria.push(cleaned);
      }
    }
  }

  // If still nothing, treat the entire text as one criterion
  if (criteria.length === 0 && text.trim()) {
    criteria.push(text.trim());
  }

  return criteria;
}

/**
 * Extract problem statement from Jira description.
 * Looks for common patterns like "Problem:", "Background:", etc.
 */
function extractProblemStatement(description: string | undefined): string {
  if (!description) return '';

  const desc = description.trim();

  // Look for explicit problem/background sections
  const problemPatterns = [
    /(?:^|\n)(?:problem|issue|background|context|motivation)[:\s]*\n?([\s\S]+?)(?:\n\n|\n(?:solution|acceptance|criteria|requirements|description):|$)/i,
    /(?:^|\n)h[1-3]\.?\s*(?:problem|issue|background)[:\s]*\n?([\s\S]+?)(?:\n\n|\nh[1-3]|$)/i,
  ];

  for (const pattern of problemPatterns) {
    const match = desc.match(pattern);
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }

  // If no explicit section, use the first paragraph
  const firstParagraph = desc.split(/\n\n/)[0]?.trim();
  return firstParagraph ?? desc;
}

/**
 * Map a single Jira issue to a PRD user story.
 */
export function mapJiraIssueToUserStory(
  issue: JiraIssue,
  storyId: string,
  config: JiraFieldMappingConfig = {}
): PrdUserStory {
  const priority = mapPriorityToNumber(issue.priority, config.defaultPriority);
  const acceptanceCriteria = parseAcceptanceCriteria(issue.acceptanceCriteria);

  // If no acceptance criteria from Jira, create defaults
  const finalCriteria = acceptanceCriteria.length > 0
    ? acceptanceCriteria
    : [
        'Feature works as described in summary',
        'No errors or crashes during normal operation',
        'Meets expected behavior based on issue type',
      ];

  return {
    id: storyId,
    title: issue.summary,
    description: issue.description ?? issue.summary,
    acceptanceCriteria: finalCriteria,
    priority,
    labels: issue.labels,
  };
}

/**
 * Map a Jira issue to a complete PRD document.
 * This is the main entry point for Jira → PRD field mapping.
 * Includes linked issues as additional user stories with dependency relationships.
 */
export function mapJiraIssueToPrd(
  issue: JiraIssue,
  options: PrdGenerationOptions = {},
  config: JiraFieldMappingConfig = {}
): JiraFieldMappingResult {
  const mappedFields: string[] = [];
  const defaultedFields: string[] = [];
  const skippedFields: string[] = [];

  const storyPrefix = config.storyPrefix ?? options.storyPrefix ?? 'US-';
  const includeLinkedIssues = config.includeLinkedIssues ?? true;
  const includeLinkTypes = config.includeLinkTypes ?? ['blocks', 'is blocked by', 'relates to'];

  // Map summary → PRD title
  const name = issue.summary;
  mappedFields.push('summary');

  // Map description → Overview/Problem Statement
  let problemStatement: string;
  let description: string;
  if (issue.description) {
    description = issue.description;
    problemStatement = extractProblemStatement(issue.description);
    mappedFields.push('description');
  } else {
    // Use summary as fallback
    description = issue.summary;
    problemStatement = issue.summary;
    defaultedFields.push('description');
  }

  // Map acceptance criteria
  const acceptanceCriteria = parseAcceptanceCriteria(issue.acceptanceCriteria);
  if (acceptanceCriteria.length > 0) {
    mappedFields.push('acceptanceCriteria');
  } else if (issue.acceptanceCriteria === undefined) {
    skippedFields.push('acceptanceCriteria');
  } else {
    defaultedFields.push('acceptanceCriteria');
  }

  // Map priority
  const priority = mapPriorityToNumber(issue.priority, config.defaultPriority);
  if (issue.priority) {
    mappedFields.push('priority');
  } else {
    defaultedFields.push('priority');
  }

  // Map labels → Tags/Categories
  const labels = issue.labels ?? [];
  if (issue.labels && issue.labels.length > 0) {
    mappedFields.push('labels');
  } else {
    skippedFields.push('labels');
  }

  // Map story points → Effort estimate
  let effortEstimate: string | undefined;
  if (issue.storyPoints !== undefined) {
    effortEstimate = `${issue.storyPoints} story points`;
    mappedFields.push('storyPoints');
  } else if (config.defaultStoryPoints !== undefined) {
    effortEstimate = `${config.defaultStoryPoints} story points (estimated)`;
    defaultedFields.push('storyPoints');
  } else {
    skippedFields.push('storyPoints');
  }

  // Create user stories array starting with the main issue
  const userStories: PrdUserStory[] = [];
  const storyIdMap = new Map<string, string>(); // Maps Jira key to story ID
  let storyCounter = 1;

  // Create the main user story
  const mainStoryId = `${storyPrefix}${String(storyCounter).padStart(3, '0')}`;
  storyIdMap.set(issue.key, mainStoryId);
  const mainStory = mapJiraIssueToUserStory(issue, mainStoryId, config);
  userStories.push(mainStory);
  storyCounter++;

  // Process linked issues if enabled
  let linkedIssueCount = 0;
  if (includeLinkedIssues && issue.linkedIssues && issue.linkedIssues.length > 0) {
    const filteredLinks = issue.linkedIssues.filter(
      (link) => includeLinkTypes.includes(link.linkType)
    );

    // First pass: create story IDs for all linked issues
    for (const linkedIssue of filteredLinks) {
      if (!storyIdMap.has(linkedIssue.issue.key)) {
        const linkedStoryId = `${storyPrefix}${String(storyCounter).padStart(3, '0')}`;
        storyIdMap.set(linkedIssue.issue.key, linkedStoryId);
        storyCounter++;
      }
    }

    // Second pass: create user stories with dependency relationships
    for (const linkedIssue of filteredLinks) {
      const linkedStoryId = storyIdMap.get(linkedIssue.issue.key);
      if (!linkedStoryId) continue;

      // Skip if we already added this issue
      if (userStories.some((s) => s.id === linkedStoryId)) continue;

      const linkedStory = mapJiraIssueToUserStory(linkedIssue.issue, linkedStoryId, config);

      // Set up dependency relationships based on link type
      const dependencies = computeDependencies(
        linkedIssue,
        issue.key,
        storyIdMap
      );

      if (dependencies.length > 0) {
        linkedStory.dependsOn = dependencies;
      }

      // Add link type as a label
      const linkLabel = `jira-link:${linkedIssue.linkType.replace(/\s+/g, '-')}`;
      linkedStory.labels = linkedStory.labels
        ? [...linkedStory.labels, linkLabel]
        : [linkLabel];

      userStories.push(linkedStory);
      linkedIssueCount++;
    }

    // Update main story dependencies if it's blocked by other issues
    const blockingIssues = filteredLinks.filter(
      (link) => link.linkType === 'is blocked by'
    );
    if (blockingIssues.length > 0) {
      const blockingDeps = blockingIssues
        .map((link) => storyIdMap.get(link.issue.key))
        .filter((id): id is string => id !== undefined);
      if (blockingDeps.length > 0) {
        mainStory.dependsOn = mainStory.dependsOn
          ? [...mainStory.dependsOn, ...blockingDeps]
          : blockingDeps;
      }
    }

    if (linkedIssueCount > 0) {
      mappedFields.push('linkedIssues');
    }
  }

  // Create the PRD
  const slug = slugify(name);

  const prd: GeneratedPrd = {
    name,
    slug,
    description,
    targetUsers: 'End users', // Jira doesn't typically have this
    problemStatement,
    solution: description,
    successMetrics: acceptanceCriteria.length > 0
      ? acceptanceCriteria.join('; ')
      : 'Feature meets acceptance criteria',
    constraints: effortEstimate
      ? `Effort estimate: ${effortEstimate}`
      : 'None specified',
    userStories,
    branchName: generateBranchName(`${issue.key}-${name}`),
    createdAt: new Date().toISOString(),
  };

  // Add technical notes with Jira metadata
  prd.technicalNotes = formatJiraMetadata(issue, labels, linkedIssueCount);

  return {
    prd,
    mappedFields,
    defaultedFields,
    skippedFields,
    linkedIssueCount,
    issueKey: issue.key,
  };
}

/**
 * Compute dependencies for a linked issue based on link type.
 * - 'blocks': The linked issue blocks us, so we depend on it
 * - 'is blocked by': We block the linked issue, so it depends on us
 * - 'relates to': No automatic dependency, just related
 */
function computeDependencies(
  linkedIssue: JiraLinkedIssue,
  parentKey: string,
  storyIdMap: Map<string, string>
): string[] {
  const dependencies: string[] = [];

  // If the linked issue blocks the parent (outward link from parent)
  // then the linked issue should be completed first (parent depends on it)
  // If the parent blocks the linked issue, the linked issue depends on parent
  if (linkedIssue.linkType === 'blocks' && linkedIssue.direction === 'inward') {
    // This issue blocks the parent, so the linked story has no deps from this relation
    // (the parent will get the dep added separately)
  } else if (linkedIssue.linkType === 'is blocked by') {
    // The linked issue is blocked by the parent, so it depends on the parent
    const parentStoryId = storyIdMap.get(parentKey);
    if (parentStoryId) {
      dependencies.push(parentStoryId);
    }
  }

  return dependencies;
}

/**
 * Format Jira metadata as technical notes.
 */
function formatJiraMetadata(issue: JiraIssue, labels: string[], linkedIssueCount = 0): string {
  const notes: string[] = [];

  notes.push(`**Source:** Jira Issue ${issue.key}`);
  notes.push(`**Type:** ${issue.type}`);
  notes.push(`**Status:** ${issue.status}`);

  if (issue.priority) {
    notes.push(`**Priority:** ${issue.priority}`);
  }

  if (labels.length > 0) {
    notes.push(`**Labels:** ${labels.join(', ')}`);
  }

  if (issue.storyPoints !== undefined) {
    notes.push(`**Story Points:** ${issue.storyPoints}`);
  }

  if (linkedIssueCount > 0) {
    notes.push(`**Linked Issues:** ${linkedIssueCount} issue${linkedIssueCount > 1 ? 's' : ''} included as user stories`);
  }

  return notes.join('\n');
}

/**
 * Render the Jira-mapped PRD as markdown.
 * Enhanced version that includes Jira-specific sections.
 */
export function renderJiraPrdMarkdown(
  result: JiraFieldMappingResult
): string {
  const { prd, mappedFields, defaultedFields, skippedFields, linkedIssueCount } = result;
  const lines: string[] = [];

  // Header
  lines.push(`# PRD: ${prd.name}`);
  lines.push('');
  lines.push(`> Generated: ${new Date(prd.createdAt).toLocaleDateString()}`);
  lines.push(`> Branch: \`${prd.branchName}\``);
  if (linkedIssueCount > 0) {
    lines.push(`> Linked Issues: ${linkedIssueCount}`);
  }
  lines.push('');

  // Field mapping summary (collapsed by default in most markdown renderers)
  lines.push('<details>');
  lines.push('<summary>Field Mapping Summary</summary>');
  lines.push('');
  if (mappedFields.length > 0) {
    lines.push(`**Mapped fields:** ${mappedFields.join(', ')}`);
  }
  if (defaultedFields.length > 0) {
    lines.push(`**Defaulted fields:** ${defaultedFields.join(', ')}`);
  }
  if (skippedFields.length > 0) {
    lines.push(`**Skipped fields (not available):** ${skippedFields.join(', ')}`);
  }
  lines.push('');
  lines.push('</details>');
  lines.push('');

  // Overview (from description)
  lines.push('## Overview');
  lines.push('');
  lines.push(prd.description);
  lines.push('');

  // Problem Statement
  lines.push('## Problem Statement');
  lines.push('');
  lines.push(prd.problemStatement);
  lines.push('');

  // Success Metrics (from acceptance criteria)
  lines.push('## Success Metrics');
  lines.push('');
  lines.push(prd.successMetrics);
  lines.push('');

  // Constraints (includes effort estimate)
  if (prd.constraints && prd.constraints !== 'None specified') {
    lines.push('## Constraints');
    lines.push('');
    lines.push(prd.constraints);
    lines.push('');
  }

  // User Stories
  lines.push('## User Stories');
  lines.push('');

  for (const story of prd.userStories) {
    lines.push(`### ${story.id}: ${story.title}`);
    lines.push('');
    lines.push(story.description);
    lines.push('');
    lines.push('**Acceptance Criteria:**');
    for (const criterion of story.acceptanceCriteria) {
      lines.push(`- [ ] ${criterion}`);
    }
    lines.push('');

    if (story.labels && story.labels.length > 0) {
      lines.push(`**Tags:** ${story.labels.join(', ')}`);
      lines.push('');
    }

    if (story.dependsOn && story.dependsOn.length > 0) {
      lines.push(`**Depends on:** ${story.dependsOn.join(', ')}`);
      lines.push('');
    }

    lines.push(`**Priority:** P${story.priority}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Technical Notes (Jira metadata)
  if (prd.technicalNotes) {
    lines.push('## Technical Notes');
    lines.push('');
    lines.push(prd.technicalNotes);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Convert Jira-mapped PRD to prd.json format.
 * Includes effort estimate from story points.
 * Includes metadata with source (jira), issue key, and generated timestamp.
 */
export function convertJiraPrdToJson(
  result: JiraFieldMappingResult
): object {
  const { prd, mappedFields, defaultedFields, skippedFields, linkedIssueCount, issueKey } = result;

  return {
    name: prd.name,
    description: prd.description,
    branchName: prd.branchName,
    userStories: prd.userStories.map((story) => ({
      id: story.id,
      title: story.title,
      description: story.description,
      acceptanceCriteria: story.acceptanceCriteria,
      priority: story.priority,
      passes: false,
      labels: story.labels ?? [],
      dependsOn: story.dependsOn ?? [],
    })),
    metadata: {
      createdAt: prd.createdAt,
      generatedAt: new Date().toISOString(),
      version: '1.0.0',
      source: 'jira',
      issueKey,
      linkedIssueCount,
      fieldMapping: {
        mapped: mappedFields,
        defaulted: defaultedFields,
        skipped: skippedFields,
      },
    },
  };
}

/**
 * Result of writing prd.json file.
 */
export interface PrdJsonWriteResult {
  /** Whether the write was successful */
  success: boolean;
  /** Path to the written file */
  filePath?: string;
  /** Summary of the generated content */
  summary?: {
    name: string;
    userStoryCount: number;
    linkedIssueCount: number;
    issueKey: string;
  };
  /** Error message if write failed */
  error?: string;
}

/**
 * Write the PRD JSON to a file and return a result with success message details.
 * Ensures the output directory exists before writing.
 * @param prdJson The PRD JSON object to write
 * @param filePath Path to write the file to (default: ./prd.json)
 * @param result The mapping result for summary information
 * @returns Write result with file path and content summary
 */
export async function writePrdJson(
  prdJson: object,
  filePath: string,
  result: JiraFieldMappingResult
): Promise<PrdJsonWriteResult> {
  try {
    const resolvedPath = resolve(filePath);
    const dir = dirname(resolvedPath);

    // Ensure directory exists
    try {
      await access(dir, constants.F_OK);
    } catch {
      await mkdir(dir, { recursive: true });
    }

    // Write the JSON file with pretty formatting
    const jsonContent = JSON.stringify(prdJson, null, 2);
    await writeFile(resolvedPath, jsonContent, 'utf-8');

    return {
      success: true,
      filePath: resolvedPath,
      summary: {
        name: result.prd.name,
        userStoryCount: result.prd.userStories.length,
        linkedIssueCount: result.linkedIssueCount,
        issueKey: result.issueKey,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Format a success message for prd.json generation.
 * @param writeResult The result from writePrdJson
 * @returns Formatted success message for display
 */
export function formatPrdJsonSuccessMessage(writeResult: PrdJsonWriteResult): string {
  if (!writeResult.success || !writeResult.summary) {
    return `Failed to write prd.json: ${writeResult.error ?? 'Unknown error'}`;
  }

  const { filePath, summary } = writeResult;
  const lines: string[] = [];

  lines.push(`✓ PRD saved to: ${filePath}`);
  lines.push('');
  lines.push('Summary:');
  lines.push(`  Name:         ${summary.name}`);
  lines.push(`  Source:       Jira issue ${summary.issueKey}`);
  lines.push(`  User stories: ${summary.userStoryCount}`);
  if (summary.linkedIssueCount > 0) {
    lines.push(`  Linked issues: ${summary.linkedIssueCount} included as stories`);
  }

  return lines.join('\n');
}
