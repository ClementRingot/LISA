import { describe, expect, it } from 'vitest';
import {
  type Capabilities,
  type ListTextEntry,
  isTargetTypeSupported,
  normalizeListTextEntry,
  unsupportedTargetMessage,
} from './i18n-client.js';

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

describe('isTargetTypeSupported / unsupportedTargetMessage', () => {
  // Allow-list mirroring the cloud handler: text_pool is writable but not listable.
  const cloudCaps: Capabilities = {
    list_texts: ['data_element', 'data_definition', 'message_class'],
    set_translation: ['data_element', 'data_definition', 'message_class', 'text_pool'],
  };

  it('allows a target_type listed for the action', () => {
    expect(isTargetTypeSupported(cloudCaps, 'list_texts', 'data_element')).toBe(true);
    expect(isTargetTypeSupported(cloudCaps, 'set_translation', 'text_pool')).toBe(true);
  });

  it('blocks a target_type not listed for the action (incl. a write-yes / read-no asymmetry)', () => {
    expect(isTargetTypeSupported(cloudCaps, 'list_texts', 'text_pool')).toBe(false);
    expect(isTargetTypeSupported(cloudCaps, 'list_texts', 'domain')).toBe(false);
  });

  it('is permissive when the action is undeclared or capabilities are unknown', () => {
    expect(isTargetTypeSupported(cloudCaps, 'list_languages', 'data_element')).toBe(true);
    expect(isTargetTypeSupported(null, 'list_texts', 'text_pool')).toBe(true);
    expect(isTargetTypeSupported(undefined, 'list_texts', 'text_pool')).toBe(true);
  });

  it('formats an actionable message', () => {
    const msg = unsupportedTargetMessage('list_texts', 'text_pool');
    expect(msg).toContain("target_type 'text_pool' is not available for 'list_texts'");
    expect(msg).toContain('different object types');
  });
});
