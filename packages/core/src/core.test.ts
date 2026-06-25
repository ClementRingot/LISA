import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  I18nCore,
  type I18nTransport,
  type ListTextEntry,
  type WireAction,
  __resetCapabilitiesCache,
  narrowListTexts,
} from './wire.js';

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

describe('cds_entity merged reader (getCdsEntityTexts)', () => {
  /** A transport whose capabilities allow both CDS objects, answering list_texts per target_type. */
  function cdsReader(byTarget: Record<string, ListTextEntry[]>): { transport: I18nTransport; post: PostMock } {
    const { transport, post } = mockTransport();
    post.mockImplementation((action: WireAction, body: string) => {
      if (action === 'capabilities')
        return Promise.resolve(ok({ list_texts: ['data_definition', 'metadata_extension'] }));
      const p = JSON.parse(body) as { target_type: string };
      return Promise.resolve(
        ok({
          target_type: p.target_type,
          object_name: 'ZC_VIEW',
          language: 'DE',
          texts: byTarget[p.target_type] ?? [],
        }),
      );
    });
    return { transport, post };
  }

  it('issues BOTH backend reads and concatenates, each row keeping the owner the backend stamped', async () => {
    const { transport, post } = cdsReader({
      data_definition: [
        {
          level: 'entity',
          field_name: '',
          attribute: 'endusertext_label',
          value: 'Bestellung',
          populated: true,
          owner: 'data_definition',
        },
      ],
      metadata_extension: [
        {
          level: 'field',
          field_name: 'AMOUNT',
          attribute: 'ui_lineitem_label[2]',
          value: 'Betrag',
          populated: true,
          owner: 'metadata_extension',
        },
      ],
    });

    const res = await new I18nCore(transport).getCdsEntityTexts({ object_name: 'ZC_VIEW', language: 'DE' });

    expect(res.target_type).toBe('cds_entity');
    // owner is READ from each row, never derived from which call produced it
    expect(res.texts[0]).toMatchObject({ owner: 'data_definition', attribute: 'endusertext_label' });
    // DDLX row: owner from the row + positional index decomposed for the round-trip key
    expect(res.texts[1]).toMatchObject({ owner: 'metadata_extension', attribute: 'ui_lineitem_label', position: '2' });

    const listTargets = post.mock.calls.filter(([a]) => a === 'list_texts').map(([, b]) => JSON.parse(b).target_type);
    expect(listTargets).toEqual(['data_definition', 'metadata_extension']);
  });

  it('a projection whose UI labels live in its DDLX surfaces them in the single call, owner=metadata_extension', async () => {
    // The view itself contributes only its entity description; every UI label comes from the DDLX.
    const { transport } = cdsReader({
      data_definition: [
        {
          level: 'entity',
          field_name: '',
          attribute: 'endusertext_label',
          value: 'Anomalies HU',
          populated: true,
          owner: 'data_definition',
        },
      ],
      metadata_extension: [
        {
          level: 'field',
          field_name: 'BUSINESSUNITID',
          attribute: 'ui_facet_label[1]',
          value: 'Anomalies HU',
          populated: true,
          owner: 'metadata_extension',
        },
        {
          level: 'field',
          field_name: 'BUSINESSUNITID',
          attribute: 'ui_lineitem_label[1]',
          value: 'HU',
          populated: true,
          owner: 'metadata_extension',
        },
      ],
    });

    const res = await new I18nCore(transport).getCdsEntityTexts({ object_name: 'ZC_ANOMALIESHU' });

    const uiLabels = res.texts.filter((t) => t.level === 'field');
    expect(uiLabels).toHaveLength(2);
    expect(uiLabels.every((t) => t.owner === 'metadata_extension')).toBe(true);
    expect(uiLabels.map((t) => t.position)).toEqual(['1', '1']);
  });

  it('a view with its own inline UI labels surfaces them with owner=data_definition', async () => {
    const { transport } = cdsReader({
      data_definition: [
        {
          level: 'field',
          field_name: 'AMOUNT',
          attribute: 'ui_lineitem_label[1]',
          value: 'Betrag',
          populated: true,
          owner: 'data_definition',
        },
      ],
      metadata_extension: [],
    });

    const res = await new I18nCore(transport).getCdsEntityTexts({ object_name: 'ZI_VIEW' });

    expect(res.texts).toHaveLength(1);
    expect(res.texts[0]).toMatchObject({ owner: 'data_definition', attribute: 'ui_lineitem_label', position: '1' });
  });

  it('does NOT deduplicate across owners — coinciding field_name/attribute stay two distinct slots', async () => {
    const slot = (owner: string): ListTextEntry => ({
      level: 'field',
      field_name: 'AMOUNT',
      attribute: 'ui_lineitem_label[1]',
      value: 'Betrag',
      populated: true,
      owner,
    });
    const { transport } = cdsReader({
      data_definition: [slot('data_definition')],
      metadata_extension: [slot('metadata_extension')],
    });

    const res = await new I18nCore(transport).getCdsEntityTexts({ object_name: 'ZC_VIEW' });

    expect(res.texts).toHaveLength(2);
    expect(res.texts.map((t) => t.owner)).toEqual(['data_definition', 'metadata_extension']);
  });
});

describe('owner-routed writer (setTextsByOwner)', () => {
  function writer(): { transport: I18nTransport; post: PostMock } {
    const { transport, post } = mockTransport();
    post.mockImplementation((action: WireAction, body: string) => {
      if (action === 'capabilities')
        return Promise.resolve(ok({ set_translation: ['data_element', 'data_definition', 'metadata_extension'] }));
      const p = JSON.parse(body) as Record<string, unknown>;
      return Promise.resolve(ok({ ...p, success: true }));
    });
    return { transport, post };
  }

  const setBodies = (post: PostMock) =>
    post.mock.calls.filter(([a]) => a === 'set_translation').map(([, b]) => JSON.parse(b));

  it('routes each row to the target_type named by its owner, writing each physical object once', async () => {
    const { transport, post } = writer();

    const results = await new I18nCore(transport).setTextsByOwner({
      target_type: 'cds_entity',
      object_name: 'ZC_VIEW',
      language: 'DE',
      transport: 'K900123',
      texts: [
        { attribute: 'endusertext_label', value: 'Bestellung', owner: 'data_definition' },
        {
          attribute: 'ui_lineitem_label',
          position: '2',
          value: 'Betrag',
          field_name: 'AMOUNT',
          owner: 'metadata_extension',
        },
        { attribute: 'ui_facet_label[1]', value: 'Allgemein', field_name: 'AMOUNT', owner: 'metadata_extension' },
      ],
    });

    // one result / one write per physical object (locked + transported once each)
    expect(results).toHaveLength(2);
    const bodies = setBodies(post);
    const dd = bodies.find((b) => b.target_type === 'data_definition');
    const me = bodies.find((b) => b.target_type === 'metadata_extension');
    expect(dd.texts).toHaveLength(1);
    expect(me.texts).toHaveLength(2);
    // owner is a routing key only — it must NOT appear on the wire
    expect(JSON.stringify(bodies)).not.toContain('owner');
    // positional index passes through to the right slot (separate position field), incl. the bracketed form
    expect(me.texts.find((t: { attribute: string }) => t.attribute === 'ui_lineitem_label').position).toBe('2');
    expect(me.texts.find((t: { attribute: string }) => t.attribute === 'ui_facet_label').position).toBe('1');
    // cds_entity itself is never sent — only the two physical target_types reach the backend
    expect(bodies.some((b) => b.target_type === 'cds_entity')).toBe(false);
  });

  it('round-trips a read straight back to set, each slot routed purely by owner with its index intact', async () => {
    const { transport, post } = writer();

    // Rows shaped exactly as getCdsEntityTexts emits them (owner stamped, index decomposed).
    const edited = [
      { attribute: 'endusertext_label', value: 'Order', field_name: '', owner: 'data_definition' },
      {
        attribute: 'ui_lineitem_label',
        position: '2',
        value: 'Amount',
        field_name: 'AMOUNT',
        owner: 'metadata_extension',
      },
    ];

    await new I18nCore(transport).setTextsByOwner({
      target_type: 'cds_entity',
      object_name: 'ZC_VIEW',
      language: 'EN',
      transport: 'K900123',
      texts: edited,
    });

    const bodies = setBodies(post);
    expect(bodies.find((b) => b.target_type === 'data_definition').texts[0]).toMatchObject({
      attribute: 'endusertext_label',
      value: 'Order',
    });
    expect(bodies.find((b) => b.target_type === 'metadata_extension').texts[0]).toMatchObject({
      attribute: 'ui_lineitem_label',
      position: '2',
      value: 'Amount',
    });
  });

  it('falls back to the call target_type for a row without owner (hand-built / single-object write)', async () => {
    const { transport, post } = writer();

    const results = await new I18nCore(transport).setTextsByOwner({
      target_type: 'data_element',
      object_name: 'ZMY_DTEL',
      language: 'DE',
      transport: 'K900123',
      texts: [{ attribute: 'short_field_label', value: 'Betrag' }],
    });

    expect(results).toHaveLength(1);
    expect(setBodies(post)[0].target_type).toBe('data_element');
  });
});

describe('narrowListTexts', () => {
  const entry = (over: Partial<ListTextEntry>): ListTextEntry => ({
    attribute: 'label',
    value: 'x',
    level: 'field',
    field_name: 'FOO',
    populated: true,
    ...over,
  });
  const texts: ListTextEntry[] = [
    entry({ field_name: 'FOO', position: '1' }),
    entry({ field_name: 'FOO', position: '2' }),
    entry({ field_name: 'BAR', position: '1' }),
  ];

  it('returns every entry unchanged when no selectors are given', () => {
    expect(narrowListTexts(texts, {})).toEqual(texts);
  });

  it('filters by field_name case-insensitively', () => {
    expect(narrowListTexts(texts, { field_name: 'foo' }).map((t) => t.field_name)).toEqual(['FOO', 'FOO']);
  });

  it('filters by position (exact string match) and combines with field_name', () => {
    expect(narrowListTexts(texts, { field_name: 'FOO', position: '1' })).toEqual([
      entry({ field_name: 'FOO', position: '1' }),
    ]);
  });
});
