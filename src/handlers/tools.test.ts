import { describe, expect, it } from 'vitest';
import { GetTextsSchema, ListLanguagesSchema, SetTranslationSchema, TOOLS, TargetTypeSchema } from './tools.js';

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

describe('TOOLS registry', () => {
  it('exposes exactly the three translation tools', () => {
    expect(Object.keys(TOOLS).sort()).toEqual(
      ['TranslateGetTexts', 'TranslateListLanguages', 'TranslateSetTexts'].sort(),
    );
  });
});
