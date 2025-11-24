#!/usr/bin/env node

/**
 * Spotify MCP Server
 * Entry point for Model Context Protocol server
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { CredentialStore } from './auth/credential-store.js';
import { TokenManager } from './auth/token-manager.js';
import { SpotifyClient } from './client/spotify-client.js';
import { logger } from './utils/logger.js';

async function main() {
  // Initialize credential store and token manager
  const credentialStore = new CredentialStore();
  const tokenManager = new TokenManager(credentialStore);
  const spotifyClient = new SpotifyClient(tokenManager);

  try {
    await tokenManager.initialize();

    if (!tokenManager.isConfigured()) {
      logger.warn('Starting without credentials - authentication tools available');
    } else {
      logger.info('Token manager initialized successfully');
    }
  } catch (error) {
    logger.error({ error }, 'Failed to initialize token manager');
    // Continue anyway - let tools handle auth errors gracefully
  }

  // Create MCP server
  const server = new Server(
    {
      name: 'spotify-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const isAuthenticated = tokenManager.isConfigured();
    logger.debug({ isAuthenticated }, 'ListTools request - auth status');

    return {
      tools: [
        {
          name: 'spotify_health_check',
          description: 'Check if the Spotify MCP server is authenticated and operational',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'spotify_get_auth_status',
          description:
            'Get authentication status and instructions for setting up Spotify credentials',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        ...(!isAuthenticated
          ? [
              {
                name: 'spotify_setup_instructions',
                description:
                  'Get detailed setup instructions for authenticating the Spotify MCP server',
                inputSchema: {
                  type: 'object',
                  properties: {},
                },
              },
            ]
          : []),
        // Spotify API tools (only if authenticated)
        ...(isAuthenticated
          ? [
              {
                name: 'spotify_search',
                description: 'Search for tracks, artists, albums, or playlists on Spotify',
                inputSchema: {
                  type: 'object',
                  properties: {
                    query: {
                      type: 'string',
                      description: 'Search query (track name, artist, album, etc.)',
                    },
                    limit: {
                      type: 'number',
                      description: 'Maximum number of results (default: 10, max: 50)',
                      minimum: 1,
                      maximum: 50,
                    },
                  },
                  required: ['query'],
                },
              },
              {
                name: 'spotify_get_devices',
                description: 'Get list of available Spotify playback devices',
                inputSchema: {
                  type: 'object',
                  properties: {},
                },
              },
              {
                name: 'spotify_play',
                description: 'Start or resume playback on a device',
                inputSchema: {
                  type: 'object',
                  properties: {
                    device_id: {
                      type: 'string',
                      description: 'Device ID to play on (optional, uses active device if not specified)',
                    },
                    track_uris: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Spotify track URIs to play (e.g., ["spotify:track:..."])',
                    },
                    context_uri: {
                      type: 'string',
                      description: 'Spotify URI of album/playlist/artist to play',
                    },
                  },
                },
              },
              {
                name: 'spotify_pause',
                description: 'Pause playback',
                inputSchema: {
                  type: 'object',
                  properties: {
                    device_id: {
                      type: 'string',
                      description: 'Device ID (optional)',
                    },
                  },
                },
              },
              {
                name: 'spotify_next',
                description: 'Skip to next track',
                inputSchema: {
                  type: 'object',
                  properties: {
                    device_id: {
                      type: 'string',
                      description: 'Device ID (optional)',
                    },
                  },
                },
              },
              {
                name: 'spotify_previous',
                description: 'Skip to previous track',
                inputSchema: {
                  type: 'object',
                  properties: {
                    device_id: {
                      type: 'string',
                      description: 'Device ID (optional)',
                    },
                  },
                },
              },
              {
                name: 'spotify_current_playback',
                description: 'Get current playback state (track, device, position, etc.)',
                inputSchema: {
                  type: 'object',
                  properties: {},
                },
              },
              {
                name: 'spotify_set_volume',
                description: 'Set playback volume (0-100)',
                inputSchema: {
                  type: 'object',
                  properties: {
                    volume: {
                      type: 'number',
                      description: 'Volume percentage (0-100)',
                      minimum: 0,
                      maximum: 100,
                    },
                    device_id: {
                      type: 'string',
                      description: 'Device ID (optional)',
                    },
                  },
                  required: ['volume'],
                },
              },
            ]
          : []),
      ],
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;

    if (name === 'spotify_health_check') {
      if (!tokenManager.isConfigured()) {
        return {
          content: [
            {
              type: 'text',
              text:
                '❌ Not authenticated\n\n' +
                'To authenticate, use one of these methods:\n\n' +
                '1. **Interactive Setup** (Recommended):\n' +
                '   ```bash\n' +
                '   npm install -g @thebigredgeek/spotify-mcp-server\n' +
                '   spotify-mcp-server auth\n' +
                '   ```\n\n' +
                '2. **Environment Variables**:\n' +
                '   Set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN\n' +
                '   See: https://github.com/thebigredgeek/spotify-mcp-server/blob/main/docs/CLAUDE_CLI_SETUP.md\n\n' +
                '3. **Get detailed instructions**:\n' +
                '   Ask me: "How do I set up Spotify authentication?"',
            },
          ],
        };
      }

      // Ensure token is valid
      const result = await tokenManager.ensureValid();

      if (!result.success) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Authentication failed: ${result.error?.suggestedAction}\n\nPlease re-authenticate: spotify-mcp-server auth`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: '✅ Spotify MCP Server is authenticated and operational!',
          },
        ],
      };
    }

    if (name === 'spotify_get_auth_status') {
      const isAuthenticated = tokenManager.isConfigured();

      if (isAuthenticated) {
        return {
          content: [
            {
              type: 'text',
              text:
                '✅ **Authenticated**\n\n' +
                'The Spotify MCP server is properly authenticated and ready to use.\n\n' +
                'You can now use Spotify playback, search, and library management tools.',
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text:
              '❌ **Not Authenticated**\n\n' +
              'The Spotify MCP server needs to be authenticated before use.\n\n' +
              '**Quick Setup:**\n' +
              '1. Install: `npm install -g @thebigredgeek/spotify-mcp-server`\n' +
              '2. Authenticate: `spotify-mcp-server auth`\n' +
              '3. Restart Claude Code\n\n' +
              'For detailed instructions, ask: "How do I set up Spotify authentication?"',
          },
        ],
      };
    }

    if (name === 'spotify_setup_instructions') {
      return {
        content: [
          {
            type: 'text',
            text:
              '# Spotify MCP Server Setup\n\n' +
              '## Method 1: Interactive Authentication (Recommended)\n\n' +
              '### Step 1: Create Spotify App\n' +
              '1. Go to https://developer.spotify.com/dashboard\n' +
              '2. Click "Create app"\n' +
              '3. Fill in:\n' +
              '   - App name: "My Spotify MCP Server"\n' +
              '   - Redirect URI: `http://127.0.0.1:8888/callback`\n' +
              '4. Save your **Client ID** and **Client Secret**\n\n' +
              '### Step 2: Install & Authenticate\n' +
              '```bash\n' +
              '# Install globally\n' +
              'npm install -g @thebigredgeek/spotify-mcp-server\n\n' +
              '# Run authentication\n' +
              'spotify-mcp-server auth\n' +
              '```\n\n' +
              'The auth script will:\n' +
              '- Prompt for your Client ID and Secret\n' +
              '- Open your browser for authorization\n' +
              '- Save credentials to `~/.spotify-mcp/credentials.json`\n\n' +
              '### Step 3: Configure Claude Code\n' +
              'Edit `~/.claude/settings.local.json`:\n' +
              '```json\n' +
              '{\n' +
              '  "mcpServers": {\n' +
              '    "spotify": {\n' +
              '      "type": "stdio",\n' +
              '      "command": "spotify-mcp-server"\n' +
              '    }\n' +
              '  }\n' +
              '}\n' +
              '```\n\n' +
              '### Step 4: Restart Claude Code\n' +
              'Fully quit and restart Claude Code to load the MCP server.\n\n' +
              '---\n\n' +
              '## Method 2: Environment Variables\n\n' +
              'For advanced users or team setups, see:\n' +
              'https://github.com/thebigredgeek/spotify-mcp-server/blob/main/docs/CLAUDE_CLI_SETUP.md\n\n' +
              '---\n\n' +
              '## Verification\n\n' +
              'After setup, ask me: "Check Spotify health" to verify everything works!',
          },
        ],
      };
    }

    // Spotify API tools
    if (name === 'spotify_search') {
      try {
        const { query, limit = 10 } = request.params.arguments as { query: string; limit?: number };
        const tracks = await spotifyClient.searchTracks(query, limit);

        const results = tracks.map((track) => ({
          name: track.name,
          artist: track.artists.map((a) => a.name).join(', '),
          album: track.album.name,
          uri: track.uri,
          duration_ms: track.duration_ms,
          preview_url: track.preview_url,
        }));

        return {
          content: [
            {
              type: 'text',
              text: `Found ${results.length} tracks:\n\n` +
                    results.map((t, i) =>
                      `${i + 1}. **${t.name}** by ${t.artist}\n` +
                      `   Album: ${t.album}\n` +
                      `   URI: \`${t.uri}\`\n` +
                      `   Duration: ${Math.floor(t.duration_ms / 1000 / 60)}:${String(Math.floor((t.duration_ms / 1000) % 60)).padStart(2, '0')}`
                    ).join('\n\n'),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `❌ Search failed: ${error.message}` }],
          isError: true,
        };
      }
    }

    if (name === 'spotify_get_devices') {
      try {
        const devices = await spotifyClient.getDevices();

        if (devices.length === 0) {
          return {
            content: [{
              type: 'text',
              text: '❌ No devices found. Make sure Spotify is running on at least one device.'
            }],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: `Found ${devices.length} device(s):\n\n` +
                    devices.map((d) =>
                      `${d.is_active ? '🔊' : '🔇'} **${d.name}**\n` +
                      `   Type: ${d.type}\n` +
                      `   ID: \`${d.id}\`\n` +
                      `   Volume: ${d.volume_percent}%\n` +
                      `   ${d.is_active ? '(Currently active)' : ''}`
                    ).join('\n\n'),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `❌ Failed to get devices: ${error.message}` }],
          isError: true,
        };
      }
    }

    if (name === 'spotify_play') {
      try {
        const { device_id, track_uris, context_uri } = request.params.arguments as {
          device_id?: string;
          track_uris?: string[];
          context_uri?: string;
        };

        await spotifyClient.play(device_id, context_uri, track_uris);

        return {
          content: [{
            type: 'text',
            text: '▶️ Playback started!'
          }],
        };
      } catch (error: any) {
        // Spotify returns 204 No Content for successful play/pause, which SDK may parse as JSON error
        // Check if it's a JSON parse error - if so, treat as success
        if (error.message?.includes('JSON') || error.message?.includes('parse')) {
          return {
            content: [{
              type: 'text',
              text: '▶️ Playback started!'
            }],
          };
        }
        return {
          content: [{ type: 'text', text: `❌ Playback failed: ${error.message}` }],
          isError: true,
        };
      }
    }

    if (name === 'spotify_pause') {
      try {
        const { device_id } = request.params.arguments as { device_id?: string };
        await spotifyClient.pause(device_id);

        return {
          content: [{
            type: 'text',
            text: '⏸️ Playback paused'
          }],
        };
      } catch (error: any) {
        // Treat JSON parse errors as success (204 No Content response)
        if (error.message?.includes('JSON') || error.message?.includes('parse')) {
          return {
            content: [{
              type: 'text',
              text: '⏸️ Playback paused'
            }],
          };
        }
        return {
          content: [{ type: 'text', text: `❌ Pause failed: ${error.message}` }],
          isError: true,
        };
      }
    }

    if (name === 'spotify_next') {
      try {
        const { device_id } = request.params.arguments as { device_id?: string };
        await spotifyClient.next(device_id);

        return {
          content: [{
            type: 'text',
            text: '⏭️ Skipped to next track'
          }],
        };
      } catch (error: any) {
        // Treat JSON parse errors as success (204 No Content response)
        if (error.message?.includes('JSON') || error.message?.includes('parse')) {
          return {
            content: [{
              type: 'text',
              text: '⏭️ Skipped to next track'
            }],
          };
        }
        return {
          content: [{ type: 'text', text: `❌ Skip failed: ${error.message}` }],
          isError: true,
        };
      }
    }

    if (name === 'spotify_previous') {
      try {
        const { device_id } = request.params.arguments as { device_id?: string };
        await spotifyClient.previous(device_id);

        return {
          content: [{
            type: 'text',
            text: '⏮️ Skipped to previous track'
          }],
        };
      } catch (error: any) {
        // Treat JSON parse errors as success (204 No Content response)
        if (error.message?.includes('JSON') || error.message?.includes('parse')) {
          return {
            content: [{
              type: 'text',
              text: '⏮️ Skipped to previous track'
            }],
          };
        }
        return {
          content: [{ type: 'text', text: `❌ Skip failed: ${error.message}` }],
          isError: true,
        };
      }
    }

    if (name === 'spotify_current_playback') {
      try {
        const playback = await spotifyClient.getCurrentPlayback();

        if (!playback || !playback.item) {
          return {
            content: [{
              type: 'text',
              text: '🔇 No playback currently active'
            }],
          };
        }

        const track = playback.item as any;
        const progress = Math.floor(playback.progress_ms / 1000);
        const duration = Math.floor(track.duration_ms / 1000);

        return {
          content: [{
            type: 'text',
            text:
              `${playback.is_playing ? '▶️' : '⏸️'} **${track.name}**\n` +
              `Artist: ${track.artists.map((a: any) => a.name).join(', ')}\n` +
              `Album: ${track.album.name}\n` +
              `Device: ${playback.device.name} (${playback.device.type})\n` +
              `Progress: ${Math.floor(progress / 60)}:${String(progress % 60).padStart(2, '0')} / ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}\n` +
              `Volume: ${playback.device.volume_percent}%\n` +
              `Shuffle: ${playback.shuffle_state ? 'On' : 'Off'}\n` +
              `Repeat: ${playback.repeat_state}`
          }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `❌ Failed to get playback: ${error.message}` }],
          isError: true,
        };
      }
    }

    if (name === 'spotify_set_volume') {
      try {
        const { volume, device_id } = request.params.arguments as {
          volume: number;
          device_id?: string;
        };

        await spotifyClient.setVolume(volume, device_id);

        return {
          content: [{
            type: 'text',
            text: `🔊 Volume set to ${volume}%`
          }],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `❌ Volume change failed: ${error.message}` }],
          isError: true,
        };
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: `Unknown tool: ${name}`,
        },
      ],
      isError: true,
    };
  });

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('Spotify MCP server started');
}

main().catch((error) => {
  logger.error({ error }, 'Fatal error');
  process.exit(1);
});
