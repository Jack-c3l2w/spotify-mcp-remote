#!/usr/bin/env node

/**
 * One-time authentication setup script
 * Usage: npm run auth
 */

import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { CredentialStore } from '../auth/credential-store.js';
import { authorizeWithSpotify } from '../auth/oauth-flow.js';
import { SpotifyConfig, DEFAULT_REDIRECT_URI } from '../types/config.js';
import { logger } from '../utils/logger.js';

async function main() {
  console.log('\n🎵 Spotify MCP Server - Authentication Setup\n');

  const rl = readline.createInterface({ input, output });

  try {
    // Check if already authenticated
    const store = new CredentialStore();
    const existing = await store.load();

    if (existing) {
      console.log('⚠️  Existing credentials found.\n');
      const overwrite = await rl.question('Do you want to re-authenticate? (y/N): ');
      if (!overwrite.toLowerCase().startsWith('y')) {
        console.log('\n✅ Keeping existing credentials.');
        process.exit(0);
      }
    }

    // Get Spotify app credentials
    console.log('\n📝 To get started, create a Spotify app at:');
    console.log('   https://developer.spotify.com/dashboard\n');

    const clientId = await rl.question('Enter your Client ID: ');
    if (!clientId.trim()) {
      console.error('❌ Client ID is required');
      process.exit(1);
    }

    const clientSecret = await rl.question('Enter your Client Secret: ');
    if (!clientSecret.trim()) {
      console.error('❌ Client Secret is required');
      process.exit(1);
    }

    const customRedirect = await rl.question(
      `Redirect URI (default: ${DEFAULT_REDIRECT_URI}): `
    );
    const redirectUri = customRedirect.trim() || DEFAULT_REDIRECT_URI;

    const config: SpotifyConfig = {
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      redirectUri,
    };

    console.log('\n🌐 Starting OAuth flow...');
    console.log('📋 Make sure you added this redirect URI to your Spotify app settings:');
    console.log(`   ${redirectUri}\n`);

    // Start OAuth flow
    const result = await authorizeWithSpotify(config);

    if (!result.success) {
      console.error(`\n❌ Authentication failed: ${result.error}`);
      process.exit(1);
    }

    // Save credentials
    await store.save(result.credentials!);

    console.log('\n✅ Authentication successful!');
    console.log(`📁 Credentials saved to: ${store['configPath']}`);
    console.log('\n🎉 You can now use the Spotify MCP server!\n');

    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Authentication failed');
    console.error('\n❌ Authentication failed:', error);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
