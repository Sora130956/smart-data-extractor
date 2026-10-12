// Issue #5: configurable keyboard shortcuts for the field-review flow.
// Pure parsing/matching helpers shared by the review modal (dispatch) and
// the settings panel (recording + validation). Combos are stored as
// canonical strings ("Tab", "Shift+Tab", "Ctrl+S", "Escape") in
// localStorage via the ui store.
//
// "Ctrl" in a combo matches either Ctrl (Windows/Linux) or Meta/Cmd (macOS)
// — Mac users expect Cmd+S to save, not Ctrl+S.

export type ShortcutAction = 'nextField' | 'prevField' | 'saveNext' | 'cancelEdit';
export type ShortcutMap = Record<ShortcutAction, string>;

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  nextField: 'Tab',
  prevField: 'Shift+Tab',
  saveNext: 'Ctrl+S',
  cancelEdit: 'Escape',
};

/** Parsed key combo; `key` is the lowercase `KeyboardEvent.key`
 * ("tab", "s", "escape", "f5"). */
export interface KeyCombo {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

/** Minimal event shape so tests can pass plain objects. */
export interface ComboEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const MODIFIERS = new Set(['ctrl', 'alt', 'shift', 'meta']);

/** Multi-char key names KeyboardEvent.key can produce that make sense in a
 * combo. Anything else of length > 1 (junk data, "Dead", sentences…) is
 * rejected so bad localStorage payloads fall back to the defaults. */
const NAMED_KEYS = new Set([
  'tab',
  'enter',
  'escape',
  'backspace',
  'delete',
  'insert',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
  'home',
  'end',
  'pageup',
  'pagedown',
]);

function isKnownKey(key: string): boolean {
  return key.length === 1 || NAMED_KEYS.has(key) || /^f([1-9]|1[0-2])$/.test(key);
}

function normalizeKey(key: string): string {
  const lowered = key.trim().toLowerCase();
  // Legacy spelling some browsers/OSes report for Escape.
  return lowered === 'esc' ? 'escape' : lowered;
}

/** Parses a stored/displayed combo string. Returns null for anything
 * malformed: empty parts, unknown modifiers, or multiple non-modifier
 * keys ("Ctrl+A+B"). Case-insensitive; "meta" is folded into "ctrl". */
export function parseCombo(combo: string): KeyCombo | null {
  const parts = combo
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '');
  if (parts.length === 0) return null;
  const parsed: KeyCombo = { ctrl: false, alt: false, shift: false, key: '' };
  let keyCount = 0;
  for (const part of parts) {
    if (MODIFIERS.has(part)) {
      if (part === 'meta' || part === 'ctrl') {
        if (parsed.ctrl) return null; // duplicate modifier
        parsed.ctrl = true;
      } else if (part === 'alt') {
        if (parsed.alt) return null;
        parsed.alt = true;
      } else {
        if (parsed.shift) return null;
        parsed.shift = true;
      }
    } else {
      if (++keyCount > 1) return null;
      parsed.key = normalizeKey(part);
    }
  }
  if (keyCount !== 1) return null;
  return isKnownKey(parsed.key) ? parsed : null;
}

/** Canonical display/storage form: modifiers in Ctrl > Alt > Shift order,
 * then the key ("Tab", "Shift+Tab", "Ctrl+S", "F5", "Pageup"). */
export function formatCombo(combo: KeyCombo): string {
  const parts: string[] = [];
  if (combo.ctrl) parts.push('Ctrl');
  if (combo.alt) parts.push('Alt');
  if (combo.shift) parts.push('Shift');
  const key = combo.key.length === 1 ? combo.key.toUpperCase() : combo.key[0].toUpperCase() + combo.key.slice(1);
  parts.push(key);
  return parts.join('+');
}

/** Exact-match test: every modifier must be pressed (or released) exactly
 * as the combo specifies, so e.g. "Shift+Tab" does not match
 * Ctrl+Shift+Tab and "Tab" does not match Shift+Tab. */
export function matchesCombo(combo: string, e: ComboEvent): boolean {
  const parsed = parseCombo(combo);
  if (!parsed) return false;
  const ctrl = e.ctrlKey || e.metaKey;
  return (
    ctrl === parsed.ctrl &&
    e.altKey === parsed.alt &&
    e.shiftKey === parsed.shift &&
    normalizeKey(e.key) === parsed.key
  );
}

/** True for bare modifier presses ("Control", "Shift"…) — ignored while
 * recording, so the user can press modifiers before the actual key. */
export function isModifierKey(key: string): boolean {
  return ['control', 'shift', 'alt', 'meta'].includes(key.toLowerCase());
}

/** Captures the combo of a keydown event, or null while only modifiers
 * are held (keep recording). */
export function comboFromEvent(e: ComboEvent): KeyCombo | null {
  if (isModifierKey(e.key)) return null;
  return {
    ctrl: e.ctrlKey || e.metaKey,
    alt: e.altKey,
    shift: e.shiftKey,
    key: normalizeKey(e.key),
  };
}

export type BindingCheck = 'ok' | 'invalid' | 'reserved' | 'conflict';

/** Ctrl/Cmd combos the browser consumes before the page can see them. */
const BROWSER_RESERVED = new Set(['w', 't', 'n']);

/** Validates a recorded combo for binding:
 * - "invalid": bare printable keys (they must type into the edit input),
 *   input-navigation keys (Enter, arrows…), or empty combos;
 * - "reserved": Ctrl/Cmd+W/T/N — the browser eats them, the page can't;
 * - "conflict": already bound to one of `otherCombos`;
 * - "ok": bindable. Printable keys are only bindable with a Ctrl/Cmd
 *   modifier; Tab, Escape, F1–F12, and PageUp/PageDown work bare. */
export function validateComboForBinding(combo: KeyCombo, otherCombos: ReadonlyArray<string>): BindingCheck {
  if (combo.key === '') return 'invalid';
  const isFunctionKey = /^f([1-9]|1[0-2])$/.test(combo.key);
  const bareBindable = ['tab', 'escape', 'pageup', 'pagedown'].includes(combo.key) || isFunctionKey;
  const printable = combo.key.length === 1;
  if (printable && !combo.ctrl) return 'invalid'; // would collide with typing
  if (!printable && !bareBindable) return 'invalid'; // Enter, arrows, dead keys…
  if (combo.ctrl && BROWSER_RESERVED.has(combo.key)) return 'reserved';
  const formatted = formatCombo(combo);
  if (otherCombos.some((other) => parseCombo(other) !== null && formatCombo(parseCombo(other)!) === formatted)) {
    return 'conflict';
  }
  return 'ok';
}
