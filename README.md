# Spotify MCP Server

Production-ready Model Context Protocol (MCP) server for Spotify with bulletproof error handling and token management.

## Features

- 🔐 **One-time OAuth authentication** - Authenticate once, use forever (like spotifyd)
- 🛡️ **Bulletproof error handling** - Never invalidates tokens on transient failures
- 🔄 **Automatic token refresh** - Seamless refresh with concurrent request deduplication
- 💾 **Atomic credential storage** - Prevents corruption on process crash
- ⚡ **Smart retry logic** - Exponential backoff with rate limit handling
- 🎯 **Conservative token management** - Only clears credentials when provably invalid

## Example Usage

Once set up, you can control Spotify using natural language prompts with Claude:

### 🎵 Search & Discovery
```
"Search for AC/DC songs"
"Find albums by The Beatles"
"Search for rock playlists"
"Find tech podcasts"
"Search for The Beatles - show me tracks, albums, and playlists"
```

### ▶️ Playback Control
```
"Play Back in Black by AC/DC"
"Play the album Highway to Hell"
"Play my Discover Weekly playlist"
"Pause the music"
"Skip to the next song"
"Go back to the previous track"
"What's currently playing?"
```

### 🎚️ Advanced Controls
```
"Set volume to 50%"
"Turn on shuffle"
"Enable repeat"
"Set repeat to one song only"
"Turn off repeat"
```

### 📱 Device Management
```
"Show my Spotify devices"
"Switch playback to my phone"
"Transfer playback to my speaker"
```

All these operations work seamlessly with automatic token refresh, rate limiting, and error recovery.

## Remote HTTP deployment (this fork)

This fork adds a Streamable HTTP transport alongside the original stdio mode, so the
server can run on a remote host and be used by clients that connect over the internet
(e.g. Poke). Original repo: [thebigredgeek/spotify-mcp-server](https://github.com/thebigredgeek/spotify-mcp-server).

- **Transport switch:** if `PORT` or `MCP_PORT` is set, the server listens over HTTP
  instead of stdio (`src/index.ts`, `main()`). `/mcp` accepts POST (stateless — a fresh
  `Server` + transport per request); GET/DELETE return 405 per the stateless pattern.
  `/health` is unauthenticated, for container healthchecks.
- **Auth:** every `/mcp` request needs `Authorization: Bearer $MCP_AUTH_TOKEN`
  (constant-time compare). No token env var set ⇒ the process refuses to start in HTTP mode.
- **Accept-header normalization:** the MCP SDK's Streamable HTTP transport 406s any POST
  whose `Accept` header doesn't literally list both `application/json` and
  `text/event-stream`. Not every real-world client sends that (Poke didn't, and it
  surfaced there as a generic "Invalid MCP server URL" error). `normalizeAccept`
  middleware fills the header in server-side before it reaches the SDK's check.
- **Auth via env vars only:** `TokenManager.initialize()` in the original code already
  supported an env-var fallback (`SPOTIFY_CLIENT_ID`/`_CLIENT_SECRET`/`_ACCESS_TOKEN`/
  `_REFRESH_TOKEN`/`_EXPIRES_AT`/`_SCOPES`/`_REDIRECT_URI`) for headless deployments —
  no code changes needed there. Set `SPOTIFY_EXPIRES_AT=0` so the placeholder access
  token is never actually used; the server refreshes immediately on first request.
- **Getting a refresh token:** the interactive `npm run auth` CLI is broken against piped
  (non-TTY) stdin — `readline` throws `ERR_USE_AFTER_CLOSE` once stdin hits EOF between
  prompts. Run it in a real terminal, or call `authorizeWithSpotify()` /
  `CredentialStore` directly from a small script with client id/secret as env vars
  (skips readline entirely, still opens a real browser via the `open` package for the
  one-time consent screen).
- **Docker gotcha:** `npm ci` (with or without `--omit=dev`) runs the `prepare`
  lifecycle script (`tsc`), and in a multi-stage build source files aren't necessarily
  present yet when that fires — bare `tsc` then just prints `--help` and exits non-zero,
  failing the build. Use `--ignore-scripts` on every `npm ci` in the `Dockerfile`; the
  build stage calls `npm run build` explicitly afterward anyway.
- **Deploying:** built and run via the included `Dockerfile` (`ENV PORT=8000` default,
  overridden at runtime). No app code changes needed to deploy on most container
  platforms — set the env vars above plus `MCP_AUTH_TOKEN`, expose the port, done.

## Installation


### BEFORE:

You need to set up a Spotify developer app to get a client id and secret.  This will be used to authenticate the MCP server.

### Method 1: Prompt-Based Setup (Easiest)

Install via Claude CLI and let Claude guide you through setup:

```bash
# Install the MCP server
claude mcp add --transport stdio spotify -- npx -y @tbrgeek/spotify-mcp-server

# Restart Claude Code
# (Fully quit and reopen)
```

The server starts without credentials and provides setup instructions when you need them. Simply ask Claude:
- "Authenticate the spotify mcp server"

Claude will provide step-by-step setup instructions including:
1. Creating a Spotify app
2. Running the authentication script
3. Configuring credentials

See [Prompt-Based Setup Guide](#prompt-based-setup-guide) below for details.

### Method 2: Interactive Authentication (Stored Credentials)

For persistent credentials that survive restarts:

```bash
# Install globally
npm install -g @tbrgeek/spotify-mcp-server

# Run authentication
spotify-mcp-server auth

# Add to Claude Code config
claude mcp add --transport stdio spotify -- spotify-mcp-server
```

See **[Claude CLI Setup Guide](./docs/CLAUDE_CLI_SETUP.md)** for complete instructions.

### Method 3: Environment Variables (Advanced)

For shared configurations or CI/CD:

```bash
# Set environment variables (see docs/CLAUDE_CLI_SETUP.md)
export SPOTIFY_CLIENT_ID="your_client_id"
export SPOTIFY_CLIENT_SECRET="your_client_secret"
export SPOTIFY_REFRESH_TOKEN="your_refresh_token"
export SPOTIFY_ACCESS_TOKEN="your_access_token"

# Install with environment variables
claude mcp add --transport stdio spotify -- npx -y @tbrgeek/spotify-mcp-server
```

See **[Claude CLI Setup Guide](./docs/CLAUDE_CLI_SETUP.md)** for full environment variable setup.

### Local Development

```bash
git clone https://github.com/thebigredgeek/spotify-mcp-server.git
cd spotify-mcp-server
npm install
npm run build
npm link
```

## Setup

### 1. Create Spotify App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app
3. Note your **Client ID** and **Client Secret**
4. Add redirect URI: `http://127.0.0.1:8888/callback`

### 2. Authenticate

```bash
npm run auth
```

Follow the prompts to:
- Enter your Client ID and Client Secret
- Authorize in your browser
- Credentials are saved to `~/.spotify-mcp/credentials.json`

### 3. Configure MCP Client

#### Claude CLI / Claude Code (Recommended)

Edit `~/.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "spotify": {
      "type": "stdio",
      "command": "spotify-mcp-server"
    }
  }
}
```

Or use environment variables (see [Claude CLI Setup Guide](./docs/CLAUDE_CLI_SETUP.md)):

```json
{
  "mcpServers": {
    "spotify": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@tbrgeek/spotify-mcp-server"],
      "env": {
        "SPOTIFY_CLIENT_ID": "${SPOTIFY_CLIENT_ID}",
        "SPOTIFY_CLIENT_SECRET": "${SPOTIFY_CLIENT_SECRET}",
        "SPOTIFY_ACCESS_TOKEN": "${SPOTIFY_ACCESS_TOKEN}",
        "SPOTIFY_REFRESH_TOKEN": "${SPOTIFY_REFRESH_TOKEN}"
      }
    }
  }
}
```

#### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "spotify": {
      "command": "npx",
      "args": ["-y", "@tbrgeek/spotify-mcp-server"]
    }
  }
}
```

#### For local development:

```json
{
  "mcpServers": {
    "spotify": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/opensource/spotify-mcp-server/dist/index.js"]
    }
  }
}
```

## Prompt-Based Setup Guide

The easiest way to set up the Spotify MCP server is to install it first, then let Claude guide you through authentication.

### Step 1: Install the Server

```bash
# Install via Claude CLI
claude mcp add --transport stdio spotify -- npx -y @tbrgeek/spotify-mcp-server

# Restart Claude Code (fully quit and reopen)
```

### Step 2: Ask Claude for Setup Instructions

After restarting, ask Claude any of these questions:
- "How do I set up Spotify?"
- "Check Spotify health"
- "Get Spotify authentication status"

Claude will respond with detailed setup instructions, including:

**Creating a Spotify App:**
1. Go to https://developer.spotify.com/dashboard
2. Click "Create app"
3. Fill in app name and redirect URI: `http://127.0.0.1:8888/callback`
4. Save your Client ID and Client Secret

**Running Authentication:**
```bash
# Install globally
npm install -g @tbrgeek/spotify-mcp-server

# Run authentication
spotify-mcp-server auth
```

The auth script will:
- Prompt for your Client ID and Secret
- Open your browser for authorization
- Save credentials to `~/.spotify-mcp/credentials.json`

**Restart Claude Code** - credentials are now loaded automatically!

### Step 3: Verify

Ask Claude: "Check Spotify health"

You should see: ✅ Spotify MCP Server is authenticated and operational!

## Manual Configuration

If you prefer to edit configuration files directly, here's how:

### Option 1: Using Stored Credentials

1. **Run authentication** to generate credentials:
   ```bash
   npm install -g @tbrgeek/spotify-mcp-server
   spotify-mcp-server auth
   ```

2. **Edit Claude Code config** at `~/.claude/settings.local.json`:
   ```json
   {
     "mcpServers": {
       "spotify": {
         "type": "stdio",
         "command": "spotify-mcp-server"
       }
     }
   }
   ```

3. **Restart Claude Code** - credentials are loaded from `~/.spotify-mcp/credentials.json`

### Option 2: Using Environment Variables

1. **Get your credentials** (run authentication once to obtain refresh token):
   ```bash
   spotify-mcp-server auth
   cat ~/.spotify-mcp/credentials.json
   ```

2. **Set environment variables** in your shell profile (`~/.zshrc` or `~/.bashrc`):
   ```bash
   export SPOTIFY_CLIENT_ID="your_client_id_here"
   export SPOTIFY_CLIENT_SECRET="your_client_secret_here"
   export SPOTIFY_ACCESS_TOKEN="your_access_token_here"
   export SPOTIFY_REFRESH_TOKEN="your_refresh_token_here"
   ```

3. **Edit Claude Code config** at `~/.claude/settings.local.json`:
   ```json
   {
     "mcpServers": {
       "spotify": {
         "type": "stdio",
         "command": "npx",
         "args": ["-y", "@tbrgeek/spotify-mcp-server"],
         "env": {
           "SPOTIFY_CLIENT_ID": "${SPOTIFY_CLIENT_ID}",
           "SPOTIFY_CLIENT_SECRET": "${SPOTIFY_CLIENT_SECRET}",
           "SPOTIFY_ACCESS_TOKEN": "${SPOTIFY_ACCESS_TOKEN}",
           "SPOTIFY_REFRESH_TOKEN": "${SPOTIFY_REFRESH_TOKEN}"
         }
       }
     }
   }
   ```

4. **Reload your shell** and **restart Claude Code**:
   ```bash
   source ~/.zshrc  # or ~/.bashrc
   ```

### Locating Config Files

**Claude Code Config:**
```bash
~/.claude/settings.local.json  # User-specific (not version-controlled)
~/.claude/settings.json         # Global defaults
```

**Spotify Credentials:**
```bash
~/.spotify-mcp/credentials.json  # Stored credentials (from auth script)
```

**Editing Config:**
```bash
# macOS/Linux
code ~/.claude/settings.local.json
# or
vim ~/.claude/settings.local.json
```

**After editing any config:**
- Fully quit Claude Code (not just close window)
- Reopen Claude Code to load new configuration

## Architecture Highlights

### Error Handling

The server implements a sophisticated error classification system that **never** invalidates tokens unless absolutely necessary:

- ✅ **Never clears tokens for**: 500/502/503, 429 (rate limit), network errors, timeouts
- ✅ **Retries transient errors**: 403 errors (Spotify bug), network failures
- ✅ **Only clears tokens when**: Refresh token returns `invalid_grant`

### Token Management

- **Concurrent refresh deduplication**: Multiple simultaneous API calls trigger only one token refresh
- **Refresh token preservation**: Keeps existing refresh token if new one not returned (Spotify behavior)
- **5-minute expiry buffer**: Refreshes tokens before they expire
- **Atomic writes**: Credentials written to temp file, then atomically renamed

### Retry Logic

- **Exponential backoff**: 1s → 2s → 4s delays (configurable)
- **Rate limit handling**: Respects `Retry-After` headers
- **Smart retries**: Up to 3 attempts for transient failures

## Development

See [DEVELOPMENT.md](./DEVELOPMENT.md) for local testing, debugging, and publishing workflows.

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

### Lint

```bash
npm run lint
```

## Project Status

**Current Version**: Fully functional Spotify control with comprehensive search and playback capabilities

✅ **Implemented Features:**
- Core infrastructure with bulletproof error handling and token management
- Comprehensive search (tracks, albums, playlists, podcasts)
- Full playback control (play, pause, next, previous, volume)
- Advanced playback features (shuffle, repeat modes, device management)
- Multi-device support with transfer capabilities
- Real-time playback state monitoring

🚀 **Future Enhancements:**
- User library management (saved tracks, albums, playlists)
- Playlist creation and editing
- Recently played tracks
- User top tracks and artists

## License

MIT - see [LICENSE](./LICENSE)

## Author

Andrew Rhyne <andrew.rhyne@shopify.com>
