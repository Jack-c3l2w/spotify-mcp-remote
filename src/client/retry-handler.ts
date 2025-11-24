/**
 * Retry logic with exponential backoff
 * Handles transient failures gracefully without invalidating tokens
 */

import { classifyError } from './error-classifier.js';
import { ErrorCategory } from '../types/errors.js';
import { logger } from '../utils/logger.js';

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableCategories: ErrorCategory[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableCategories: [
    ErrorCategory.TRANSIENT_NETWORK,
    ErrorCategory.RATE_LIMIT,
    ErrorCategory.FORBIDDEN, // For Spotify's transient 403 bug
  ],
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  context: string = 'operation'
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const classified = classifyError(error);
      lastError = classified.originalError;

      // Don't retry if not retryable
      if (
        !classified.retryable ||
        !config.retryableCategories.includes(classified.category)
      ) {
        logger.error({
          context,
          category: classified.category,
          suggestedAction: classified.suggestedAction,
        }, `${context} failed (not retryable)`);
        throw error;
      }

      // Last attempt - throw
      if (attempt === config.maxRetries) {
        logger.error({
          context,
          category: classified.category,
          attempts: attempt + 1,
        }, `${context} failed after ${attempt + 1} attempts`);
        throw error;
      }

      // Calculate delay
      let delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);

      // Handle rate limiting - use Retry-After header
      if (classified.category === ErrorCategory.RATE_LIMIT && classified.retryAfterMs) {
        delay = classified.retryAfterMs;
      }

      delay = Math.min(delay, config.maxDelayMs);

      logger.warn({
        context,
        category: classified.category,
        attempt: attempt + 1,
        maxRetries: config.maxRetries,
        delayMs: delay,
      }, `${context} attempt ${attempt + 1} failed, retrying in ${delay}ms`);

      await sleep(delay);
    }
  }

  throw lastError || new Error('Max retries exceeded');
}
