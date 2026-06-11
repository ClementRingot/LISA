import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveConfig } from './config.js';

// resolveConfig reads process.env. Isolate each test from the ambient env.
const TOUCHED = [
  'SAP_URL',
  'SAP_USERNAME',
  'SAP_PASSWORD',
  'SAP_CLIENT',
  'SAP_BTP_DESTINATION',
  'SAP_BTP_PP_DESTINATION',
  'SAP_I18N_SERVICE_PATH',
  'MCP_TRANSPORT',
  'PORT',
  'SAP_API_KEYS',
  'OIDC_ISSUER',
  'OIDC_AUDIENCE',
  'VCAP_SERVICES',
  'CORS_ORIGINS',
  'MCP_RATE_LIMIT',
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of TOUCHED) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('resolveConfig', () => {
  it('throws when neither SAP_URL nor SAP_BTP_DESTINATION is set', () => {
    expect(() => resolveConfig()).toThrow();
  });

  it('applies local-dev defaults when SAP_URL is set', () => {
    process.env.SAP_URL = 'https://sap.example.com';
    const c = resolveConfig();
    expect(c.sapUrl).toBe('https://sap.example.com');
    expect(c.sapClient).toBe('000');
    expect(c.transport).toBe('http-streamable');
    expect(c.port).toBe(8080);
    expect(c.i18nServicePath).toBe('/sap/bc/http/sap/zi18n_service');
    expect(c.logFormat).toBe('json'); // http-streamable default
  });

  it('accepts a BTP destination without local SAP creds', () => {
    process.env.SAP_BTP_DESTINATION = 'SAP_SYS';
    expect(() => resolveConfig()).not.toThrow();
  });

  describe('parseApiKeys (via resolveConfig)', () => {
    it('keeps valid key:profile pairs and drops invalid profiles / malformed entries', () => {
      process.env.SAP_URL = 'https://sap.example.com';
      process.env.SAP_API_KEYS = 'k1:viewer,k2:developer,k3:admin,k4:superuser,nopair,:nokey,k6:';
      const c = resolveConfig();
      expect(c.apiKeys).toEqual([
        { key: 'k1', profile: 'viewer' },
        { key: 'k2', profile: 'developer' },
        { key: 'k3', profile: 'admin' },
      ]);
    });

    it('defaults to no api keys', () => {
      process.env.SAP_URL = 'https://sap.example.com';
      expect(resolveConfig().apiKeys).toEqual([]);
    });
  });

  describe('parseXsuaaBinding (via resolveConfig)', () => {
    it('extracts the xsuaa credentials from VCAP_SERVICES', () => {
      process.env.SAP_URL = 'https://sap.example.com';
      process.env.VCAP_SERVICES = JSON.stringify({
        xsuaa: [{ credentials: { url: 'https://uaa', clientid: 'cid', clientsecret: 's', xsappname: 'app' } }],
      });
      expect(resolveConfig().xsuaaBinding).toMatchObject({ url: 'https://uaa', clientid: 'cid' });
    });

    it('returns undefined when VCAP has no usable xsuaa binding', () => {
      process.env.SAP_URL = 'https://sap.example.com';
      process.env.VCAP_SERVICES = JSON.stringify({ xsuaa: [{ credentials: { url: 'https://uaa' } }] });
      expect(resolveConfig().xsuaaBinding).toBeUndefined();
    });

    it('does not throw on malformed VCAP_SERVICES', () => {
      process.env.SAP_URL = 'https://sap.example.com';
      process.env.VCAP_SERVICES = '{not json';
      expect(() => resolveConfig()).not.toThrow();
      expect(resolveConfig().xsuaaBinding).toBeUndefined();
    });
  });

  it('parses CORS origins as a trimmed list', () => {
    process.env.SAP_URL = 'https://sap.example.com';
    process.env.CORS_ORIGINS = 'https://a.com, https://b.com';
    expect(resolveConfig().corsAllowedOrigins).toEqual(['https://a.com', 'https://b.com']);
  });
});
