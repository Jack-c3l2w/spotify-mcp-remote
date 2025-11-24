/**
 * Configuration and credential types
 */

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
  scopes: string[];
}

export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface StoredCredentials extends SpotifyConfig, TokenSet {}

export const REQUIRED_SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-library-read',
  'user-library-modify',
  'user-read-recently-played',
] as const;

export const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:8888/callback';
export const DEFAULT_CONFIG_DIR = '.spotify-mcp';
export const CREDENTIALS_FILE = 'credentials.json';
