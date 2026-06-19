import type { SafeHttpClient } from 'arc-1/public';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ctxHttpTransport } from './transport.js';

describe('ctxHttpTransport', () => {
  afterEach(() => {
    // biome-ignore lint/performance/noDelete: assigning undefined stringifies to "undefined" in process.env, unlike delete
    delete process.env.SAP_I18N_SERVICE_PATH;
  });

  it('posts to the default service path + action, forwarding status/body', async () => {
    const post = vi.fn().mockResolvedValue({ statusCode: 200, body: '{"success":true,"data":{}}' });
    const http = { get: vi.fn(), head: vi.fn(), post } as unknown as SafeHttpClient;

    const transport = ctxHttpTransport(http);
    const res = await transport.post('list_languages', '{}');

    expect(post).toHaveBeenCalledWith('/sap/bc/http/sap/zi18n_service/list_languages', '{}', 'application/json', {
      Accept: 'application/json',
    });
    expect(res).toEqual({ status: 200, body: '{"success":true,"data":{}}' });
  });

  it('honors SAP_I18N_SERVICE_PATH and strips a trailing slash', async () => {
    process.env.SAP_I18N_SERVICE_PATH = '/sap/bc/http/sap/zi18n_service_cloud/';
    const post = vi.fn().mockResolvedValue({ statusCode: 200, body: '{"success":true,"data":{}}' });
    const http = { get: vi.fn(), head: vi.fn(), post } as unknown as SafeHttpClient;

    await ctxHttpTransport(http).post('capabilities', '{}');

    expect(post).toHaveBeenCalledWith('/sap/bc/http/sap/zi18n_service_cloud/capabilities', '{}', 'application/json', {
      Accept: 'application/json',
    });
  });
});
