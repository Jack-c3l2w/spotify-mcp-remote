/**
 * OAuth 2.0 Authorization Code Flow with CSRF protection
 * Implements one-time authentication similar to spotifyd
 */

import http from 'http';
import { URL } from 'url';
import crypto from 'crypto';
import open from 'open';
import { SpotifyConfig, StoredCredentials, REQUIRED_SCOPES } from '../types/config.js';
import { logger } from '../utils/logger.js';

interface OAuthResult {
  success: boolean;
  credentials?: StoredCredentials;
  error?: string;
}

/**
 * Generate cryptographically secure random state token
 */
function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Start OAuth authorization flow
 */
export async function authorizeWithSpotify(config: SpotifyConfig): Promise<OAuthResult> {
  const state = generateState();
  let authCode: string | null = null;
  let authError: string | null = null;

  // Create authorization URL
  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.set('client_id', config.clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', config.redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', REQUIRED_SCOPES.join(' '));

  logger.info('Starting OAuth authorization flow');
  logger.info({ redirectUri: config.redirectUri }, 'Waiting for callback');

  // Create HTTP server to receive callback
  const server = await new Promise<http.Server>((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);

      // Only handle callback path
      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      // Handle authorization error
      if (error) {
        authError = error;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body>
              <h1>❌ Authorization Failed</h1>
              <p>Error: ${error}</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `);
        srv.close();
        return;
      }

      // Validate state (CSRF protection)
      if (returnedState !== state) {
        authError = 'State mismatch - possible CSRF attack';
        logger.error({ expected: state, received: returnedState }, 'CSRF state mismatch');
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body>
              <h1>❌ Authorization Failed</h1>
              <p>Security validation failed. Please try again.</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `);
        srv.close();
        return;
      }

      // Validate code
      if (!code) {
        authError = 'No authorization code received';
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body>
              <h1>❌ Authorization Failed</h1>
              <p>No authorization code received.</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `);
        srv.close();
        return;
      }

      // Success!
      authCode = code;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <body>
            <h1>✅ Authorization Successful!</h1>
            <p>You can close this window and return to your terminal.</p>
          </body>
        </html>
      `);
      srv.close();
    });

    // Extract port from redirect URI
    const redirectUrl = new URL(config.redirectUri);
    const port = parseInt(redirectUrl.port || '8888');

    srv.listen(port, () => {
      logger.info({ port }, 'Callback server listening');
      resolve(srv);
    });

    srv.on('error', (error) => {
      logger.error({ error }, 'Failed to start callback server');
      reject(error);
    });
  });

  // Open browser for authorization
  logger.info('Opening browser for authorization...');
  await open(authUrl.toString());

  // Wait for server to close (user authorized or error)
  await new Promise<void>((resolve) => {
    server.on('close', () => resolve());
  });

  // Handle authorization error
  if (authError) {
    return { success: false, error: authError };
  }

  if (!authCode) {
    return { success: false, error: 'No authorization code received' };
  }

  // Exchange authorization code for tokens
  logger.info('Exchanging authorization code for tokens...');
  try {
    const credentials = await exchangeCodeForTokens(config, authCode);
    return { success: true, credentials };
  } catch (error) {
    logger.error({ error }, 'Failed to exchange code for tokens');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Token exchange failed',
    };
  }
}

/**
 * Exchange authorization code for access and refresh tokens
 */
async function exchangeCodeForTokens(
  config: SpotifyConfig,
  code: string
): Promise<StoredCredentials> {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    logger.error({ status: response.status, errorData }, 'Token exchange failed');
    throw new Error(`Token exchange failed: ${response.status}`);
  }

  const data: any = await response.json();

  const credentials: StoredCredentials = {
    ...config,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scopes: data.scope.split(' '),
  };

  logger.info('Successfully obtained access and refresh tokens');
  return credentials;
}
