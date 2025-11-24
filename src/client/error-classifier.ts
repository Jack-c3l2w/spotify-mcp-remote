/**
 * Error classification system - determines how to handle different error types
 * CRITICAL: Conservative approach - only invalidate tokens when absolutely necessary
 */

import { ErrorCategory, ClassifiedError } from '../types/errors.js';

export function classifyError(error: any): ClassifiedError {
  const status = error?.status || error?.response?.status;
  const errorBody = error?.response?.data?.error;

  // Network/server errors - NEVER nuke tokens
  if (
    status >= 500 ||
    error.code === 'ECONNREFUSED' ||
    error.code === 'ETIMEDOUT' ||
    error.code === 'ENOTFOUND' ||
    error.code === 'ENETUNREACH'
  ) {
    return {
      category: ErrorCategory.TRANSIENT_NETWORK,
      retryable: true,
      shouldInvalidateTokens: false,
      suggestedAction: 'Retry with exponential backoff',
      originalError: error,
    };
  }

  // Rate limiting - NEVER nuke tokens
  if (status === 429) {
    const retryAfter = error?.response?.headers?.['retry-after'];
    const retryAfterMs = retryAfter ? parseInt(retryAfter) * 1000 : 60000;

    return {
      category: ErrorCategory.RATE_LIMIT,
      retryable: true,
      shouldInvalidateTokens: false,
      suggestedAction: `Wait ${Math.ceil(retryAfterMs / 1000)}s before retry`,
      originalError: error,
      retryAfterMs,
    };
  }

  // Unauthorized - investigate before nuking
  if (status === 401) {
    // Token expired - try refresh first
    if (
      errorBody?.message?.includes('expired') ||
      errorBody?.message?.includes('invalid') ||
      errorBody === 'invalid_token'
    ) {
      return {
        category: ErrorCategory.UNAUTHORIZED,
        retryable: true, // Try refresh first
        shouldInvalidateTokens: false, // Only if refresh fails
        suggestedAction: 'Attempt token refresh',
        originalError: error,
      };
    }

    // Invalid grant - refresh token is bad
    if (errorBody === 'invalid_grant' || errorBody?.error === 'invalid_grant') {
      return {
        category: ErrorCategory.REFRESH_FAILED,
        retryable: false,
        shouldInvalidateTokens: true,
        suggestedAction: 'Re-authenticate (run: npm run auth)',
        originalError: error,
      };
    }

    // Generic 401 - try refresh
    return {
      category: ErrorCategory.UNAUTHORIZED,
      retryable: true,
      shouldInvalidateTokens: false,
      suggestedAction: 'Attempt token refresh',
      originalError: error,
    };
  }

  // Forbidden - could be transient (Spotify bug) or scope issue
  // Spotify has a known bug where 403 errors are often transient
  if (status === 403) {
    return {
      category: ErrorCategory.FORBIDDEN,
      retryable: true, // Retry a few times (Spotify 403 bug)
      shouldInvalidateTokens: false,
      suggestedAction: 'Retry up to 3 times (Spotify 403 is often transient)',
      originalError: error,
    };
  }

  // Bad request - user error, not token issue
  if (status === 400) {
    return {
      category: ErrorCategory.BAD_REQUEST,
      retryable: false,
      shouldInvalidateTokens: false,
      suggestedAction: 'Check request parameters',
      originalError: error,
    };
  }

  // Not found - user error
  if (status === 404) {
    return {
      category: ErrorCategory.RESOURCE_NOT_FOUND,
      retryable: false,
      shouldInvalidateTokens: false,
      suggestedAction: 'Verify resource ID exists',
      originalError: error,
    };
  }

  // Unknown error
  return {
    category: ErrorCategory.UNKNOWN,
    retryable: false,
    shouldInvalidateTokens: false,
    suggestedAction: 'Check error details',
    originalError: error,
  };
}
