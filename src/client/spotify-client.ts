/**
 * Spotify Web API client wrapper with bulletproof error handling
 */

import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import { TokenManager } from '../auth/token-manager.js';
import { withRetry } from './retry-handler.js';

export class SpotifyClient {
  private api: SpotifyApi | null = null;

  constructor(private tokenManager: TokenManager) {}

  /**
   * Get or create Spotify API instance
   */
  private async getApi(): Promise<SpotifyApi> {
    // Ensure token is valid
    const result = await this.tokenManager.ensureValid();
    if (!result.success) {
      throw new Error(result.error?.suggestedAction || 'Authentication required');
    }

    const config = this.tokenManager.getConfig();
    const accessToken = this.tokenManager.getAccessToken();

    if (!config || !accessToken) {
      throw new Error('Not authenticated');
    }

    // Create API instance with current token
    this.api = SpotifyApi.withAccessToken(config.clientId, {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: result.tokens!.refreshToken,
    });

    return this.api;
  }

  /**
   * Search for tracks
   */
  async searchTracks(query: string, limit: number = 10) {
    return withRetry(async () => {
      const api = await this.getApi();
      // Spotify SDK has strict limit types, constrain to valid values
      const validLimit = Math.min(Math.max(limit, 1), 50) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 50;
      const results = await api.search(query, ['track'], undefined, validLimit);
      return results.tracks.items;
    }, undefined, `search tracks: ${query}`);
  }

  /**
   * Get available devices
   */
  async getDevices() {
    return withRetry(async () => {
      const api = await this.getApi();
      const devices = await api.player.getAvailableDevices();
      return devices.devices;
    }, undefined, 'get devices');
  }

  /**
   * Transfer playback to a device
   */
  async transferPlayback(deviceId: string, play: boolean = false) {
    return withRetry(async () => {
      const api = await this.getApi();
      await api.player.transferPlayback([deviceId], play);
    }, undefined, `transfer playback to ${deviceId}`);
  }

  /**
   * Start/resume playback
   */
  async play(deviceId?: string, contextUri?: string, uris?: string[]) {
    return withRetry(async () => {
      const api = await this.getApi();
      if (deviceId) {
        await api.player.startResumePlayback(deviceId, contextUri, uris);
      } else {
        // Use any active device
        await api.player.startResumePlayback(undefined as any, contextUri, uris);
      }
    }, undefined, 'start playback');
  }

  /**
   * Pause playback
   */
  async pause(deviceId?: string) {
    return withRetry(async () => {
      const api = await this.getApi();
      if (deviceId) {
        await api.player.pausePlayback(deviceId);
      } else {
        await api.player.pausePlayback(undefined as any);
      }
    }, undefined, 'pause playback');
  }

  /**
   * Skip to next track
   */
  async next(deviceId?: string) {
    return withRetry(async () => {
      const api = await this.getApi();
      if (deviceId) {
        await api.player.skipToNext(deviceId);
      } else {
        await api.player.skipToNext(undefined as any);
      }
    }, undefined, 'skip to next');
  }

  /**
   * Skip to previous track
   */
  async previous(deviceId?: string) {
    return withRetry(async () => {
      const api = await this.getApi();
      if (deviceId) {
        await api.player.skipToPrevious(deviceId);
      } else {
        await api.player.skipToPrevious(undefined as any);
      }
    }, undefined, 'skip to previous');
  }

  /**
   * Get current playback state
   */
  async getCurrentPlayback() {
    return withRetry(async () => {
      const api = await this.getApi();
      return await api.player.getPlaybackState();
    }, undefined, 'get current playback');
  }

  /**
   * Set volume
   */
  async setVolume(volumePercent: number, deviceId?: string) {
    return withRetry(async () => {
      const api = await this.getApi();
      await api.player.setPlaybackVolume(volumePercent, deviceId);
    }, undefined, `set volume to ${volumePercent}%`);
  }

  /**
   * Set shuffle mode
   */
  async setShuffle(state: boolean, deviceId?: string) {
    return withRetry(async () => {
      const api = await this.getApi();
      await api.player.togglePlaybackShuffle(state, deviceId);
    }, undefined, `set shuffle ${state}`);
  }

  /**
   * Set repeat mode
   */
  async setRepeat(state: 'track' | 'context' | 'off', deviceId?: string) {
    return withRetry(async () => {
      const api = await this.getApi();
      await api.player.setRepeatMode(state, deviceId);
    }, undefined, `set repeat ${state}`);
  }
}
