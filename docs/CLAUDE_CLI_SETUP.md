# Claude CLI Setup Guide

Complete guide for installing and configuring the Spotify MCP Server with Claude Code CLI.

## Two Authentication Methods

### Method 1: Interactive Authentication (Recommended)

**Best for**: Local development, personal use, persistent credentials

1. **Install the package globally or link locally**:
   ```bash
   # Option A: Install from npm (when published)
   npm install -g @thebigredgeek/spotify-mcp-server

   # Option B: Install from local development
   cd ~/opensource/spotify-mcp-server
   npm install && npm run build && npm link
   ```

2. **Run authentication**:
   ```bash
   spotify-mcp-server auth
   # or: npm run auth
   ```

3. **Configure Claude CLI**:

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

4. **Restart Claude Code** - credentials are stored in `~/.spotify-mcp/credentials.json`

### Method 2: Environment Variables (Claude CLI Pattern)

**Best for**: Shared configurations, CI/CD, team settings

#### Step 1: Get Spotify Credentials

1. **Create Spotify App**:
   - Go to https://developer.spotify.com/dashboard
   - Create new app
   - Note your **Client ID** and **Client Secret**
   - Add redirect URI: `http://127.0.0.1:8888/callback`

2. **Get Initial Tokens** (one-time):

   You need to run the OAuth flow once to get your refresh token:

   ```bash
   # Temporary: use interactive auth to get tokens
   cd ~/opensource/spotify-mcp-server
   npm run auth

   # Extract tokens from the saved file
   cat ~/.spotify-mcp/credentials.json
   ```

   Copy the `refreshToken` value - you'll need this for environment variables.

#### Step 2: Set Environment Variables

Add to your shell profile (`~/.zshrc`, `~/.bashrc`, etc.):

```bash
# Spotify MCP Server Credentials
export SPOTIFY_CLIENT_ID="your_client_id_here"
export SPOTIFY_CLIENT_SECRET="your_client_secret_here"
export SPOTIFY_REFRESH_TOKEN="your_refresh_token_here"
export SPOTIFY_ACCESS_TOKEN="your_initial_access_token"  # Will auto-refresh

# Optional:
export SPOTIFY_REDIRECT_URI="http://127.0.0.1:8888/callback"
export SPOTIFY_EXPIRES_AT="$(date -v+1H +%s)000"  # Unix timestamp in ms
export SPOTIFY_SCOPES="user-read-playback-state,user-modify-playback-state,..."
```

**Reload your shell**:
```bash
source ~/.zshrc  # or ~/.bashrc
```

#### Step 3: Configure Claude CLI

Edit `~/.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "spotify": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@thebigredgeek/spotify-mcp-server"],
      "env": {
        "SPOTIFY_CLIENT_ID": "${SPOTIFY_CLIENT_ID}",
        "SPOTIFY_CLIENT_SECRET": "${SPOTIFY_CLIENT_SECRET}",
        "SPOTIFY_ACCESS_TOKEN": "${SPOTIFY_ACCESS_TOKEN}",
        "SPOTIFY_REFRESH_TOKEN": "${SPOTIFY_REFRESH_TOKEN}",
        "SPOTIFY_REDIRECT_URI": "${SPOTIFY_REDIRECT_URI}",
        "SPOTIFY_EXPIRES_AT": "${SPOTIFY_EXPIRES_AT}",
        "SPOTIFY_SCOPES": "${SPOTIFY_SCOPES}"
      }
    }
  }
}
```

#### Step 4: Install via Claude CLI

```bash
# Alternative: Use CLI command
claude mcp add --transport stdio spotify -- npx -y @thebigredgeek/spotify-mcp-server

# View installed servers
claude mcp list

# Check status
/mcp  # Within Claude Code
```

## Environment Variable Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `SPOTIFY_CLIENT_ID` | ✅ Yes | Your Spotify app client ID | `abc123...` |
| `SPOTIFY_CLIENT_SECRET` | ✅ Yes | Your Spotify app client secret | `xyz789...` |
| `SPOTIFY_ACCESS_TOKEN` | ✅ Yes | OAuth access token (will auto-refresh) | `BQC...` |
| `SPOTIFY_REFRESH_TOKEN` | ✅ Yes | OAuth refresh token (long-lived) | `AQD...` |
| `SPOTIFY_REDIRECT_URI` | ⚠️ Optional | OAuth redirect URI | `http://127.0.0.1:8888/callback` |
| `SPOTIFY_EXPIRES_AT` | ⚠️ Optional | Token expiry (Unix timestamp ms) | `1738543200000` |
| `SPOTIFY_SCOPES` | ⚠️ Optional | Comma-separated OAuth scopes | `user-read-playback-state,...` |

## Configuration Priority

The server checks credentials in this order:

1. **Stored credentials** (`~/.spotify-mcp/credentials.json`) - highest priority
2. **Environment variables** - fallback
3. **None** - displays error message

## Verification

After setup, verify the server is working:

1. **Check MCP server list**:
   ```bash
   claude mcp list
   ```

2. **Test within Claude Code**:
   ```
   /mcp
   ```

3. **Try a health check** (when tool is added):
   Ask Claude: "Check if Spotify MCP server is working"

## Troubleshooting

### "Not authenticated" Error

**Solution 1**: Run `spotify-mcp-server auth` (or `npm run auth`)

**Solution 2**: Verify environment variables are set:
```bash
echo $SPOTIFY_CLIENT_ID
echo $SPOTIFY_REFRESH_TOKEN
```

### Tokens Not Persisting

**Issue**: Using environment variables means tokens refresh in-memory only

**Solutions**:
- Use interactive authentication for persistence
- Set up token refresh script to update env vars
- Accept that tokens will refresh each session (refresh tokens are long-lived)

### "Refresh token invalid"

**Cause**: Refresh token expired or was revoked

**Solution**: Run authentication flow again:
```bash
spotify-mcp-server auth
```

### Windows-Specific Issues

On Windows, you may need `cmd /c` wrapper:

```json
{
  "mcpServers": {
    "spotify": {
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@thebigredgeek/spotify-mcp-server"],
      "env": { ... }
    }
  }
}
```

## Security Best Practices

1. **Never commit tokens to version control**
   ```bash
   # Add to .gitignore
   .spotify-mcp/
   ```

2. **Use environment variable expansion** in shared configs
   ```json
   "env": {
     "SPOTIFY_CLIENT_ID": "${SPOTIFY_CLIENT_ID}"
   }
   ```

3. **Rotate credentials periodically**
   - Refresh tokens don't expire but can be revoked
   - Re-run `npm run auth` to get new credentials

4. **Use `.claude/settings.local.json`** for personal configs (not version-controlled)

## Team Configuration

For shared team setups:

1. **Create project-level config** (`.mcp.json`):
   ```json
   {
     "mcpServers": {
       "spotify": {
         "type": "stdio",
         "command": "npx",
         "args": ["-y", "@thebigredgeek/spotify-mcp-server"],
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

2. **Document environment variables** in team README
3. **Each team member sets their own credentials** in their shell profile

## Advanced: Credential Management Script

Create `~/.spotify-mcp/refresh-env.sh`:

```bash
#!/bin/bash
# Extract credentials from stored file and update environment

CREDS_FILE=~/.spotify-mcp/credentials.json

if [ -f "$CREDS_FILE" ]; then
  export SPOTIFY_CLIENT_ID=$(jq -r '.clientId' "$CREDS_FILE")
  export SPOTIFY_CLIENT_SECRET=$(jq -r '.clientSecret' "$CREDS_FILE")
  export SPOTIFY_ACCESS_TOKEN=$(jq -r '.accessToken' "$CREDS_FILE")
  export SPOTIFY_REFRESH_TOKEN=$(jq -r '.refreshToken' "$CREDS_FILE")
  export SPOTIFY_EXPIRES_AT=$(jq -r '.expiresAt' "$CREDS_FILE")

  echo "✅ Spotify credentials loaded from $CREDS_FILE"
else
  echo "❌ Credentials file not found. Run: npm run auth"
  exit 1
fi
```

Then in your shell profile:
```bash
# Load Spotify credentials
source ~/.spotify-mcp/refresh-env.sh 2>/dev/null
```

## Next Steps

- Read [README.md](../README.md) for feature overview
- See [DEVELOPMENT.md](../DEVELOPMENT.md) for local testing
- Check [Architecture section](../README.md#architecture-highlights) for error handling details
