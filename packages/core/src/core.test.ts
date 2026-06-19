import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nCore, type I18nTransport, type WireAction, __resetCapabilitiesCache } from './wire.js';

/**
 * Contract tests for the shared I18nCore against a mock transport. These guard BOTH distributions
 * (standalone server + ARC-1 extension) against wire drift: compaction, the {success,data,error}
 * envelope unwrap, list_texts normalization, the process-wide capabilities cache, and — critically —
 * that core hands the transport an ALREADY-serialized JSON string (so a transport must not re-stringify).
 */

type PostMock = ReturnType<typeof vi.fn>;

/** A transport whose `post` is a vi mock, plus a queue-style responder helper. */
function mockTransport(): { transport: I18nTransport; post: PostMock } {
  const post = vi.fn();
  return { transport: { post: post as unknown as I18nTransport['post'] }, post };
}

function ok(data: unknown) {
  return { status: 200, body: JSON.stringify({ success: true, data }) };
}

afterEach(() => {
  __resetCapabilitiesCache();
  vi.restoreAllMocks();
});

describe('I18nCore wire contract', () => {
  it('listLanguages unwraps the envelope and returns the languages array', async () => {
    const { transport, post } = mockTransport();
    post.mockResolvedValue(ok({ languages: [{ sap_code: 'E', iso_code: 'EN', name: 'English' }] }));

    const langs = await new I18nCore(transport).listLanguages();

    expect(langs).toEqual([{ sap_code: 'E', iso_code: 'EN', name: 'English' }]);
    expect(post).toHaveBeenCalledWith('list_languages', '{}');
  });

  it('hands the transport a pre-serialized, COMPACTED JSON string (no double-encoding, empties dropped)', async () => {
    const { transport, post } = mockTransport();
    // capabilities probe (first call) → permissive, then list_texts.
    post.mockResolvedValueOnce({ status: 404, body: JSON.stringify({ success: false, error: { code: 'HTTP_404' } }) });
    post.mockResolvedValueOnce(ok({ target_type: 'data_element', object_name: 'ZD', language: 'DE', texts: [] }));

    await new I18nCore(transport).getTexts({
      target_type: 'data_element',
      object_name: 'ZD',
      language: 'DE',
      text_pool_owner_type: '', // empty → must be compacted away
    });

    const [action, jsonBody] = post.mock.calls[1];
    expect(action).toBe<WireAction>('list_texts');
    expect(typeof jsonBody).toBe('string'); // a STRING, not an object — transport must POST it verbatim
    expect(JSON.parse(jsonBody)).toEqual({ target_type: 'data_element', object_name: 'ZD', language: 'DE' });
    expect(jsonBody).not.toContain('text_pool_owner_type');
  });

  it('normalizes list_texts entries (position decomposition + guaranteed populated)', async () => {
    const { transport, post } = mockTransport();
    post.mockResolvedValueOnce({ status: 404, body: JSON.stringify({ success: false, error: { code: 'HTTP_404' } }) });
    post.mockResolvedValueOnce(
      ok({
        target_type: 'metadata_extension',
        object_name: 'ZC',
        language: 'DE',
        texts: [{ level: 'field', field_name: 'F', attribute: 'ui_facet_label[2]', value: 'X', populated: true }],
      }),
    );

    const res = await new I18nCore(transport).getTexts({ target_type: 'metadata_extension', object_name: 'ZC' });

    expect(res.texts[0]).toMatchObject({ attribute: 'ui_facet_label', position: '2', populated: true });
  });

  it('maps CLOUD_UNSUPPORTED to a clear stack-limitation error', async () => {
    const { transport, post } = mockTransport();
    post.mockResolvedValueOnce({ status: 404, body: JSON.stringify({ success: false, error: { code: 'HTTP_404' } }) });
    post.mockResolvedValueOnce({
      status: 400,
      body: JSON.stringify({ success: false, error: { code: 'CLOUD_UNSUPPORTED', message: 'text_pool read' } }),
    });

    await expect(new I18nCore(transport).getTexts({ target_type: 'text_pool', object_name: 'ZCL' })).rejects.toThrow(
      /SAP ABAP Cloud .* text_pool read/,
    );
  });

  it('rejects a target_type the backend capabilities allow-list excludes, before posting the action', async () => {
    const { transport, post } = mockTransport();
    post.mockResolvedValueOnce(ok({ list_texts: ['data_element'] })); // capabilities

    await expect(new I18nCore(transport).getTexts({ target_type: 'domain', object_name: 'ZDOM' })).rejects.toThrow(
      /not available for 'list_texts'/,
    );

    // only the capabilities probe was posted — list_texts itself was never sent
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe('capabilities');
  });

  it('probes capabilities ONCE per process and reuses the cache across instances', async () => {
    const { transport, post } = mockTransport();
    post.mockResolvedValue(ok({ list_texts: ['data_element'], set_translation: ['data_element'] }));

    await new I18nCore(transport).getCapabilities();
    await new I18nCore(transport).getCapabilities(); // a SECOND, fresh instance (as the ARC-1 extension does)

    const capabilityCalls = post.mock.calls.filter(([action]) => action === 'capabilities');
    expect(capabilityCalls).toHaveLength(1);
  });
});
