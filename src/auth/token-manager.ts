/**
 * Token lifecycle manager with bulletproof refresh logic
 * CRITICAL: Never invalidates tokens on transient failures
 */

import { CredentialStore } from './credential-store.js';
import { TokenSet, SpotifyConfig, StoredCredentials } from '../types/config.js';
import { classifyError } from '../client/error-classifier.js';
import { ErrorCategory, ClassifiedError } from '../types/errors.js';
import { logger } from '../utils/logger.js';

export interface TokenRefreshResult {
  success: boolean;
  tokens?: TokenSet;
  error?: ClassifiedError;
  shouldReauth: boolean;
}

export class TokenManager {
  private tokens: TokenSet | null = null;
  private config: SpotifyConfig | null = null;
  private refreshPromise: Promise<TokenRefreshResult> | null = null;
  private usingEnvVars: boolean = false; // Track if we're using env vars

  constructor(private credentialStore: CredentialStore) {}

  /**
   * Load configuration and tokens from disk or environment variables
   * Priority: Stored credentials > Environment variables
   */
  async initialize(): Promise<void> {
    // Try loading from stored credentials first
    const stored = await this.credentialStore.load();
    if (stored) {
      this.config = {
        clientId: stored.clientId,
        clientSecret: stored.clientSecret,
        redirectUri: stored.redirectUri,
      };
      this.tokens = {
        accessToken: stored.accessToken,
        refreshToken: stored.refreshToken,
        expiresAt: stored.expiresAt,
        scopes: stored.scopes,
      };
      logger.info('Token manager initialized from stored credentials');
      return;
    }

    // Fall back to environment variables (for Claude CLI configuration)
    const envClientId = process.env.SPOTIFY_CLIENT_ID;
    const envClientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    const envAccessToken = process.env.SPOTIFY_ACCESS_TOKEN;
    const envRefreshToken = process.env.SPOTIFY_REFRESH_TOKEN;

    if (envClientId && envClientSecret && envAccessToken && envRefreshToken) {
      this.config = {
        clientId: envClientId,
        clientSecret: envClientSecret,
        redirectUri: process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:8888/callback',
      };

      // Parse expiry from env or calculate default
      const expiresAt = process.env.SPOTIFY_EXPIRES_AT
        ? parseInt(process.env.SPOTIFY_EXPIRES_AT)
        : Date.now() + 3600 * 1000; // Default 1 hour from now

      this.tokens = {
        accessToken: envAccessToken,
        refreshToken: envRefreshToken,
        expiresAt,
        scopes: process.env.SPOTIFY_SCOPES?.split(',') || [],
      };
      this.usingEnvVars = true; // Mark that we're using env vars
      logger.info('Token manager initialized from environment variables');
      logger.warn(
        'Using environment variables - refreshed tokens will NOT be persisted. ' +
          'Consider running "npm run auth" for persistent storage.'
      );
      return;
    }

    logger.warn('No credentials found in storage or environment variables - authentication required');
  }

  /**
   * Check if credentials are configured
   */
  isConfigured(): boolean {
    return this.config !== null && this.tokens !== null;
  }

  /**
   * Get current access token (may be expired)
   */
  getAccessToken(): string | null {
    return this.tokens?.accessToken || null;
  }

  /**
   * Get configuration
   */
  getConfig(): SpotifyConfig | null {
    return this.config;
  }

  /**
   * Check if token is expired or expiring soon
   */
  isExpired(): boolean {
    if (!this.tokens) return true;

    // Consider expired if < 5 minutes remaining (buffer for safety)
    const bufferMs = 5 * 60 * 1000;
    return Date.now() >= this.tokens.expiresAt - bufferMs;
  }

  /**
   * Check if refresh token exists
   */
  hasRefreshToken(): boolean {
    return !!this.tokens?.refreshToken;
  }

  /**
   * Ensure token is valid - refresh if needed
   * CRITICAL: Deduplicates concurrent refresh attempts
   */
  async ensureValid(): Promise<TokenRefreshResult> {
    // Tokens valid - no refresh needed
    if (this.tokens && !this.isExpired()) {
      return { success: true, tokens: this.tokens, shouldReauth: false };
    }

    // No refresh token - re-auth needed
    if (!this.hasRefreshToken()) {
      logger.error('No refresh token available - re-authentication required');
      return {
        success: false,
        error: {
          category: ErrorCategory.NO_REFRESH_TOKEN,
          retryable: false,
          shouldInvalidateTokens: true,
          suggestedAction: 'Run: npm run auth',
          originalError: new Error('No refresh token'),
        },
        shouldReauth: true,
      };
    }

    // Deduplicate concurrent refresh attempts
    if (this.refreshPromise) {
      logger.debug('Token refresh already in progress, waiting...');
      return this.refreshPromise;
    }

    // Perform refresh
    this.refreshPromise = this._refreshTokens();
    const result = await this.refreshPromise;
    this.refreshPromise = null;

    return result;
  }

  /**
   * Internal token refresh implementation
   * CRITICAL: Preserves refresh token if not returned in response
   */
  private async _refreshTokens(): Promise<TokenRefreshResult> {
    if (!this.config) {
      throw new Error('Token manager not initialized');
    }

    logger.info('Refreshing access token...');

    try {
      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.tokens!.refreshToken,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw Object.assign(new Error('Token refresh failed'), {
          status: response.status,
          response: { data: errorData },
        });
      }

      const data: any = await response.json();

      // CRITICAL: Preserve existing refresh token if not returned
      // Spotify doesn't always return a new refresh token
      const newTokens: TokenSet = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || this.tokens!.refreshToken,
        expiresAt: Date.now() + data.expires_in * 1000,
        scopes: data.scope ? data.scope.split(' ') : this.tokens!.scopes,
      };

      // Save tokens BEFORE updating in-memory state (only if not using env vars)
      if (!this.usingEnvVars) {
        const storedCreds: StoredCredentials = {
          ...this.config,
          ...newTokens,
        };
        await this.credentialStore.save(storedCreds);
      } else {
        logger.debug('Using env vars - skipping credential file write');
      }

      // Update in-memory state
      this.tokens = newTokens;

      logger.info({
        expiresIn: Math.floor((newTokens.expiresAt - Date.now()) / 1000 / 60) + ' minutes',
      }, 'Access token refreshed successfully');

      return { success: true, tokens: newTokens, shouldReauth: false };
    } catch (error) {
      const classified = classifyError(error);
      logger.error({
        category: classified.category,
        suggestedAction: classified.suggestedAction,
      }, 'Token refresh failed');

      // CRITICAL: Only invalidate tokens if refresh token itself is bad
      const shouldReauth =
        classified.category === ErrorCategory.REFRESH_FAILED ||
        (classified.category === ErrorCategory.UNAUTHORIZED &&
          (error as any)?.response?.data?.error === 'invalid_grant');

      if (shouldReauth) {
        logger.error('Refresh token invalid - clearing credentials');
        await this.invalidateTokens();
      } else {
        logger.warn('Token refresh failed transiently - keeping existing tokens');
      }

      return { success: false, error: classified, shouldReauth };
    }
  }

  /**
   * Nuclear option - only call when refresh token is provably invalid
   */
  async invalidateTokens(): Promise<void> {
    logger.warn('Invalidating all tokens');
    this.tokens = null;
    await this.credentialStore.clear();
  }

  /**
   * Store new credentials (after OAuth flow)
   */
  async storeCredentials(creds: StoredCredentials): Promise<void> {
    this.config = {
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      redirectUri: creds.redirectUri,
    };
    this.tokens = {
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken,
      expiresAt: creds.expiresAt,
      scopes: creds.scopes,
    };
    await this.credentialStore.save(creds);
    logger.info('New credentials stored successfully');
  }
}
