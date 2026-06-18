import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger as PackageLogger } from '@arc-mcp/xsuaa-auth';
import type { LogFormat, LogLevel } from './types.js';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const SENSITIVE_KEYS = /password|secret|token|authorization|credential|key|cookie/i;

function redact(obj: unknown, depth = 0): unknown {
  if (depth > 5 || obj === null || typeof obj !== 'object') return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.test(k) ? '***' : redact(v, depth + 1);
  }
  return out;
}

export interface LogContext {
  requestId?: string;
  user?: string;
}

export const requestContext = new AsyncLocalStorage<LogContext>();

export class Logger {
  constructor(
    private readonly format: LogFormat,
    private readonly minLevel: LogLevel,
  ) {}

  private emit(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVELS[level] < LEVELS[this.minLevel]) return;
    const ctx = requestContext.getStore();
    const ts = new Date().toISOString();

    if (this.format === 'json') {
      const entry = { ts, level, message, ...(ctx ?? {}), ...(data ? (redact(data) as object) : {}) };
      process.stderr.write(`${JSON.stringify(entry)}\n`);
    } else {
      const prefix = [ts, level.toUpperCase().padEnd(5), ctx?.requestId ? `[${ctx.requestId}]` : '']
        .filter(Boolean)
        .join(' ');
      const suffix = data ? ` ${JSON.stringify(redact(data))}` : '';
      process.stderr.write(`${prefix} ${message}${suffix}\n`);
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.emit('debug', message, data);
  }
  info(message: string, data?: Record<string, unknown>): void {
    this.emit('info', message, data);
  }
  warn(message: string, data?: Record<string, unknown>): void {
    this.emit('warn', message, data);
  }
  error(message: string, data?: Record<string, unknown>): void {
    this.emit('error', message, data);
  }

  /**
   * Emit a structured security/audit event. Mirrors arc-1's audit sink: the
   * entry carries its own `level` and `event`, and is written as a single
   * structured log line tagged `audit: true` so it can be filtered downstream.
   */
  emitAudit(entry: { level: LogLevel; event: string } & Record<string, unknown>): void {
    const { level, event, ...rest } = entry;
    this.emit(level, `audit:${event}`, { audit: true, event, ...rest });
  }
}

let _logger: Logger | undefined;

export function initLogger(format: LogFormat, level: LogLevel): Logger {
  _logger = new Logger(format, level);
  return _logger;
}

export function getLogger(): Logger {
  if (!_logger) throw new Error('Logger not initialised — call initLogger() first');
  return _logger;
}

/**
 * Adapt LISA's logger to the `@arc-mcp/xsuaa-auth` `Logger` contract so the
 * package's auth + BTP/principal-propagation diagnostics flow into LISA's log
 * stream (the package defaults to a silent no-op otherwise). The level methods
 * line up 1:1; `emitAudit` is normalised because the package emits a flat record
 * (`{ level, event, … }`) whereas LISA's `emitAudit` requires typed fields.
 *
 * Methods resolve `getLogger()` lazily on each call, so the adapter can be built
 * at module load (before `initLogger`) and still target the live logger.
 */
export function toPackageLogger(): PackageLogger {
  return {
    debug: (message, data) => getLogger().debug(message, data),
    info: (message, data) => getLogger().info(message, data),
    warn: (message, data) => getLogger().warn(message, data),
    error: (message, data) => getLogger().error(message, data),
    emitAudit: (event) => {
      const level = event.level === 'debug' || event.level === 'warn' || event.level === 'error' ? event.level : 'info';
      const name = typeof event.event === 'string' ? event.event : 'audit';
      getLogger().emitAudit({ ...event, level, event: name });
    },
  };
}
