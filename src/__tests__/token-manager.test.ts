/**
 * Tests for token lifecycle management
 * CRITICAL: Ensures conservative token invalidation and proper refresh deduplication
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { TokenManager } from '../auth/token-manager.js';
import { CredentialStore } from '../auth/credential-store.js';
import { StoredCredentials } from '../types/config.js';
import { ErrorCategory } from '../types/errors.js';

// Mock fetch globally
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('TokenManager', () => {
  let manager: TokenManager;
  let mockStore: jest.Mocked<CredentialStore>;

  beforeEach(() => {
    // Clear fetch mock
    (global.fetch as jest.MockedFunction<typeof fetch>).mockClear();

    // Create mock credential store
    mockStore = {
      load: jest.fn(),
      save: jest.fn(),
      clear: jest.fn(),
    } as any;

    manager = new TokenManager(mockStore);
  });

  afterEach(() => {
    // Clear environment variables
    delete process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_CLIENT_SECRET;
    delete process.env.SPOTIFY_ACCESS_TOKEN;
    delete process.env.SPOTIFY_REFRESH_TOKEN;
    delete process.env.SPOTIFY_EXPIRES_AT;
    delete process.env.SPOTIFY_SCOPES;
  });

  describe('initialize', () => {
    it('should load from stored credentials first', async () => {
      const stored: StoredCredentials = {
        clientId: 'stored-client-id',
        clientSecret: 'stored-secret',
        redirectUri: 'http://localhost:8888/callback',
        accessToken: 'stored-access',
        refreshToken: 'stored-refresh',
        expiresAt: Date.now() + 3600000,
        scopes: ['user-read-playback-state'],
      };

      mockStore.load.mockResolvedValue(stored);

      await manager.initialize();

      expect(manager.isConfigured()).toBe(true);
      expect(manager.getAccessToken()).toBe('stored-access');
    });

    it('should fall back to environment variables', async () => {
      mockStore.load.mockResolvedValue(null);

      process.env.SPOTIFY_CLIENT_ID = 'env-client-id';
      process.env.SPOTIFY_CLIENT_SECRET = 'env-secret';
      process.env.SPOTIFY_ACCESS_TOKEN = 'env-access';
      process.env.SPOTIFY_REFRESH_TOKEN = 'env-refresh';
      process.env.SPOTIFY_SCOPES = 'user-read-playback-state,user-modify-playback-state';

      await manager.initialize();

      expect(manager.isConfigured()).toBe(true);
      expect(manager.getAccessToken()).toBe('env-access');
    });

    it('should handle missing credentials', async () => {
      mockStore.load.mockResolvedValue(null);

      await manager.initialize();

      expect(manager.isConfigured()).toBe(false);
      expect(manager.getAccessToken()).toBeNull();
    });

    it('should parse expiry from environment', async () => {
      mockStore.load.mockResolvedValue(null);

      const futureTime = Date.now() + 7200000; // 2 hours
      process.env.SPOTIFY_CLIENT_ID = 'client-id';
      process.env.SPOTIFY_CLIENT_SECRET = 'secret';
      process.env.SPOTIFY_ACCESS_TOKEN = 'access';
      process.env.SPOTIFY_REFRESH_TOKEN = 'refresh';
      process.env.SPOTIFY_EXPIRES_AT = futureTime.toString();

      await manager.initialize();

      expect(manager.isExpired()).toBe(false);
    });
  });

  describe('isExpired', () => {
    it('should detect expired tokens', async () => {
      const stored: StoredCredentials = {
        clientId: 'client-id',
        clientSecret: 'secret',
        redirectUri: 'http://localhost:8888/callback',
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: Date.now() - 1000, // Expired 1 second ago
        scopes: [],
      };

      mockStore.load.mockResolvedValue(stored);
      await manager.initialize();

      expect(manager.isExpired()).toBe(true);
    });

    it('should consider expiring soon as expired (5 min buffer)', async () => {
      const stored: StoredCredentials = {
        clientId: 'client-id',
        clientSecret: 'secret',
        redirectUri: 'http://localhost:8888/callback',
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 4 * 60 * 1000, // 4 minutes from now
        scopes: [],
      };

      mockStore.load.mockResolvedValue(stored);
      await manager.initialize();

      expect(manager.isExpired()).toBe(true);
    });

    it('should not consider valid tokens expired', async () => {
      const stored: StoredCredentials = {
        clientId: 'client-id',
        clientSecret: 'secret',
        redirectUri: 'http://localhost:8888/callback',
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 20 * 60 * 1000, // 20 minutes from now
        scopes: [],
      };

      mockStore.load.mockResolvedValue(stored);
      await manager.initialize();

      expect(manager.isExpired()).toBe(false);
    });
  });

  describe('ensureValid', () => {
    it('should return existing tokens if not expired', async () => {
      const stored: StoredCredentials = {
        clientId: 'client-id',
        clientSecret: 'secret',
        redirectUri: 'http://localhost:8888/callback',
        accessToken: 'valid-access',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600000,
        scopes: [],
      };

      mockStore.load.mockResolvedValue(stored);
      await manager.initialize();

      const result = await manager.ensureValid();

      expect(result.success).toBe(true);
      expect(result.tokens?.accessToken).toBe('valid-access');
      expect(result.shouldReauth).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should require re-auth if no refresh token', async () => {
      const stored: StoredCredentials = {
        clientId: 'client-id',
        clientSecret: 'secret',
        redirectUri: 'http://localhost:8888/callback',
        accessToken: 'access',
        refreshToken: '', // No refresh token
        expiresAt: Date.now() - 1000,
        scopes: [],
      };

      mockStore.load.mockResolvedValue(stored);
      await manager.initialize();

      const result = await manager.ensureValid();

      expect(result.success).toBe(false);
      expect(result.shouldReauth).toBe(true);
      expect(result.error?.category).toBe(ErrorCategory.NO_REFRESH_TOKEN);
    });

    it('should refresh expired tokens', async () => {
      const stored: StoredCredentials = {
        clientId: 'client-id',
        clientSecret: 'secret',
        redirectUri: 'http://localhost:8888/callback',
        accessToken: 'old-access',
        refreshToken: 'refresh',
        expiresAt: Date.now() - 1000, // Expired
        scopes: ['user-read-playback-state'],
      };

      mockStore.load.mockResolvedValue(stored);
      await manager.initialize();

      // Mock successful refresh
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
          scope: 'user-read-playback-state',
        }),
      } as Response);

      const result = await manager.ensureValid();

      expect(result.success).toBe(true);
      expect(result.tokens?.accessToken).toBe('new-access');
      expect(result.shouldReauth).toBe(false);
      expect(mockStore.save).toHaveBeenCalled();
    });

    it('should preserve refresh token if not returned', async () => {
      const stored: StoredCredentials = {
        clientId: 'client-id',
        clientSecret: 'secret',
        redirectUri: 'http://localhost:8888/callback',
        accessToken: 'old-access',
        refreshToken: 'original-refresh',
        expiresAt: Date.now() - 1000,
        scopes: [],
      };

      mockStore.load.mockResolvedValue(stored);
      await manager.initialize();

      // Mock refresh response WITHOUT new refresh token
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new-access',
          // No refresh_token in response
          expires_in: 3600,
        }),
      } as Response);

      const result = await manager.ensureValid();

      expect(result.success).toBe(true);
      expect(result.tokens?.refreshToken).toBe('original-refresh');
    });

    it('should deduplicate concurrent refresh attempts', async () => {
      const stored: StoredCredentials = {
        clientId: 'client-id',
        clientSecret: 'secret',
        redirectUri: 'http://localhost:8888/callback',
        accessToken: 'old-access',
        refreshToken: 'refresh',
        expiresAt: Date.now() - 1000,
        scopes: [],
      };

      mockStore.load.mockResolvedValue(stored);
      await manager.initialize();

      let resolveRefresh: (value: any) => void;
      const refreshPromise = new Promise((resolve) => {
        resolveRefresh = resolve;
      });

      // Mock slow refresh
      (global.fetch as jest.MockedFunction<typeof fetch>).mockImplementation(async () => {
        await refreshPromise;
        return {
          ok: true,
          json: async () => ({
            access_token: 'new-access',
            expires_in: 3600,
          }),
        } as Response;
      });

      // Start multiple refresh attempts concurrently
      const promise1 = manager.ensureValid();
      const promise2 = manager.ensureValid();
      const promise3 = manager.ensureValid();

      // Resolve the refresh
      resolveRefresh!(null);

      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

      // All should succeed with same token
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result3.success).toBe(true);

      // But fetch should only be called once
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Token Invalidation Policy', () => {
    it('should NOT invalidate on transient 500 error', async () => {
      const stored: StoredCredentials = {
        clientId: 'client-id',
        clientSecret: 'secret',
        redirectUri: 'http://localhost:8888/callback',
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: Date.now() - 1000,
        scopes: [],
      };

      mockStore.load.mockResolvedValue(stored);
      await manager.initialize();

      // Mock 500 error
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as Response);

      const result = await manager.ensureValid();

      expect(result.success).toBe(false);
      expect(result.shouldReauth).toBe(false);
      expect(mockStore.clear).not.toHaveBeenCalled();
      expect(manager.getAccessToken()).toBe('access'); // Token preserved
    });

    it('should invalidate ONLY on invalid_grant', async () => {
      const stored: StoredCredentials = {
        clientId: 'client-id',
        clientSecret: 'secret',
        redirectUri: 'http://localhost:8888/callback',
        accessToken: 'access',
        refreshToken: 'bad-refresh',
        expiresAt: Date.now() - 1000,
        scopes: [],
      };

      mockStore.load.mockResolvedValue(stored);
      await manager.initialize();

      // Mock invalid_grant error with 401 status
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'invalid_grant' }),
      } as Response);

      const result = await manager.ensureValid();

      expect(result.success).toBe(false);
      expect(result.shouldReauth).toBe(true);
      expect(mockStore.clear).toHaveBeenCalled();
      expect(manager.getAccessToken()).toBeNull(); // Token cleared
    });

    it('should NOT save tokens when using env vars', async () => {
      mockStore.load.mockResolvedValue(null);

      process.env.SPOTIFY_CLIENT_ID = 'client-id';
      process.env.SPOTIFY_CLIENT_SECRET = 'secret';
      process.env.SPOTIFY_ACCESS_TOKEN = 'access';
      process.env.SPOTIFY_REFRESH_TOKEN = 'refresh';
      process.env.SPOTIFY_EXPIRES_AT = (Date.now() - 1000).toString();

      await manager.initialize();

      // Mock successful refresh
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new-access',
          expires_in: 3600,
        }),
      } as Response);

      await manager.ensureValid();

      // Should NOT save to credential store
      expect(mockStore.save).not.toHaveBeenCalled();
    });
  });

  describe('storeCredentials', () => {
    it('should store new credentials from OAuth', async () => {
      const newCreds: StoredCredentials = {
        clientId: 'new-client-id',
        clientSecret: 'new-secret',
        redirectUri: 'http://localhost:8888/callback',
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresAt: Date.now() + 3600000,
        scopes: ['user-read-playback-state'],
      };

      await manager.storeCredentials(newCreds);

      expect(mockStore.save).toHaveBeenCalledWith(newCreds);
      expect(manager.getAccessToken()).toBe('new-access');
      expect(manager.isConfigured()).toBe(true);
    });
  });

  describe('invalidateTokens', () => {
    it('should clear tokens and storage', async () => {
      const stored: StoredCredentials = {
        clientId: 'client-id',
        clientSecret: 'secret',
        redirectUri: 'http://localhost:8888/callback',
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600000,
        scopes: [],
      };

      mockStore.load.mockResolvedValue(stored);
      await manager.initialize();

      expect(manager.isConfigured()).toBe(true);

      await manager.invalidateTokens();

      expect(mockStore.clear).toHaveBeenCalled();
      expect(manager.getAccessToken()).toBeNull();
    });
  });
});
