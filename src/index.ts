#!/usr/bin/env node

/**
 * Spotify MCP Server
 * Entry point for Model Context Protocol server
 */

import crypto from 'crypto';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { CredentialStore } from './auth/credential-store.js';
import { TokenManager } from './auth/token-manager.js';
import { SpotifyClient } from './client/spotify-client.js';
import { logger } from './utils/logger.js';

function createServer(tokenManager: TokenManager, spotifyClient: SpotifyClient): Server {
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
                description: 'Search for tracks, albums, playlists, or shows (podcasts) on Spotify',
                inputSchema: {
                  type: 'object',
                  properties: {
                    query: {
                      type: 'string',
                      description: 'Search query (track name, artist, album, playlist, etc.)',
                    },
                    types: {
                      type: 'array',
                      items: {
                        type: 'string',
                        enum: ['track', 'album', 'playlist', 'show'],
                      },
                      description: 'Types to search for (default: ["track", "album", "playlist"])',
                    },
                    limit: {
                      type: 'number',
                      description: 'Maximum number of results per type (default: 10, max: 10)',
                      minimum: 1,
                      maximum: 10,
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
              {
                name: 'spotify_get_playlists',
                description: "Get the user's own playlists (name, URI, id, track count)",
                inputSchema: {
                  type: 'object',
                  properties: {
                    limit: {
                      type: 'number',
                      description: 'Maximum number of playlists (default: 20, max: 50)',
                      minimum: 1,
                      maximum: 50,
                    },
                    offset: {
                      type: 'number',
                      description: 'Offset for pagination (default: 0)',
                      minimum: 0,
                    },
                  },
                },
              },
              {
                name: 'spotify_create_playlist',
                description: "Create a new playlist on the user's Spotify account",
                inputSchema: {
                  type: 'object',
                  properties: {
                    name: {
                      type: 'string',
                      description: 'Name of the playlist',
                    },
                    description: {
                      type: 'string',
                      description: 'Playlist description (optional)',
                    },
                    public: {
                      type: 'boolean',
                      description: 'Whether the playlist is public (default: false)',
                    },
                    track_uris: {
                      type: 'array',
                      items: { type: 'string' },
                      description:
                        'Spotify track URIs to add right away (optional, e.g. ["spotify:track:..."])',
                    },
                  },
                  required: ['name'],
                },
              },
              {
                name: 'spotify_add_tracks_to_playlist',
                description: 'Add tracks to an existing playlist',
                inputSchema: {
                  type: 'object',
                  properties: {
                    playlist_id: {
                      type: 'string',
                      description:
                        'Playlist ID, URI (spotify:playlist:...) or open.spotify.com URL',
                    },
                    track_uris: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Spotify track URIs to add (e.g. ["spotify:track:..."])',
                    },
                    position: {
                      type: 'number',
                      description: 'Position to insert at (optional, appends by default)',
                      minimum: 0,
                    },
                  },
                  required: ['playlist_id', 'track_uris'],
                },
              },
              {
                name: 'spotify_remove_tracks_from_playlist',
                description: 'Remove tracks from a playlist',
                inputSchema: {
                  type: 'object',
                  properties: {
                    playlist_id: {
                      type: 'string',
                      description:
                        'Playlist ID, URI (spotify:playlist:...) or open.spotify.com URL',
                    },
                    track_uris: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Spotify track URIs to remove',
                    },
                  },
                  required: ['playlist_id', 'track_uris'],
                },
              },
              {
                name: 'spotify_get_playlist_tracks',
                description: 'List the tracks in a playlist',
                inputSchema: {
                  type: 'object',
                  properties: {
                    playlist_id: {
                      type: 'string',
                      description:
                        'Playlist ID, URI (spotify:playlist:...) or open.spotify.com URL',
                    },
                    limit: {
                      type: 'number',
                      description: 'Maximum number of tracks (default: 50, max: 50)',
                      minimum: 1,
                      maximum: 50,
                    },
                    offset: {
                      type: 'number',
                      description: 'Offset for pagination (default: 0)',
                      minimum: 0,
                    },
                  },
                  required: ['playlist_id'],
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
        const { query, types = ['track', 'album', 'playlist'], limit = 10 } = request.params.arguments as {
          query: string;
          types?: ('track' | 'album' | 'playlist' | 'show')[];
          limit?: number;
        };

        const results = await spotifyClient.search(query, types, limit);
        let output = '';

        // Format tracks
        if (results.tracks && results.tracks.items.length > 0) {
          output += `## 🎵 Tracks (${results.tracks.items.length})\n\n`;
          results.tracks.items.forEach((track, i) => {
            output += `${i + 1}. **${track.name}** by ${track.artists.map((a) => a.name).join(', ')}\n`;
            output += `   Album: ${track.album.name}\n`;
            output += `   URI: \`${track.uri}\`\n`;
            output += `   Duration: ${Math.floor(track.duration_ms / 1000 / 60)}:${String(Math.floor((track.duration_ms / 1000) % 60)).padStart(2, '0')}\n\n`;
          });
        }

        // Format albums
        if (results.albums && results.albums.items.length > 0) {
          output += `## 💿 Albums (${results.albums.items.length})\n\n`;
          results.albums.items.forEach((album, i) => {
            output += `${i + 1}. **${album.name}** by ${album.artists.map((a) => a.name).join(', ')}\n`;
            output += `   Release: ${album.release_date}\n`;
            output += `   URI: \`${album.uri}\`\n`;
            output += `   Tracks: ${album.total_tracks}\n\n`;
          });
        }

        // Format playlists
        if (results.playlists && results.playlists.items.length > 0) {
          output += `## 📋 Playlists (${results.playlists.items.length})\n\n`;
          results.playlists.items.forEach((playlist, i) => {
            if (!playlist || !playlist.name) return; // Skip null playlists
            output += `${i + 1}. **${playlist.name}**${playlist.owner ? ` by ${playlist.owner.display_name}` : ''}\n`;
            output += `   URI: \`${playlist.uri}\`\n`;
            const playlistAny = playlist as any;
            // Feb 2026 migration renamed the playlist "tracks" field to "items"
            const trackRef = playlistAny.items ?? playlistAny.tracks;
            if (trackRef && trackRef.total) {
              output += `   Tracks: ${trackRef.total}\n`;
            }
            output += `\n`;
          });
        }

        // Format shows (podcasts)
        if (results.shows && results.shows.items.length > 0) {
          output += `## 🎙️ Podcasts (${results.shows.items.length})\n\n`;
          results.shows.items.forEach((show, i) => {
            output += `${i + 1}. **${show.name}** by ${show.publisher}\n`;
            output += `   URI: \`${show.uri}\`\n`;
            output += `   Episodes: ${show.total_episodes}\n\n`;
          });
        }

        if (!output) {
          output = '❌ No results found';
        }

        return {
          content: [{ type: 'text', text: output }],
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

    if (name === 'spotify_get_playlists') {
      try {
        const { limit = 20, offset = 0 } = (request.params.arguments || {}) as {
          limit?: number;
          offset?: number;
        };

        const page = await spotifyClient.getMyPlaylists(limit, offset);

        if (page.items.length === 0) {
          return {
            content: [{ type: 'text', text: '📋 No playlists found' }],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text:
                `Found ${page.items.length} playlist(s) (of ${page.total} total):\n\n` +
                page.items
                  .filter((p: any) => p && p.name)
                  .map(
                    (p: any, i: number) =>
                      `${i + 1 + offset}. **${p.name}**${p.owner ? ` by ${p.owner.display_name}` : ''}\n` +
                      `   URI: \`${p.uri}\`\n` +
                      `   ID: \`${p.id}\`\n` +
                      // Feb 2026 migration renamed the playlist "tracks" field to "items"
                      `   Tracks: ${(p.items ?? p.tracks)?.total ?? '?'}${p.public ? ' (public)' : ''}`
                  )
                  .join('\n\n'),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `❌ Failed to get playlists: ${error.message}` }],
          isError: true,
        };
      }
    }

    if (name === 'spotify_create_playlist') {
      try {
        const { name: playlistName, description, public: isPublic = false, track_uris } =
          request.params.arguments as {
            name: string;
            description?: string;
            public?: boolean;
            track_uris?: string[];
          };

        const playlist = await spotifyClient.createPlaylist(playlistName, description, isPublic);

        let addedNote = '';
        if (track_uris && track_uris.length > 0) {
          await spotifyClient.addTracksToPlaylist(playlist.id, track_uris);
          addedNote = `\nAdded ${track_uris.length} track(s)`;
        }

        return {
          content: [
            {
              type: 'text',
              text:
                `✅ Playlist **${playlist.name}** created!${addedNote}\n` +
                `URI: \`${playlist.uri}\`\n` +
                `ID: \`${playlist.id}\`\n` +
                `Link: ${playlist.external_urls?.spotify || ''}`,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `❌ Failed to create playlist: ${error.message}` }],
          isError: true,
        };
      }
    }

    if (name === 'spotify_add_tracks_to_playlist') {
      try {
        const { playlist_id, track_uris, position } = request.params.arguments as {
          playlist_id: string;
          track_uris: string[];
          position?: number;
        };

        await spotifyClient.addTracksToPlaylist(
          normalizePlaylistId(playlist_id),
          track_uris,
          position
        );

        return {
          content: [
            { type: 'text', text: `✅ Added ${track_uris.length} track(s) to the playlist` },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `❌ Failed to add tracks: ${error.message}` }],
          isError: true,
        };
      }
    }

    if (name === 'spotify_remove_tracks_from_playlist') {
      try {
        const { playlist_id, track_uris } = request.params.arguments as {
          playlist_id: string;
          track_uris: string[];
        };

        await spotifyClient.removeTracksFromPlaylist(normalizePlaylistId(playlist_id), track_uris);

        return {
          content: [
            { type: 'text', text: `✅ Removed ${track_uris.length} track(s) from the playlist` },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `❌ Failed to remove tracks: ${error.message}` }],
          isError: true,
        };
      }
    }

    if (name === 'spotify_get_playlist_tracks') {
      try {
        const { playlist_id, limit = 50, offset = 0 } = request.params.arguments as {
          playlist_id: string;
          limit?: number;
          offset?: number;
        };

        const page = await spotifyClient.getPlaylistTracks(
          normalizePlaylistId(playlist_id),
          limit,
          offset
        );

        if (page.items.length === 0) {
          return {
            content: [{ type: 'text', text: '📋 Playlist is empty' }],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text:
                `${page.items.length} track(s) (of ${page.total} total):\n\n` +
                page.items
                  // Feb 2026 migration renamed the playlist entry field "track" to "item"
                  .filter((entry: any) => entry && (entry.item || entry.track))
                  .map((entry: any, i: number) => {
                    const track = (entry.item ?? entry.track) as any;
                    return (
                      `${i + 1 + offset}. **${track.name}**` +
                      (track.artists ? ` by ${track.artists.map((a: any) => a.name).join(', ')}` : '') +
                      `\n   URI: \`${track.uri}\``
                    );
                  })
                  .join('\n\n'),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: 'text', text: `❌ Failed to get playlist tracks: ${error.message}` }],
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

  return server;
}

/**
 * Accept a playlist as a bare ID, a spotify:playlist:... URI, or an
 * open.spotify.com URL, and return the bare ID the API expects.
 */
function normalizePlaylistId(input: string): string {
  const uriMatch = input.match(/^spotify:playlist:([A-Za-z0-9]+)$/);
  if (uriMatch) return uriMatch[1];
  const urlMatch = input.match(/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/);
  if (urlMatch) return urlMatch[1];
  return input;
}

/** Constant-time comparison to avoid leaking the auth token via timing. */
function safeTokenEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function startHttpServer(
  tokenManager: TokenManager,
  spotifyClient: SpotifyClient,
  port: number
) {
  const authToken = process.env.MCP_AUTH_TOKEN;
  if (!authToken) {
    logger.error('MCP_AUTH_TOKEN must be set when running in HTTP mode');
    process.exit(1);
  }

  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Clients disagree on how to send the key: Poke's integration form has a bare
  // "API Key" field and doesn't document the header it ends up in. Accept the
  // token as `Authorization: Bearer <t>`, bare `Authorization: <t>`, or
  // `X-Api-Key: <t>`, and log header names (never values) on failure so we can
  // see what an incompatible client actually sent.
  const requireAuth = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const rawAuth = req.headers.authorization || '';
    const bearerValue = rawAuth.replace(/^Bearer\s+/i, '');
    const apiKeyHeader = req.headers['x-api-key'];
    const apiKeyValue = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader || '';

    const candidates = [rawAuth, bearerValue, apiKeyValue].filter(Boolean);
    if (candidates.some((c) => safeTokenEquals(c, authToken))) {
      next();
      return;
    }

    logger.warn(
      {
        headerNames: Object.keys(req.headers),
        authScheme: rawAuth ? rawAuth.split(' ')[0].slice(0, 20) : '(none)',
        authLength: rawAuth.length,
        hasApiKeyHeader: Boolean(apiKeyValue),
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
      },
      'Rejected MCP request: no valid auth token'
    );
    res.status(401).json({ error: 'Unauthorized' });
  };

  // The SDK's Streamable HTTP transport rejects POSTs whose Accept header doesn't
  // literally list both mime types (MCP spec requirement). Real-world clients
  // (Poke included) don't always send it, so normalize it here rather than 406
  // every client that isn't byte-for-byte spec-compliant.
  const normalizeAccept = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const accept = req.headers.accept || '';
    const hasJson = accept.includes('application/json');
    const hasEventStream = accept.includes('text/event-stream');
    if (!hasJson || !hasEventStream) {
      req.headers.accept = 'application/json, text/event-stream';
    }
    next();
  };

  app.post('/mcp', requireAuth, normalizeAccept, async (req, res) => {
    try {
      // Stateless mode: a fresh Server + transport per request, per the MCP SDK's
      // recommended pattern for deployments that don't pin a client to one process.
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on('close', () => {
        transport.close();
      });
      const server = createServer(tokenManager, spotifyClient);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error({ error }, 'Error handling MCP request');
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  const methodNotAllowed = (_req: express.Request, res: express.Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  };
  app.get('/mcp', requireAuth, methodNotAllowed);
  app.delete('/mcp', requireAuth, methodNotAllowed);

  app.listen(port, () => {
    logger.info({ port }, 'Spotify MCP server started (HTTP, streamable transport)');
  });
}

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

  const port = process.env.PORT || process.env.MCP_PORT;
  if (port) {
    await startHttpServer(tokenManager, spotifyClient, parseInt(port, 10));
  } else {
    const server = createServer(tokenManager, spotifyClient);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('Spotify MCP server started (stdio)');
  }
}

main().catch((error) => {
  logger.error({ error }, 'Fatal error');
  process.exit(1);
});
