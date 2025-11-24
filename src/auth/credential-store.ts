/**
 * Credential storage with atomic writes
 * Prevents corruption if process crashes during write
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { StoredCredentials, DEFAULT_CONFIG_DIR, CREDENTIALS_FILE } from '../types/config.js';
import { logger } from '../utils/logger.js';

export class CredentialStore {
  private configPath: string;
  private tempPath: string;

  constructor(configDir?: string) {
    const dir = configDir || path.join(os.homedir(), DEFAULT_CONFIG_DIR);
    this.configPath = path.join(dir, CREDENTIALS_FILE);
    this.tempPath = path.join(dir, `${CREDENTIALS_FILE}.tmp`);
  }

  /**
   * Ensure config directory exists with proper permissions
   */
  async ensureConfigDir(): Promise<void> {
    const dir = path.dirname(this.configPath);
    try {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    } catch (error) {
      logger.error({ dir, error }, 'Failed to create config directory');
      throw error;
    }
  }

  /**
   * Load credentials from disk
   */
  async load(): Promise<StoredCredentials | null> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      const credentials = JSON.parse(data) as StoredCredentials;
      logger.debug({ path: this.configPath }, 'Credentials loaded from disk');
      return credentials;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        logger.debug({ path: this.configPath }, 'Credentials file not found');
        return null;
      }
      logger.error({ path: this.configPath, error }, 'Failed to load credentials');
      throw error;
    }
  }

  /**
   * Atomic save - write to temp file, then rename
   * Prevents corruption if process crashes during write
   */
  async save(credentials: StoredCredentials): Promise<void> {
    await this.ensureConfigDir();

    const data = JSON.stringify(credentials, null, 2);

    try {
      // Write to temp file
      await fs.writeFile(this.tempPath, data, { mode: 0o600 });

      // Atomic rename (POSIX guarantees atomicity)
      await fs.rename(this.tempPath, this.configPath);

      logger.debug({ path: this.configPath }, 'Credentials saved to disk');
    } catch (error) {
      logger.error({ path: this.configPath, error }, 'Failed to save credentials');
      throw error;
    }
  }

  /**
   * Clear credentials from disk
   */
  async clear(): Promise<void> {
    try {
      await fs.unlink(this.configPath);
      logger.info({ path: this.configPath }, 'Credentials cleared from disk');
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.error({ path: this.configPath, error }, 'Failed to clear credentials');
        throw error;
      }
    }
  }

  /**
   * Check if credentials exist on disk
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }
}
