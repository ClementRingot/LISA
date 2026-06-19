import { describe, expect, it } from 'vitest';
import plugin from './index.js';

describe('lisa-arc1-extension plugin', () => {
  it('declares apiVersion 1 and the three Custom_* tools', () => {
    expect(plugin.apiVersion).toBe(1);
    expect(plugin.tools.map((t) => t.name).sort()).toEqual(
      ['Custom_TranslateGetTexts', 'Custom_TranslateListLanguages', 'Custom_TranslateSetTexts'].sort(),
    );
  });

  it('every tool follows the Custom_* naming convention required by ARC-1', () => {
    for (const tool of plugin.tools) {
      expect(tool.name).toMatch(/^Custom_/);
    }
  });

  it('declares scope:write on every tool (LISA POSTs every action, including reads)', () => {
    for (const tool of plugin.tools) {
      expect(tool.policy.scope).toBe('write');
    }
  });
});
