/**
 * Integration tests for Spotify client
 * Tests API interaction and retry behavior
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { SpotifyClient } from '../client/spotify-client.js';
import { TokenManager } from '../auth/token-manager.js';
import { SpotifyApi } from '@spotify/web-api-ts-sdk';

// Mock SpotifyApi
jest.mock('@spotify/web-api-ts-sdk');

describe('SpotifyClient', () => {
  let client: SpotifyClient;
  let mockTokenManager: jest.Mocked<TokenManager>;
  let mockApi: any;

  beforeEach(() => {
    // Create mock token manager
    mockTokenManager = {
      ensureValid: jest.fn(),
      getConfig: jest.fn(),
      getAccessToken: jest.fn(),
      isConfigured: jest.fn(),
      isExpired: jest.fn(),
      hasRefreshToken: jest.fn(),
      invalidateTokens: jest.fn(),
      storeCredentials: jest.fn(),
      initialize: jest.fn(),
    } as any;

    // Create mock API
    mockApi = {
      search: jest.fn(),
      player: {
        getAvailableDevices: jest.fn(),
        transferPlayback: jest.fn(),
        startResumePlayback: jest.fn(),
        pausePlayback: jest.fn(),
        skipToNext: jest.fn(),
        skipToPrevious: jest.fn(),
        getPlaybackState: jest.fn(),
        setPlaybackVolume: jest.fn(),
      },
    };

    // Mock SpotifyApi.withAccessToken
    (SpotifyApi.withAccessToken as jest.MockedFunction<typeof SpotifyApi.withAccessToken>).mockReturnValue(mockApi);

    client = new SpotifyClient(mockTokenManager);
  });

  describe('Authentication', () => {
    it('should ensure valid token before API calls', async () => {
      mockTokenManager.ensureValid.mockResolvedValue({
        success: true,
        tokens: {
          accessToken: 'test-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + 3600000,
          scopes: [],
        },
        shouldReauth: false,
      });

      mockTokenManager.getConfig.mockReturnValue({
        clientId: 'client-id',
        clientSecret: 'secret',
        redirectUri: 'http://localhost:8888/callback',
      });

      mockTokenManager.getAccessToken.mockReturnValue('test-token');

      mockApi.player.getAvailableDevices.mockResolvedValue({ devices: [] });

      await client.getDevices();

      expect(mockTokenManager.ensureValid).toHaveBeenCalled();
      expect(SpotifyApi.withAccessToken).toHaveBeenCalledWith('client-id', {
        access_token: 'test-token',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'refresh-token',
      });
    });

    it('should throw if token refresh fails', async () => {
      mockTokenManager.ensureValid.mockResolvedValue({
        success: false,
        error: {
          category: 'UNAUTHORIZED' as any,
          retryable: false,
          shouldInvalidateTokens: true,
          suggestedAction: 'Run: npm run auth',
          originalError: new Error('Invalid token'),
        },
        shouldReauth: true,
      });

      await expect(client.getDevices()).rejects.toThrow('Run: npm run auth');
    });
  });

  describe('Search', () => {
    beforeEach(() => {
      mockTokenManager.ensureValid.mockResolvedValue({
        success: true,
        tokens: {
          accessToken: 'test-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + 3600000,
          scopes: [],
        },
        shouldReauth: false,
      });

      mockTokenManager.getConfig.mockReturnValue({
        clientId: 'client-id',
        clientSecret: 'secret',
        redirectUri: 'http://localhost:8888/callback',
      });

      mockTokenManager.getAccessToken.mockReturnValue('test-token');
    });

    it('should search for tracks', async () => {
      const mockTracks = [
        { id: '1', name: 'Track 1', artists: [{ name: 'Artist 1' }] },
        { id: '2', name: 'Track 2', artists: [{ name: 'Artist 2' }] },
      ];

      mockApi.search.mockResolvedValue({
        tracks: { items: mockTracks },
      });

      const results = await client.searchTracks('test query');

      expect(mockApi.search).toHaveBeenCalledWith('test query', ['track'], undefined, 10);
      expect(results).toEqual(mockTracks);
    });

    it('should constrain search limit to valid range', async () => {
      mockApi.search.mockResolvedValue({
        tracks: { items: [] },
      });

      // Test limit too high
      await client.searchTracks('test', 100);
      expect(mockApi.search).toHaveBeenCalledWith('test', ['track'], undefined, 50);

      // Test limit too low
      await client.searchTracks('test', 0);
      expect(mockApi.search).toHaveBeenCalledWith('test', ['track'], undefined, 1);
    });
  });

  describe('Device Management', () => {
    beforeEach(() => {
      mockTokenManager.ensureValid.mockResolvedValue({
        success: true,
        tokens: {
          accessToken: 'test-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + 3600000,
          scopes: [],
        },
        shouldReauth: false,
      });

      mockTokenManager.getConfig.mockReturnValue({
        clientId: 'client-id',
        clientSecret: 'secret',
        redirectUri: 'http://localhost:8888/callback',
      });

      mockTokenManager.getAccessToken.mockReturnValue('test-token');
    });

    it('should get available devices', async () => {
      const mockDevices = [
        { id: 'device1', name: 'Speaker', type: 'Speaker', is_active: true },
        { id: 'device2', name: 'Phone', type: 'Smartphone', is_active: false },
      ];

      mockApi.player.getAvailableDevices.mockResolvedValue({
        devices: mockDevices,
      });

      const devices = await client.getDevices();

      expect(devices).toEqual(mockDevices);
    });

    it('should transfer playback to device', async () => {
      mockApi.player.transferPlayback.mockResolvedValue(undefined);

      await client.transferPlayback('device-id', true);

      expect(mockApi.player.transferPlayback).toHaveBeenCalledWith(['device-id'], true);
    });
  });

  describe('Playback Control', () => {
    beforeEach(() => {
      mockTokenManager.ensureValid.mockResolvedValue({
        success: true,
        tokens: {
          accessToken: 'test-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + 3600000,
          scopes: [],
        },
        shouldReauth: false,
      });

      mockTokenManager.getConfig.mockReturnValue({
        clientId: 'client-id',
        clientSecret: 'secret',
        redirectUri: 'http://localhost:8888/callback',
      });

      mockTokenManager.getAccessToken.mockReturnValue('test-token');
    });

    it('should start playback', async () => {
      mockApi.player.startResumePlayback.mockResolvedValue(undefined);

      await client.play('device-id');

      expect(mockApi.player.startResumePlayback).toHaveBeenCalledWith('device-id', undefined, undefined);
    });

    it('should start playback with URIs', async () => {
      mockApi.player.startResumePlayback.mockResolvedValue(undefined);

      await client.play('device-id', undefined, ['spotify:track:123']);

      expect(mockApi.player.startResumePlayback).toHaveBeenCalledWith(
        'device-id',
        undefined,
        ['spotify:track:123']
      );
    });

    it('should pause playback', async () => {
      mockApi.player.pausePlayback.mockResolvedValue(undefined);

      await client.pause('device-id');

      expect(mockApi.player.pausePlayback).toHaveBeenCalledWith('device-id');
    });

    it('should skip to next track', async () => {
      mockApi.player.skipToNext.mockResolvedValue(undefined);

      await client.next('device-id');

      expect(mockApi.player.skipToNext).toHaveBeenCalledWith('device-id');
    });

    it('should skip to previous track', async () => {
      mockApi.player.skipToPrevious.mockResolvedValue(undefined);

      await client.previous('device-id');

      expect(mockApi.player.skipToPrevious).toHaveBeenCalledWith('device-id');
    });

    it('should set volume', async () => {
      mockApi.player.setPlaybackVolume.mockResolvedValue(undefined);

      await client.setVolume(75, 'device-id');

      expect(mockApi.player.setPlaybackVolume).toHaveBeenCalledWith(75, 'device-id');
    });
  });

  describe('Playback State', () => {
    beforeEach(() => {
      mockTokenManager.ensureValid.mockResolvedValue({
        success: true,
        tokens: {
          accessToken: 'test-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + 3600000,
          scopes: [],
        },
        shouldReauth: false,
      });

      mockTokenManager.getConfig.mockReturnValue({
        clientId: 'client-id',
        clientSecret: 'secret',
        redirectUri: 'http://localhost:8888/callback',
      });

      mockTokenManager.getAccessToken.mockReturnValue('test-token');
    });

    it('should get current playback state', async () => {
      const mockState = {
        is_playing: true,
        item: {
          id: 'track-id',
          name: 'Track Name',
          artists: [{ name: 'Artist' }],
        },
        progress_ms: 30000,
      };

      mockApi.player.getPlaybackState.mockResolvedValue(mockState);

      const state = await client.getCurrentPlayback();

      expect(state).toEqual(mockState);
    });

    it('should handle null playback state', async () => {
      mockApi.player.getPlaybackState.mockResolvedValue(null);

      const state = await client.getCurrentPlayback();

      expect(state).toBeNull();
    });
  });
});
