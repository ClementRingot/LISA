/**
 * HTTP Streamable transport for the MCP server.
 * Authentication: XSUAA OAuth proxy | OIDC/JWT | API keys
 *
 * Route map:
 *   GET  /health          — unauthenticated liveness probe
 *   POST /mcp             — MCP Streamable HTTP (rate-limited, bearer-auth)
 *   *    /authorize etc.  — OAuth endpoints via mcpAuthRouter (XSUAA mode only)
 *   *    /.well-known/…   — OAuth metadata discovery
 */

import { randomUUID } from 'node:crypto';
import {
  createChainedTokenVerifier,
  createOAuthCallbackHandler,
  createOidcVerifier,
  createXsuaaOAuthProvider,
  createXsuaaTokenVerifier,
} from '@arc-mcp/xsuaa-auth';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { registerTranslationTools } from '../handlers/intent.js';
import { getLogger, requestContext, toPackageLogger } from './logger.js';
import type { Config } from './types.js';
import { VERSION } from './version.js';

/**
 * Client return addresses for the pre-registered client. These are separate
 * from XSUAA's redirect-uris, which contain only this server's callback.
 */
const XSUAA_REDIRECT_URI_PATTERNS = [
  'http://localhost:*/**',
  'https://*.hana.ondemand.com/**',
  'https://*.applicationstudio.cloud.sap/**',
  'https://claude.ai/api/mcp/auth_callback',
  'cursor://anysphere.cursor-retrieval/**',
  'cursor://anysphere.cursor-mcp/**',
  'vscode://vscode.microsoft-authentication/**',
] as const;

/** Built-in redirect_uris baked into the pre-registered XSUAA default client. */
const XSUAA_DEFAULT_REDIRECT_URIS = [
  'http://localhost:6274/oauth/callback', // MCP Inspector
  'http://localhost:3000/oauth/callback', // Local dev
  'https://claude.ai/api/mcp/auth_callback', // Claude Desktop
  'cursor://anysphere.cursor-retrieval/oauth/callback', // Cursor
  'vscode://vscode.microsoft-authentication/callback', // VS Code
] as const;

// CF injects VCAP_APPLICATION with the app's public routes.
// Falls back to localhost for local dev.
function resolvePublicUrl(port: number): URL {
  try {
    const vcap = process.env.VCAP_APPLICATION;
    if (vcap) {
      const app = JSON.parse(vcap) as { application_uris?: string[] };
      const host = app.application_uris?.[0];
      if (host) return new URL(`https://${host}`);
    }
  } catch {
    // ignore parse errors
  }
  return new URL(`http://localhost:${port}`);
}

export function createHttpServer(config: Config): express.Application {
  const log = getLogger();
  const app = express();

  // ── Security middleware ────────────────────────────────────────────────────
  // Trust the first proxy hop (CF GoRouter) so rate-limit & IP detection work.
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.disable('x-powered-by');

  if (config.corsAllowedOrigins.length > 0) {
    app.use(
      cors({
        origin: config.corsAllowedOrigins,
        methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id'],
      }),
    );
  }

  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: false }));

  // ── Request tracing ────────────────────────────────────────────────────────
  app.use((_req: Request, _res: Response, next: NextFunction) => {
    requestContext.run({ requestId: randomUUID().slice(0, 8) }, next);
  });

  // ── Health check ───────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: VERSION, ts: new Date().toISOString() });
  });

  // ── Rate limiters ──────────────────────────────────────────────────────────
  const mcpLimiter = rateLimit({
    windowMs: 60_000,
    max: config.mcpRateLimitPerMinute,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const oauthLimiter = rateLimit({
    windowMs: 60_000,
    max: config.oauthRateLimitPerMinute,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // ── Chained token verifier (XSUAA → OIDC → API key) ───────────────────────
  const authLogger = toPackageLogger();

  // LISA authenticates only — SAP enforces rights downstream — so the XSUAA
  // verifier extracts no scopes (`acceptedScopes: []`).
  const xsuaaVerifier = config.xsuaaBinding
    ? createXsuaaTokenVerifier(config.xsuaaBinding, { acceptedScopes: [], logger: authLogger })
    : undefined;

  // OIDC_AUDIENCE is mandatory when OIDC is enabled — resolveConfig() fails fast
  // otherwise. The only way to reach here with an issuer and no audience is the
  // explicit OIDC_ALLOW_ANY_AUDIENCE opt-out: jose then treats the undefined
  // audience as "do not validate", so warn loudly that validation is disabled.
  if (config.oidcIssuer && !config.oidcAudience) {
    log.warn(
      'OIDC_ALLOW_ANY_AUDIENCE=true — JWT audience validation is DISABLED. Any token from the configured issuer is accepted regardless of its intended audience (token-confusion risk). Set OIDC_AUDIENCE and remove the opt-out as soon as possible.',
    );
  }
  const oidcVerifier = config.oidcIssuer
    ? createOidcVerifier(config.oidcIssuer, config.oidcAudience as string, { logger: authLogger })
    : undefined;

  // Map LISA's `{ key, profile }` API keys to the package's `ApiKeyEntry`,
  // preserving the historical `api-key:<profile>` client identity.
  const apiKeys = config.apiKeys.map((entry) => ({ key: entry.key, clientId: `api-key:${entry.profile}` }));
  const verifyToken = createChainedTokenVerifier({ apiKeys }, xsuaaVerifier, oidcVerifier, { logger: authLogger });

  // LISA_DCR_SIGNING_SECRET is only consumed by the XSUAA OAuth proxy path below. When it is
  // set but no XSUAA binding is present, the secret is dead config — surface the misconfig
  // instead of ignoring it silently (mirrors ARC-1's warn on a set-but-unused signing secret).
  if (config.dcrSigningSecret && !config.xsuaaBinding) {
    log.warn(
      'LISA_DCR_SIGNING_SECRET is set but no XSUAA binding is present — the secret is only used by the XSUAA OAuth proxy and will be ignored here.',
    );
  }

  // ── XSUAA OAuth proxy (stateless DCR + callback proxy) ────────────────────
  if (config.xsuaaBinding) {
    const serverUrl = resolvePublicUrl(config.port);
    const appUrl = serverUrl.toString().replace(/\/$/, '');
    const callbackUrl = `${appUrl}/oauth/callback`;

    const { provider, clientStore, stateCodec } = createXsuaaOAuthProvider(config.xsuaaBinding, appUrl, {
      // Brand LISA's DCR client_ids (`lisa-…`) instead of the package default `mcp-`.
      clientIdPrefix: 'lisa-',
      dcrTtlSeconds: config.oauthDcrTtlSeconds,
      dcrSigningSecret: config.dcrSigningSecret,
      callbackUrl,
      redirectUriPatterns: XSUAA_REDIRECT_URI_PATTERNS,
      defaultRedirectUris: XSUAA_DEFAULT_REDIRECT_URIS,
      logger: authLogger,
    });

    // Auto-register a candidate redirect_uri for the pre-registered XSUAA client
    // before the SDK's exact-match check on /authorize (gated by the allowlist
    // inside ensureRedirectUri). Mounted before mcpAuthRouter so it runs first.
    app.use('/authorize', oauthLimiter, (req: Request, _res: Response, next: NextFunction) => {
      const params = req.method === 'POST' ? req.body : req.query;
      const clientId = params?.client_id;
      const redirectUri = params?.redirect_uri;
      if (clientId && typeof redirectUri === 'string') {
        clientStore.ensureRedirectUri(clientId, redirectUri);
      }
      next();
    });

    // Callback proxy (issue #214): XSUAA redirects HERE with our opaque state
    // token; we decode it, validate the client binding, and forward to the real
    // client redirect_uri re-emitting the original state with correct encoding.
    app.get(
      '/oauth/callback',
      oauthLimiter,
      createOAuthCallbackHandler(stateCodec, clientStore, { logger: authLogger }),
    );

    app.use(
      oauthLimiter,
      mcpAuthRouter({
        provider,
        issuerUrl: serverUrl,
        resourceServerUrl: new URL('/mcp', serverUrl),
        scopesSupported: [],
        resourceName: 'SAP Translator MCP',
      }),
    );
  }

  const authRequired =
    config.apiKeys.length > 0 || config.xsuaaBinding !== undefined || config.oidcIssuer !== undefined;

  // ── MCP endpoint ───────────────────────────────────────────────────────────
  app.post('/mcp', mcpLimiter, async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

    let sub: string | undefined;

    if (token) {
      try {
        const verified = await verifyToken(token);
        sub = (verified.extra?.userName as string | undefined) ?? verified.clientId;
      } catch (e) {
        log.warn('Token verification failed', { err: (e as Error).message });
        res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' });
        return;
      }
    } else if (authRequired) {
      res.status(401).json({ error: 'unauthorized', message: 'Bearer token required' });
      return;
    }

    requestContext.run({ requestId: randomUUID().slice(0, 8), user: sub }, async () => {
      // Per-request server + transport pattern avoids "already connected" errors.
      const server = new McpServer({ name: 'lisa', version: VERSION });
      // Pass the raw bearer token so the SAP client can use principal propagation
      await registerTranslationTools(server, config, token);

      // Stateless mode (sessionIdGenerator: undefined): each request is
      // self-contained. Required for the per-request server pattern — a stateful
      // transport would assign a Mcp-Session-Id on `initialize` that the next
      // request's fresh transport wouldn't recognise, breaking tools/list (400).
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (e) {
        log.error('MCP request error', { err: (e as Error).message });
        if (!res.headersSent) {
          res.status(500).json({ error: 'internal_error' });
        }
      } finally {
        await transport.close();
        await server.close();
      }
    });
  });

  return app;
}

export async function startHttpServer(config: Config): Promise<void> {
  const log = getLogger();
  const app = createHttpServer(config);

  await new Promise<void>((resolve) => {
    app.listen(config.port, () => {
      log.info('SAP Translator MCP server listening', { port: config.port, transport: 'http-streamable' });
      resolve();
    });
  });
}
