# Development Guide

## Local Testing Without Publishing

### Option 1: npm link (Recommended for active development)

```bash
# In the spotify-mcp-server directory
npm install
npm run build
npm link

# Now you can use it like a global package
spotify-mcp-server

# Or test with npx
npx spotify-mcp-server

# To test authentication
spotify-mcp-server auth
# or
node dist/scripts/authenticate.js
```

### Option 2: Direct path in MCP config

Add to your `~/.claude/settings.json` or Claude Desktop config:

```json
{
  "mcpServers": {
    "spotify": {
      "command": "node",
      "args": ["/Users/andrewrhyne/opensource/spotify-mcp-server/dist/index.js"]
    }
  }
}
```

### Option 3: npm install from local directory

```bash
# From another project or test directory
npm install /Users/andrewrhyne/opensource/spotify-mcp-server
```

### Option 4: npx with local path

```bash
npx /Users/andrewrhyne/opensource/spotify-mcp-server
```

## Testing Changes

1. Make code changes in `src/`
2. Rebuild: `npm run build`
3. Test via any of the above methods
4. Run unit tests: `npm test`

## Unlinking

When done testing:

```bash
npm unlink @thebigredgeek/spotify-mcp-server
```

## Publishing Workflow

```bash
# Before publishing
npm run build
npm test
npm run lint

# Update version
npm version patch  # or minor/major

# Publish
npm publish --access public
```

## MCP Server Configuration Examples

### For Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "spotify": {
      "command": "npx",
      "args": ["-y", "@thebigredgeek/spotify-mcp-server"]
    }
  }
}
```

### For Claude Code CLI

`~/.claude/settings.json` - Add to `alwaysApproveTools`:

```json
{
  "alwaysApproveTools": [
    "mcp__spotify__*"
  ]
}
```

### For Cursor IDE

`~/.cursor/config/mcp.json`:

```json
{
  "mcpServers": {
    "spotify": {
      "command": "npx",
      "args": ["-y", "@thebigredgeek/spotify-mcp-server"]
    }
  }
}
```

## Debugging

Run with debug logging:

```bash
DEBUG=spotify:* node dist/index.js
```

Or set environment variable:

```bash
export SPOTIFY_LOG_LEVEL=debug
spotify-mcp-server
```
