import { describe, expect, it } from 'vitest';
import {
  comboFromEvent,
  formatCombo,
  isModifierKey,
  matchesCombo,
  parseCombo,
  validateComboForBinding,
  type ComboEvent,
  type KeyCombo,
} from './shortcuts';

function keyEvent(overrides: Partial<ComboEvent> & { key: string }): ComboEvent {
  return { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...overrides };
}

function combo(overrides: Partial<KeyCombo> & { key: string }): KeyCombo {
  return { ctrl: false, alt: false, shift: false, ...overrides };
}

describe('parseCombo', () => {
  it('parses plain, shifted, and modified combos case-insensitively', () => {
    expect(parseCombo('Tab')).toEqual(combo({ key: 'tab' }));
    expect(parseCombo('shift+tab')).toEqual(combo({ shift: true, key: 'tab' }));
    expect(parseCombo('ctrl+s')).toEqual(combo({ ctrl: true, key: 's' }));
    expect(parseCombo('Ctrl+Shift+S')).toEqual(combo({ ctrl: true, shift: true, key: 's' }));
  });

  it('folds meta into ctrl and normalizes esc', () => {
    expect(parseCombo('Meta+S')).toEqual(combo({ ctrl: true, key: 's' }));
    expect(parseCombo('Esc')).toEqual(combo({ key: 'escape' }));
  });

  it('rejects malformed combos', () => {
    expect(parseCombo('')).toBeNull();
    expect(parseCombo('Ctrl+')).toBeNull(); // no key part
    expect(parseCombo('Foo+Tab')).toBeNull(); // unknown modifier
    expect(parseCombo('Ctrl+A+B')).toBeNull(); // two keys
    expect(parseCombo('Ctrl+Ctrl+S')).toBeNull(); // duplicate modifier
    expect(parseCombo('Ctrl')).toBeNull(); // modifiers only
    expect(parseCombo('bogus++')).toBeNull(); // junk key name
    expect(parseCombo('Ctrl+NotARealKey')).toBeNull();
  });

  it('accepts all three modifiers at once in canonical order-independently', () => {
    expect(parseCombo('Shift+Ctrl+S+Alt')).toEqual(combo({ ctrl: true, alt: true, shift: true, key: 's' }));
  });
});

describe('formatCombo', () => {
  it('produces the canonical storage form', () => {
    expect(formatCombo(combo({ key: 'tab' }))).toBe('Tab');
    expect(formatCombo(combo({ shift: true, key: 'tab' }))).toBe('Shift+Tab');
    expect(formatCombo(combo({ ctrl: true, key: 's' }))).toBe('Ctrl+S');
    expect(formatCombo(combo({ ctrl: true, alt: true, key: 'k' }))).toBe('Ctrl+Alt+K');
    expect(formatCombo(combo({ key: 'f5' }))).toBe('F5');
    expect(formatCombo(combo({ key: 'escape' }))).toBe('Escape');
  });

  it('round-trips through parseCombo', () => {
    for (const stored of ['Tab', 'Shift+Tab', 'Ctrl+S', 'Escape', 'Ctrl+Alt+Delete', 'F2']) {
      expect(formatCombo(parseCombo(stored)!)).toBe(stored);
    }
  });
});

describe('matchesCombo', () => {
  it('matches the default combos', () => {
    expect(matchesCombo('Tab', keyEvent({ key: 'Tab' }))).toBe(true);
    expect(matchesCombo('Shift+Tab', keyEvent({ key: 'Tab', shiftKey: true }))).toBe(true);
    expect(matchesCombo('Ctrl+S', keyEvent({ key: 's', ctrlKey: true }))).toBe(true);
    expect(matchesCombo('Escape', keyEvent({ key: 'Escape' }))).toBe(true);
  });

  it('treats Cmd as Ctrl for mac users', () => {
    expect(matchesCombo('Ctrl+S', keyEvent({ key: 's', metaKey: true }))).toBe(true);
  });

  it('requires modifiers to match exactly', () => {
    // Plain Tab is not Shift+Tab and vice versa.
    expect(matchesCombo('Shift+Tab', keyEvent({ key: 'Tab' }))).toBe(false);
    expect(matchesCombo('Tab', keyEvent({ key: 'Tab', shiftKey: true }))).toBe(false);
    // Extra modifiers disqualify: Ctrl+Shift+Tab is not Shift+Tab.
    expect(matchesCombo('Shift+Tab', keyEvent({ key: 'Tab', shiftKey: true, ctrlKey: true }))).toBe(false);
    // Ctrl+Shift+S is not Ctrl+S.
    expect(matchesCombo('Ctrl+S', keyEvent({ key: 's', ctrlKey: true, shiftKey: true }))).toBe(false);
    // Plain S is not Ctrl+S.
    expect(matchesCombo('Ctrl+S', keyEvent({ key: 's' }))).toBe(false);
    // Different key.
    expect(matchesCombo('Ctrl+S', keyEvent({ key: 'd', ctrlKey: true }))).toBe(false);
  });

  it('never matches an unparseable combo', () => {
    expect(matchesCombo('bogus++', keyEvent({ key: 'Tab' }))).toBe(false);
  });
});

describe('comboFromEvent / isModifierKey', () => {
  it('captures combos from events', () => {
    expect(comboFromEvent(keyEvent({ key: 'Tab' }))).toEqual(combo({ key: 'tab' }));
    expect(comboFromEvent(keyEvent({ key: 'S', ctrlKey: true, shiftKey: true }))).toEqual(
      combo({ ctrl: true, shift: true, key: 's' }),
    );
  });

  it('ignores bare modifier presses so recording can wait for the real key', () => {
    for (const key of ['Control', 'Shift', 'Alt', 'Meta']) {
      expect(comboFromEvent(keyEvent({ key, ctrlKey: true }))).toBeNull();
      expect(isModifierKey(key)).toBe(true);
    }
    expect(isModifierKey('A')).toBe(false);
  });
});

describe('validateComboForBinding', () => {
  const others = ['Tab', 'Ctrl+S'];

  it('accepts the defaults and modifier-backed printables', () => {
    expect(validateComboForBinding(combo({ key: 'escape' }), others)).toBe('ok');
    expect(validateComboForBinding(combo({ shift: true, key: 'tab' }), others)).toBe('ok');
    expect(validateComboForBinding(combo({ ctrl: true, key: 'd' }), others)).toBe('ok');
    expect(validateComboForBinding(combo({ key: 'f5' }), others)).toBe('ok');
    expect(validateComboForBinding(combo({ key: 'pagedown' }), others)).toBe('ok');
  });

  it('rejects bare printable keys — they must stay typable in the edit input', () => {
    expect(validateComboForBinding(combo({ key: 'j' }), others)).toBe('invalid');
    expect(validateComboForBinding(combo({ shift: true, key: 'j' }), others)).toBe('invalid');
  });

  it('rejects keys the edit input or Enter-commit semantics own', () => {
    expect(validateComboForBinding(combo({ key: 'enter' }), others)).toBe('invalid');
    expect(validateComboForBinding(combo({ key: ' ' }), others)).toBe('invalid');
    expect(validateComboForBinding(combo({ key: 'arrowdown' }), others)).toBe('invalid');
    expect(validateComboForBinding(combo({ key: 'backspace' }), others)).toBe('invalid');
  });

  it('rejects browser-reserved combos the page cannot intercept', () => {
    expect(validateComboForBinding(combo({ ctrl: true, key: 'w' }), others)).toBe('reserved');
    expect(validateComboForBinding(combo({ ctrl: true, key: 't' }), others)).toBe('reserved');
    expect(validateComboForBinding(combo({ ctrl: true, key: 'n' }), others)).toBe('reserved');
    // Without the Ctrl/Cmd modifier the same letters are just unbindable
    // printables, not reserved.
    expect(validateComboForBinding(combo({ key: 'w' }), others)).toBe('invalid');
  });

  it('flags combos already bound to another action (exact, modifier-aware)', () => {
    expect(validateComboForBinding(combo({ key: 'tab' }), others)).toBe('conflict');
    expect(validateComboForBinding(combo({ ctrl: true, key: 's' }), others)).toBe('conflict');
    // Shift+Tab is not Tab — no conflict.
    expect(validateComboForBinding(combo({ shift: true, key: 'tab' }), others)).toBe('ok');
  });
});
