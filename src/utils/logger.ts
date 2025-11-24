/**
 * Structured logging with pino
 */

import pino from 'pino';

const logLevel = process.env.SPOTIFY_LOG_LEVEL || 'info';

export const logger = pino(
  {
    name: 'spotify-mcp-server',
    level: logLevel,
    transport:
      process.env.NODE_ENV !== 'production'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
  },
  // CRITICAL: MCP servers MUST write logs to stderr, not stdout
  // stdout is reserved for JSON-RPC messages
  pino.destination({ dest: 2 }) // fd 2 = stderr
);

export default logger;
