/**
 * Shorts ranking: pure LLM-reply parsing, candidate post-processing, prompt
 * text and OpenRouter policy helpers, ported from the AutoShorts desktop app.
 * No I/O lives here; providers call these around their network code.
 */

export {
  compactSegments,
  fmt2,
  extractJsonSpan,
  segmentBoundaries,
  fitToMinDuration,
  parseCandidateJson,
  suppressOverlaps,
  fallbackTitle,
  parseCopy,
  type ParseCandidateOptions,
  type CreativeCopy,
} from "./parse";

export {
  type Task,
  TASKS,
  TASK_ENV_VARS,
  TASK_DEFAULT_MODELS,
  taskModel,
  redact,
  MAX_ATTEMPTS,
  isRetryable,
  backoffSecs,
  parseRetryAfter,
  CompletionDetails,
  Usage,
  ChatResponse,
  parseChatResponse,
  extractText,
  extractImageUrl,
  decodeImagePayload,
  base64Decode,
} from "./policy";

export {
  DETECTION_PROMPT,
  DETECTION_PROMPT_SMALL_MODEL,
  DETECTION_USER_SMALL_MODEL,
  EDITORIAL_DETECTION_SYSTEM,
  EDITORIAL_DETECTION_PROMPT,
  TITLE_PROMPT,
  CREATIVE_COPY_SYSTEM,
  CREATIVE_COPY_USER,
  creativeBrandContext,
  BROLL_PLAN_PROMPT,
  brollNumberedSlots,
  fillPrompt,
  withProductContext,
} from "./prompts";
