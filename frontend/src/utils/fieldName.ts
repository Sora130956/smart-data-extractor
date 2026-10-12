// Issue #9: shared field-name (JSON key) validation, mirroring the backend's
// `_validate_identifier` rules in extraction/schema_resolve.py so user-edited
// keys are rejected inline before submission. The backend re-checks as
// defense in depth; these rules must stay in sync with it.

/** Mirrors the backend regex `^[a-z][a-z0-9_]*$`. */
const IDENTIFIER_RE = /^[a-z][a-z0-9_]*$/;

/** Python's `keyword.iskeyword` set (matches the backend check exactly). */
const PYTHON_KEYWORDS = new Set([
  'false', 'none', 'true', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
  'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]);

export type FieldNameError = 'invalid' | 'reserved';

/** Validate one non-empty field name. Null fieldName (auto-generate) is
 * never passed here; an empty string fails the format check defensively. */
export function fieldNameError(name: string): FieldNameError | null {
  if (!IDENTIFIER_RE.test(name)) return 'invalid';
  // Reserved: collides with the auto-generated "<name>_confidence" twin,
  // pydantic's protected "model_" namespace, or a Python keyword that would
  // break create_model.
  if (name.endsWith('_confidence') || name.startsWith('model_') || PYTHON_KEYWORDS.has(name)) {
    return 'reserved';
  }
  return null;
}

/** Names used by more than one field (null = auto-generate, never a dupe). */
export function findDuplicateFieldNames(fields: Array<{ fieldName: string | null }>): Set<string> {
  const counts = new Map<string, number>();
  for (const f of fields) {
    if (f.fieldName == null) continue;
    counts.set(f.fieldName, (counts.get(f.fieldName) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name));
}
