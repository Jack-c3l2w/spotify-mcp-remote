/**
 * Tests for atomic credential storage
 * CRITICAL: Ensures credentials are never corrupted on process crash
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { CredentialStore } from '../auth/credential-store.js';
import { StoredCredentials } from '../types/config.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('CredentialStore', () => {
  let store: CredentialStore;
  let testDir: string;

  beforeEach(async () => {
    // Create temp directory for tests
    testDir = path.join(os.tmpdir(), `spotify-mcp-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Override config path for testing
    store = new CredentialStore();
    (store as any).configDir = testDir;
    (store as any).configPath = path.join(testDir, 'credentials.json');
    (store as any).tempPath = path.join(testDir, 'credentials.json.tmp');
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('save', () => {
    it('should save credentials atomically', async () => {
      const credentials: StoredCredentials = {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'http://localhost:8888/callback',
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 3600000,
        scopes: ['user-read-playback-state'],
      };

      await store.save(credentials);

      // Verify file exists
      const configPath = (store as any).configPath;
      const exists = await fs.access(configPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      // Verify temp file was cleaned up
      const tempPath = (store as any).tempPath;
      const tempExists = await fs.access(tempPath).then(() => true).catch(() => false);
      expect(tempExists).toBe(false);

      // Verify file permissions (should be 0600)
      const stats = await fs.stat(configPath);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it('should overwrite existing credentials', async () => {
      const credentials1: StoredCredentials = {
        clientId: 'old-client-id',
        clientSecret: 'old-secret',
        redirectUri: 'http://localhost:8888/callback',
        accessToken: 'old-token',
        refreshToken: 'old-refresh',
        expiresAt: Date.now(),
        scopes: [],
      };

      const credentials2: StoredCredentials = {
        ...credentials1,
        accessToken: 'new-token',
        refreshToken: 'new-refresh',
      };

      await store.save(credentials1);
      await store.save(credentials2);

      const loaded = await store.load();
      expect(loaded?.accessToken).toBe('new-token');
      expect(loaded?.refreshToken).toBe('new-refresh');
    });
  });

  describe('load', () => {
    it('should load saved credentials', async () => {
      const credentials: StoredCredentials = {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'http://localhost:8888/callback',
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 3600000,
        scopes: ['user-read-playback-state', 'user-modify-playback-state'],
      };

      await store.save(credentials);
      const loaded = await store.load();

      expect(loaded).toEqual(credentials);
    });

    it('should return null when no credentials exist', async () => {
      const loaded = await store.load();
      expect(loaded).toBeNull();
    });

    it('should throw on corrupted file', async () => {
      const configPath = (store as any).configPath;

      // Write corrupted JSON
      await fs.writeFile(configPath, 'not valid json');

      await expect(store.load()).rejects.toThrow();
    });

    it('should load partial credentials without validation', async () => {
      const configPath = (store as any).configPath;

      // Write incomplete credentials (missing required field)
      const partial = {
        clientId: 'test',
        // Missing clientSecret
      };
      await fs.writeFile(configPath, JSON.stringify(partial));

      const loaded = await store.load();
      expect(loaded).toEqual(partial);
    });
  });

  describe('clear', () => {
    it('should delete credentials file', async () => {
      const credentials: StoredCredentials = {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'http://localhost:8888/callback',
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 3600000,
        scopes: [],
      };

      await store.save(credentials);
      await store.clear();

      const loaded = await store.load();
      expect(loaded).toBeNull();
    });

    it('should not throw if file does not exist', async () => {
      await expect(store.clear()).resolves.not.toThrow();
    });
  });

  describe('Atomic Write Guarantee', () => {
    it('should use atomic rename operation', async () => {
      const credentials: StoredCredentials = {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'http://localhost:8888/callback',
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 3600000,
        scopes: [],
      };

      // Spy on fs operations to verify atomic write
      const writeFileSpy = jest.spyOn(fs, 'writeFile');
      const renameSpy = jest.spyOn(fs, 'rename');

      await store.save(credentials);

      // Verify write to temp file, then atomic rename
      expect(writeFileSpy).toHaveBeenCalledWith(
        expect.stringContaining('.tmp'),
        expect.any(String),
        expect.objectContaining({ mode: 0o600 })
      );
      expect(renameSpy).toHaveBeenCalled();

      writeFileSpy.mockRestore();
      renameSpy.mockRestore();
    });
  });
});
