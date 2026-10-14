// src/lib/logger.ts

import pino from 'pino';

// Resolve the current environment.
// APP_ENV wins because NODE_ENV is often forced to 'production' on servers
const currentEnv = process.env.APP_ENV || process.env.NODE_ENV || 'development';

// True only on a developer's local machine
const isLocal = currentEnv === 'development' || currentEnv === 'local';

let fileTransport: pino.TransportTargetOptions | null = null;

// Write to a log file only when not running locally (stage or prod)
if (typeof window === 'undefined' && !isLocal) {
  const fs = require('fs');
  const path = require('path');
  const logFilePath = process.env.LOG_FILE_PATH || '/app/logs/lms.log';
  
  // Only attach the file transport if the log directory is actually usable.
  // Outside the Docker image the default `/app/logs` is unwritable (EROFS), and
  // this module is imported both by route modules that `next build` evaluates
  // and by the unit tests — neither may die because a log file can't be opened.
  // pino/file writes from a worker thread, so an unwritable destination surfaces
  // as an unhandled worker error rather than a catchable one; hence the check
  // here rather than a try/catch around the write.
  const dir = path.dirname(logFilePath);
  let logDirUsable = true;
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    logDirUsable = false;
  }

  if (logDirUsable) {
    fileTransport = {
      target: 'pino/file',
      options: { destination: logFilePath, mkdir: true },
    };
  }
}

const devTransport: pino.TransportTargetOptions = {
  target: 'pino-pretty',
  options: {
    colorize: true,
    ignore: 'pid,hostname',
    translateTime: 'SYS:standard',
  },
};

// Transports for servers (stage, production)
const serverTransports: pino.TransportTargetOptions[] = [
  {
    target: 'pino-loki',
    options: {
      batching: true,
      interval: 5,
      host: process.env.ALLOY_HOST || 'http://localhost:3101',
      // Resolves to 'stage', 'production' or 'test'
      labels: { app: 'lms-backend', env: `lms-${currentEnv}` },
    },
  }
];

if (fileTransport) {
  serverTransports.push(fileTransport);
}

export const logger = pino({
  level: process.env.LOG_LEVEL || (isLocal ? 'debug' : 'info'),
  ...(typeof window === 'undefined' && {
    transport: {
      // Pretty logs locally; Loki + file on servers (stage/prod)
      targets: isLocal ? [devTransport] : serverTransports,
    },
  }),
});