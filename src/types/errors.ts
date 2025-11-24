/**
 * Error classification system for Spotify API errors
 * CRITICAL: Conservative token invalidation - only clear tokens when absolutely necessary
 */

export enum ErrorCategory {
  // NEVER nuke tokens for these
  TRANSIENT_NETWORK = 'transient_network', // 500, 502, 503, network timeout
  RATE_LIMIT = 'rate_limit', // 429
  BAD_REQUEST = 'bad_request', // 400 (user error)
  RESOURCE_NOT_FOUND = 'not_found', // 404

  // Maybe nuke tokens (investigate first)
  UNAUTHORIZED = 'unauthorized', // 401 (could be expired token OR bad scope)
  FORBIDDEN = 'forbidden', // 403 (could be scope issue OR transient)

  // Definitely re-auth needed
  REFRESH_FAILED = 'refresh_failed', // Refresh token invalid/revoked
  NO_REFRESH_TOKEN = 'no_refresh_token', // Missing refresh token entirely

  // Unknown
  UNKNOWN = 'unknown',
}

export interface ClassifiedError {
  category: ErrorCategory;
  retryable: boolean;
  shouldInvalidateTokens: boolean;
  suggestedAction: string;
  originalError: Error;
  retryAfterMs?: number; // For rate limiting
}

export class SpotifyError extends Error {
  constructor(
    message: string,
    public readonly classified: ClassifiedError
  ) {
    super(message);
    this.name = 'SpotifyError';
  }
}
