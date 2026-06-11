import { describe, expect, it } from 'vitest';
import { OAuthStateCodec } from './oauth-state.js';

const SECRET = 'test-signing-secret-at-least-16-bytes-long';

describe('OAuthStateCodec', () => {
  it('round-trips clientState, clientRedirectUri and clientId', () => {
    const codec = new OAuthStateCodec(SECRET);
    const token = codec.encode({
      clientState: 'abc+def/ghi=',
      clientRedirectUri: 'https://claude.ai/api/mcp/auth_callback',
      clientId: 'sapt-xyz',
    });
    const decoded = codec.decode(token);
    expect(decoded).toEqual({
      kind: 'ok',
      clientState: 'abc+def/ghi=',
      clientRedirectUri: 'https://claude.ai/api/mcp/auth_callback',
      clientId: 'sapt-xyz',
    });
  });

  it('produces a URL-safe token (no +, /, =, or whitespace) even when state has them', () => {
    const codec = new OAuthStateCodec(SECRET);
    const token = codec.encode({
      clientState: 'a+b/c=d e',
      clientRedirectUri: 'https://x.hana.ondemand.com/cb',
      clientId: 'sapt-1',
    });
    expect(token).toMatch(/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/);
    expect(token).not.toMatch(/[+/=\s]/);
  });

  it('treats an absent clientState as undefined (RFC 6749 optional)', () => {
    const codec = new OAuthStateCodec(SECRET);
    const decoded = codec.decode(codec.encode({ clientRedirectUri: 'https://x.hana.ondemand.com/cb', clientId: 'c' }));
    expect(decoded.kind).toBe('ok');
    if (decoded.kind === 'ok') expect(decoded.clientState).toBeUndefined();
  });

  it('rejects a tampered payload as bad_signature', () => {
    const codec = new OAuthStateCodec(SECRET);
    const token = codec.encode({ clientRedirectUri: 'https://x.hana.ondemand.com/cb', clientId: 'c' });
    const [payload, sig] = token.split('.');
    // Flip the payload but keep the original signature.
    const forged = `${payload.slice(0, -2)}AA.${sig}`;
    expect(codec.decode(forged)).toEqual({ kind: 'error', reason: 'bad_signature' });
  });

  it('does not validate a token signed with a different secret', () => {
    const a = new OAuthStateCodec(SECRET);
    const b = new OAuthStateCodec('a-completely-different-secret-value');
    const token = a.encode({ clientRedirectUri: 'https://x.hana.ondemand.com/cb', clientId: 'c' });
    expect(b.decode(token)).toEqual({ kind: 'error', reason: 'bad_signature' });
  });

  it('rejects an expired token', () => {
    const codec = new OAuthStateCodec(SECRET, { ttlSeconds: 600 });
    const t0 = 1_000_000_000_000;
    const token = codec.encode({ clientRedirectUri: 'https://x.hana.ondemand.com/cb', clientId: 'c', now: t0 });
    // 601s later → past the 600s TTL.
    expect(codec.decode(token, t0 + 601_000)).toEqual({ kind: 'error', reason: 'expired' });
    // still valid one second earlier.
    expect(codec.decode(token, t0 + 599_000).kind).toBe('ok');
  });

  it.each([
    ['', 'empty'],
    ['no-dot-token', 'no separator'],
    ['.sig', 'empty payload'],
    ['payload.', 'empty sig'],
  ])('rejects malformed token %j (%s)', (token) => {
    const codec = new OAuthStateCodec(SECRET);
    expect(codec.decode(token).kind).toBe('error');
  });

  it('throws when constructed with an empty signing secret', () => {
    expect(() => new OAuthStateCodec('')).toThrow();
  });
});
