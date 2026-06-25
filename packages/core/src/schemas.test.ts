import { describe, expect, it } from 'vitest';
import {
  GetTextsSchema,
  ListLanguagesSchema,
  SetTranslationSchema,
  TOOLS,
  TargetTypeSchema,
  supportedTargetTypesNote,
} from './schemas.js';

describe('TargetTypeSchema', () => {
  it('accepts the XCO semantic literals', () => {
    for (const t of [
      'data_element',
      'domain',
      'data_definition',
      'message_class',
      'text_pool',
      'metadata_extension',
      'application_log_object',
      'business_configuration_object',
    ]) {
      expect(TargetTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it('accepts the synthetic merged CDS entity target (cds_entity)', () => {
    expect(TargetTypeSchema.safeParse('cds_entity').success).toBe(true);
  });

  it('rejects DDIC short codes and unknown values', () => {
    for (const t of ['DTEL', 'CLAS', 'TABL', '', 'Data_Element']) {
      expect(TargetTypeSchema.safeParse(t).success).toBe(false);
    }
  });
});

describe('GetTextsSchema', () => {
  it('accepts a minimal valid payload', () => {
    const r = GetTextsSchema.safeParse({ target_type: 'data_element', object_name: 'ZMY', language: 'DE' });
    expect(r.success).toBe(true);
  });

  it('accepts an omitted language (read in original language)', () => {
    const r = GetTextsSchema.safeParse({ target_type: 'metadata_extension', object_name: 'ZC_ANOMALIESHU' });
    expect(r.success).toBe(true);
  });

  it('rejects a language longer than 2 chars', () => {
    const r = GetTextsSchema.safeParse({ target_type: 'data_element', object_name: 'ZMY', language: 'GER' });
    expect(r.success).toBe(false);
  });

  it('rejects an empty object_name', () => {
    const r = GetTextsSchema.safeParse({ target_type: 'data_element', object_name: '', language: 'DE' });
    expect(r.success).toBe(false);
  });
});

describe('SetTranslationSchema', () => {
  it('accepts a valid write with a transport and at least one text entry', () => {
    const r = SetTranslationSchema.safeParse({
      target_type: 'data_element',
      object_name: 'ZMY',
      language: 'DE',
      transport: 'K900123',
      texts: [{ attribute: 'short_field_label', value: 'Betrag' }],
    });
    expect(r.success).toBe(true);
  });

  it('accepts per-entry field_name/position so multiple fields write in one call', () => {
    const r = SetTranslationSchema.safeParse({
      target_type: 'data_definition',
      object_name: 'ZC_MYVIEW',
      language: 'DE',
      transport: 'K900123',
      texts: [
        { attribute: 'ui_lineitem_label', value: 'Menge', field_name: 'Quantity', position: '1' },
        { attribute: 'ui_lineitem_label', value: 'Betrag', field_name: 'Amount', position: '1' },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('accepts a cds_entity round-trip write whose rows carry owner (routed per physical object)', () => {
    const r = SetTranslationSchema.safeParse({
      target_type: 'cds_entity',
      object_name: 'ZC_MYVIEW',
      language: 'DE',
      transport: 'K900123',
      texts: [
        { attribute: 'endusertext_label', value: 'Bestellung', owner: 'data_definition' },
        {
          attribute: 'ui_lineitem_label',
          value: 'Betrag',
          field_name: 'Amount',
          position: '2',
          owner: 'metadata_extension',
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rejects an empty texts array', () => {
    const r = SetTranslationSchema.safeParse({
      target_type: 'data_element',
      object_name: 'ZMY',
      language: 'DE',
      transport: 'K900123',
      texts: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects a text entry with an empty attribute', () => {
    const r = SetTranslationSchema.safeParse({
      target_type: 'data_element',
      object_name: 'ZMY',
      language: 'DE',
      transport: 'K900123',
      texts: [{ attribute: '', value: 'x' }],
    });
    expect(r.success).toBe(false);
  });

  it('requires a transport', () => {
    const r = SetTranslationSchema.safeParse({
      target_type: 'data_element',
      object_name: 'ZMY',
      language: 'DE',
      texts: [{ attribute: 'short_field_label', value: 'x' }],
    });
    expect(r.success).toBe(false);
  });
});

describe('ListLanguagesSchema', () => {
  it('ListLanguages takes no args', () => {
    expect(ListLanguagesSchema.safeParse({}).success).toBe(true);
  });
});

describe('supportedTargetTypesNote', () => {
  const caps = {
    list_texts: ['data_element', 'data_definition'],
    set_translation: ['data_element', 'text_pool'],
  };

  it('states the concrete per-action allow-list when capabilities are known', () => {
    const note = supportedTargetTypesNote('list_texts', caps);
    expect(note).toContain("'list_texts' supports these target_type values: data_element, data_definition");
    expect(note).toContain('rejected before reaching SAP');
    expect(note).not.toContain('STACK DIFFERENCES');
  });

  it('uses the per-action list (read vs write differ)', () => {
    expect(supportedTargetTypesNote('set_translation', caps)).toContain('data_element, text_pool');
  });

  it('falls back to the generic stack-differences caveat when capabilities are unavailable', () => {
    for (const note of [
      supportedTargetTypesNote('list_texts', null),
      supportedTargetTypesNote('unknown_action', caps),
    ]) {
      expect(note).toContain('STACK DIFFERENCES');
      expect(note).toContain('rejected up-front');
    }
  });
});

describe('TOOLS registry', () => {
  it('exposes exactly the three translation tools', () => {
    expect(Object.keys(TOOLS).sort()).toEqual(
      ['TranslateGetTexts', 'TranslateListLanguages', 'TranslateSetTexts'].sort(),
    );
  });
});
