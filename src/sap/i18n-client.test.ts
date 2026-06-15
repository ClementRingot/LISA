import { describe, expect, it } from 'vitest';
import { type ListTextEntry, normalizeListTextEntry } from './i18n-client.js';

describe('normalizeListTextEntry', () => {
  it('decomposes a positional attribute "name[n]" into base attribute + position', () => {
    const raw = {
      level: 'field',
      field_name: 'BUSINESSUNITID',
      attribute: 'ui_facet_label[1]',
      value: 'Anomalies HU',
      populated: true,
    };
    expect(normalizeListTextEntry(raw)).toEqual({
      level: 'field',
      field_name: 'BUSINESSUNITID',
      attribute: 'ui_facet_label',
      position: '1',
      value: 'Anomalies HU',
      populated: true,
    });
  });

  it('leaves a non-positional attribute untouched and adds no position', () => {
    const raw = {
      level: 'entity',
      field_name: '',
      attribute: 'short_field_label',
      value: 'Betrag',
      populated: true,
    };
    const out = normalizeListTextEntry(raw);
    expect(out.attribute).toBe('short_field_label');
    expect(out.position).toBeUndefined();
  });

  it('preserves populated=false for an empty slot (to translate)', () => {
    const raw = {
      level: 'field',
      field_name: 'BUSINESSUNITID',
      attribute: 'ui_facet_label[1]',
      value: '',
      populated: false,
    };
    const out = normalizeListTextEntry(raw);
    expect(out.value).toBe('');
    expect(out.populated).toBe(false);
    expect(out.position).toBe('1');
  });

  it('falls back to value-non-empty when the ABAP omits populated (retro-compat)', () => {
    // Older ABAP builds did not emit `populated`; simulate that by casting away the field.
    const filled = {
      level: 'entity',
      field_name: '',
      attribute: 'description',
      value: 'X',
    } as unknown as ListTextEntry;
    const empty = { level: 'entity', field_name: '', attribute: 'description', value: '' } as unknown as ListTextEntry;
    expect(normalizeListTextEntry(filled).populated).toBe(true);
    expect(normalizeListTextEntry(empty).populated).toBe(false);
  });
});
