/**
 * Tests for error classification system
 * CRITICAL: Ensures tokens are never invalidated on transient failures
 */

import { describe, it, expect } from '@jest/globals';
import { classifyError } from '../client/error-classifier.js';
import { ErrorCategory } from '../types/errors.js';

describe('Error Classifier', () => {
  describe('Transient Network Errors', () => {
    it('should classify 500 errors as transient', () => {
      const error = { status: 500 };
      const result = classifyError(error);

      expect(result.category).toBe(ErrorCategory.TRANSIENT_NETWORK);
      expect(result.retryable).toBe(true);
      expect(result.shouldInvalidateTokens).toBe(false);
    });

    it('should classify 502 errors as transient', () => {
      const error = { status: 502 };
      const result = classifyError(error);

      expect(result.category).toBe(ErrorCategory.TRANSIENT_NETWORK);
      expect(result.shouldInvalidateTokens).toBe(false);
    });

    it('should classify 503 errors as transient', () => {
      const error = { status: 503 };
      const result = classifyError(error);

      expect(result.category).toBe(ErrorCategory.TRANSIENT_NETWORK);
      expect(result.shouldInvalidateTokens).toBe(false);
    });

    it('should classify network errors as transient', () => {
      const error = { code: 'ECONNREFUSED' };
      const result = classifyError(error);

      expect(result.category).toBe(ErrorCategory.TRANSIENT_NETWORK);
      expect(result.retryable).toBe(true);
      expect(result.shouldInvalidateTokens).toBe(false);
    });

    it('should classify timeout errors as transient', () => {
      const error = { code: 'ETIMEDOUT' };
      const result = classifyError(error);

      expect(result.category).toBe(ErrorCategory.TRANSIENT_NETWORK);
      expect(result.shouldInvalidateTokens).toBe(false);
    });
  });

  describe('Rate Limiting', () => {
    it('should classify 429 errors as rate limit', () => {
      const error = { status: 429 };
      const result = classifyError(error);

      expect(result.category).toBe(ErrorCategory.RATE_LIMIT);
      expect(result.retryable).toBe(true);
      expect(result.shouldInvalidateTokens).toBe(false);
    });

    it('should extract Retry-After header', () => {
      const error = {
        status: 429,
        response: {
          headers: {
            'retry-after': '60',
          },
        },
      };
      const result = classifyError(error);

      expect(result.category).toBe(ErrorCategory.RATE_LIMIT);
      expect(result.retryAfterMs).toBe(60000);
      expect(result.shouldInvalidateTokens).toBe(false);
    });
  });

  describe('Client Errors', () => {
    it('should classify 400 errors as bad request', () => {
      const error = { status: 400 };
      const result = classifyError(error);

      expect(result.category).toBe(ErrorCategory.BAD_REQUEST);
      expect(result.retryable).toBe(false);
      expect(result.shouldInvalidateTokens).toBe(false);
    });

    it('should classify 404 errors as not found', () => {
      const error = { status: 404 };
      const result = classifyError(error);

      expect(result.category).toBe(ErrorCategory.RESOURCE_NOT_FOUND);
      expect(result.retryable).toBe(false);
      expect(result.shouldInvalidateTokens).toBe(false);
    });
  });

  describe('Authentication Errors', () => {
    it('should classify 401 errors as unauthorized', () => {
      const error = { status: 401 };
      const result = classifyError(error);

      expect(result.category).toBe(ErrorCategory.UNAUTHORIZED);
      expect(result.retryable).toBe(true); // Try refresh first
      // NOTE: Should NOT invalidate tokens - might be transient
      expect(result.shouldInvalidateTokens).toBe(false);
    });

    it('should classify 403 errors as forbidden', () => {
      const error = { status: 403 };
      const result = classifyError(error);

      expect(result.category).toBe(ErrorCategory.FORBIDDEN);
      // 403 is retryable - known Spotify bug
      expect(result.retryable).toBe(true);
      expect(result.shouldInvalidateTokens).toBe(false);
    });

    it('should classify invalid_grant as refresh failed', () => {
      const error = {
        status: 401,
        response: {
          data: {
            error: 'invalid_grant',
          },
        },
      };
      const result = classifyError(error);

      expect(result.category).toBe(ErrorCategory.REFRESH_FAILED);
      expect(result.retryable).toBe(false);
      // CRITICAL: Only this error should invalidate tokens
      expect(result.shouldInvalidateTokens).toBe(true);
    });
  });

  describe('Token Invalidation Policy', () => {
    it('should NEVER invalidate tokens on 500 errors', () => {
      const error = { status: 500 };
      const result = classifyError(error);
      expect(result.shouldInvalidateTokens).toBe(false);
    });

    it('should NEVER invalidate tokens on network errors', () => {
      const error = { code: 'ECONNREFUSED' };
      const result = classifyError(error);
      expect(result.shouldInvalidateTokens).toBe(false);
    });

    it('should NEVER invalidate tokens on rate limits', () => {
      const error = { status: 429 };
      const result = classifyError(error);
      expect(result.shouldInvalidateTokens).toBe(false);
    });

    it('should ONLY invalidate tokens on invalid_grant', () => {
      const error = {
        status: 401,
        response: {
          data: {
            error: 'invalid_grant',
          },
        },
      };
      const result = classifyError(error);
      expect(result.shouldInvalidateTokens).toBe(true);
    });
  });

  describe('Unknown Errors', () => {
    it('should classify unknown errors', () => {
      const error = new Error('Something went wrong');
      const result = classifyError(error);

      expect(result.category).toBe(ErrorCategory.UNKNOWN);
      expect(result.retryable).toBe(false); // Unknown errors are not retryable
      expect(result.shouldInvalidateTokens).toBe(false);
    });

    it('should preserve original error', () => {
      const error = new Error('Test error');
      const result = classifyError(error);

      expect(result.originalError).toBe(error);
    });
  });
});
