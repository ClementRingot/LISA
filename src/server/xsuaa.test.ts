import { beforeAll, describe, expect, it } from 'vitest';
import { initLogger } from './logger.js';
import { createChainedTokenVerifier } from './xsuaa.js';

beforeAll(() => initLogger('text', 'error'));

describe('createChainedTokenVerifier — API key path', () => {
  const verify = createChainedTokenVerifier({
    apiKeys: [
      { key: 'secret-viewer-key', profile: 'viewer' },
      { key: 'secret-admin-key', profile: 'admin' },
    ],
  });

  it('accepts a configured API key and maps it to a profile clientId', async () => {
    const info = await verify('secret-admin-key');
    expect(info.clientId).toBe('api-key:admin');
    expect(info.scopes).toEqual([]);
    expect(info.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects an unknown token', async () => {
    await expect(verify('not-a-real-key')).rejects.toThrow();
  });

  it('rejects a token that is a prefix of a real key (constant-time compare)', async () => {
    await expect(verify('secret-admin')).rejects.toThrow();
  });
});
