import { beforeAll, describe, expect, it } from 'vitest';
import { initLogger } from './logger.js';
import { StatelessDcrClientStore, matchesXsuaaRedirectPattern, validateRedirectUri } from './stateless-client-store.js';

// The store emits audit/debug logs via the global logger.
beforeAll(() => initLogger('text', 'error'));

const XSUAA_ID = 'sb-sap-translator!t123';
const XSUAA_SECRET = 'xsuaa-client-secret';
const SIGNING = 'dcr-signing-secret-32-bytes-minimum-xx';

function newStore(now?: () => number, ttlSeconds?: number) {
  return new StatelessDcrClientStore(XSUAA_ID, XSUAA_SECRET, SIGNING, { now, ttlSeconds });
}

describe('StatelessDcrClientStore', () => {
  it('round-trips a registered client through getClient', async () => {
    const store = newStore();
    const reg = await store.registerClient({
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      client_name: 'Test',
    });
    expect(reg.client_id).toMatch(/^sapt-/);
    const got = await store.getClient(reg.client_id);
    expect(got?.redirect_uris).toEqual(['https://claude.ai/api/mcp/auth_callback']);
    expect(got?.client_secret).toBe(reg.client_secret);
  });

  it('derives a stable client_secret from the client_id (same key ⇒ same secret)', async () => {
    const fixedNow = () => 1_700_000_000_000;
    const reg = await newStore(fixedNow).registerClient({ redirect_uris: ['https://a.hana.ondemand.com/cb'] });
    // A fresh store with the SAME signing key validates an id it never issued.
    const got = await newStore(fixedNow).getClient(reg.client_id);
    expect(got).toBeDefined();
    expect(got?.client_secret).toBe(reg.client_secret);
  });

  it('returns the pre-registered XSUAA default client by its id', async () => {
    const got = await newStore().getClient(XSUAA_ID);
    expect(got?.client_id).toBe(XSUAA_ID);
    expect(got?.client_secret).toBe(XSUAA_SECRET);
  });

  it('rejects an id without the sapt- prefix', async () => {
    expect(await newStore().getClient('random-id')).toBeUndefined();
  });

  it('rejects a tampered signed id', async () => {
    const store = newStore();
    const reg = await store.registerClient({ redirect_uris: ['https://a.hana.ondemand.com/cb'] });
    const tampered = `${reg.client_id.slice(0, -3)}AAA`;
    expect(await store.getClient(tampered)).toBeUndefined();
  });

  it('does not validate an id signed with a different key', async () => {
    const reg = await newStore().registerClient({ redirect_uris: ['https://a.hana.ondemand.com/cb'] });
    const other = new StatelessDcrClientStore(XSUAA_ID, XSUAA_SECRET, 'a-totally-different-signing-secret-value');
    expect(await other.getClient(reg.client_id)).toBeUndefined();
  });

  it('expires a client past its TTL (clock injected)', async () => {
    let t = 1_700_000_000_000;
    const store = newStore(() => t, 100); // 100s TTL
    const reg = await store.registerClient({ redirect_uris: ['https://a.hana.ondemand.com/cb'] });
    expect(await store.getClient(reg.client_id)).toBeDefined();
    t += 101_000;
    expect(await store.getClient(reg.client_id)).toBeUndefined();
  });

  describe('checkRedirectUri', () => {
    it('accepts a redirect_uri baked into the DCR client id, rejects others', async () => {
      const store = newStore();
      const reg = await store.registerClient({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
      expect(await store.checkRedirectUri(reg.client_id, 'https://claude.ai/api/mcp/auth_callback')).toBe('ok');
      expect(await store.checkRedirectUri(reg.client_id, 'https://evil.example.com/cb')).toBe('unregistered');
      expect(await store.checkRedirectUri('sapt-forged.deadbeef', 'https://x/cb')).toBe('unknown_client');
    });

    it('gates the default XSUAA client by the static allowlist', async () => {
      const store = newStore();
      expect(await store.checkRedirectUri(XSUAA_ID, 'https://foo.hana.ondemand.com/cb')).toBe('ok');
      expect(await store.checkRedirectUri(XSUAA_ID, 'https://evil.example.com/cb')).toBe('unregistered');
    });
  });
});

describe('matchesXsuaaRedirectPattern', () => {
  it.each([
    'http://localhost:6274/oauth/callback',
    'http://localhost:3000/cb',
    'https://foo.hana.ondemand.com/login/callback',
    'https://my.applicationstudio.cloud.sap/x',
    'https://claude.ai/api/mcp/auth_callback',
    'cursor://anysphere.cursor-retrieval/oauth/callback',
    'vscode://vscode.microsoft-authentication/callback',
  ])('accepts allowed URI %s', (uri) => {
    expect(matchesXsuaaRedirectPattern(uri)).toBe(true);
  });

  it.each([
    'https://evil.example.com/cb',
    'http://evil.com/cb', // http only allowed for localhost
    'https://hana.ondemand.com.evil.com/cb', // subdomain trick
    'not a url',
  ])('rejects disallowed URI %s', (uri) => {
    expect(matchesXsuaaRedirectPattern(uri)).toBe(false);
  });

  it('rejects a userinfo @-authority bypass that matches the port glob textually', () => {
    // Matches the `http://localhost:[^/]*/...` regex as a string, but new URL()
    // parses the host as evil.com — must be rejected.
    expect(matchesXsuaaRedirectPattern('http://localhost:1@evil.com/cb')).toBe(false);
  });
});

describe('validateRedirectUri', () => {
  it.each(['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'ftp://h/x'])(
    'throws on blocked scheme %s',
    (uri) => {
      expect(() => validateRedirectUri(uri)).toThrow();
    },
  );

  it.each([
    'https://anything.example.com/cb',
    'http://localhost:3000/cb',
    'http://127.0.0.1/cb',
    'claude://callback',
    'cursor://callback',
    'vscode://callback',
    'vscode-insiders://callback',
  ])('accepts allowed URI %s', (uri) => {
    expect(() => validateRedirectUri(uri)).not.toThrow();
  });

  it('rejects http:// to a non-loopback host', () => {
    expect(() => validateRedirectUri('http://evil.com/cb')).toThrow();
  });
});
