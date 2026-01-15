/**
 * ABOUTME: Type definitions for the PRD creation command.
 * Defines the structure for PRD documents, clarifying questions, and generation options.
 */

/**
 * A single clarifying question asked during PRD creation.
 */
export interface ClarifyingQuestion {
  /** Unique identifier for the question */
  id: string;

  /** The question text to display */
  question: string;

  /** Category of the question (helps organize the PRD) */
  category: 'scope' | 'users' | 'requirements' | 'constraints' | 'success';

  /** Optional follow-up prompt if the answer is too brief */
  followUp?: string;
}

/**
 * Collected answers from the clarifying questions.
 */
export interface ClarifyingAnswers {
  /** Feature description provided by the user */
  featureDescription: string;

  /** Answers keyed by question ID */
  answers: Record<string, string>;
}

/**
 * A user story extracted/generated for the PRD.
 */
export interface PrdUserStory {
  /** Unique story identifier (e.g., "US-001") */
  id: string;

  /** Short title of the user story */
  title: string;

  /** Full description of the user story */
  description: string;

  /** List of acceptance criteria */
  acceptanceCriteria: string[];

  /** Priority level (1 = highest, 4 = lowest) */
  priority: number;

  /** Labels or tags */
  labels?: string[];

  /** Dependencies - story IDs this story depends on */
  dependsOn?: string[];
}

/**
 * Generated PRD document structure.
 */
export interface GeneratedPrd {
  /** Name/title of the feature */
  name: string;

  /** Slugified version of the name for file naming */
  slug: string;

  /** High-level description/summary */
  description: string;

  /** Target users and personas */
  targetUsers: string;

  /** Problem statement / why this feature is needed */
  problemStatement: string;

  /** Proposed solution overview */
  solution: string;

  /** Success metrics / how we'll measure completion */
  successMetrics: string;

  /** Constraints or limitations */
  constraints: string;

  /** Detailed user stories */
  userStories: PrdUserStory[];

  /** Technical considerations (optional) */
  technicalNotes?: string;

  /** Git branch name suggestion */
  branchName: string;

  /** Creation timestamp */
  createdAt: string;
}

/**
 * Options for PRD generation.
 */
export interface PrdGenerationOptions {
  /** Working directory (default: process.cwd()) */
  cwd?: string;

  /** Number of user stories to generate (default: 5) */
  storyCount?: number;

  /** Output directory (default: ./tasks) */
  outputDir?: string;

  /** Whether to also generate prd.json format */
  generateJson?: boolean;

  /** Story ID prefix (default: "US-") */
  storyPrefix?: string;

  /** Skip confirmation prompts */
  force?: boolean;
}

/**
 * Result of PRD generation.
 */
export interface PrdGenerationResult {
  /** Whether generation was successful */
  success: boolean;

  /** Path to the generated markdown PRD */
  markdownPath?: string;

  /** Path to the generated JSON PRD (if generateJson was true) */
  jsonPath?: string;

  /** The generated PRD content */
  prd?: GeneratedPrd;

  /** Error message if generation failed */
  error?: string;

  /** Whether the user cancelled the operation */
  cancelled?: boolean;
}

/**
 * Tracker format conversion options.
 */
export type TrackerFormat = 'json' | 'beads';

/**
 * Result of tracker format conversion.
 */
export interface ConversionResult {
  /** Whether conversion was successful */
  success: boolean;

  /** Path to the converted file */
  path?: string;

  /** Target format */
  format: TrackerFormat;

  /** Error message if conversion failed */
  error?: string;
}
