import { describe, expect, it } from 'vitest';
import { fieldNameError, findDuplicateFieldNames } from './fieldName';

describe('fieldNameError (issue #9 JSON key validation)', () => {
  it('accepts valid snake_case identifiers', () => {
    expect(fieldNameError('name')).toBeNull();
    expect(fieldNameError('full_name')).toBeNull();
    expect(fieldNameError('email2')).toBeNull();
    expect(fieldNameError('a')).toBeNull();
  });

  it('rejects non-snake_case formats', () => {
    expect(fieldNameError('Name')).toBe('invalid');
    expect(fieldNameError('first name')).toBe('invalid');
    expect(fieldNameError('first-name')).toBe('invalid');
    expect(fieldNameError('1st')).toBe('invalid');
    expect(fieldNameError('姓名')).toBe('invalid');
    expect(fieldNameError('')).toBe('invalid');
  });

  it('rejects Python keywords as reserved', () => {
    expect(fieldNameError('class')).toBe('reserved');
    expect(fieldNameError('import')).toBe('reserved');
    expect(fieldNameError('lambda')).toBe('reserved');
  });

  it('rejects the pydantic model_ prefix as reserved', () => {
    expect(fieldNameError('model_version')).toBe('reserved');
  });

  it('rejects the _confidence suffix (auto twin field) as reserved', () => {
    expect(fieldNameError('score_confidence')).toBe('reserved');
  });
});

describe('findDuplicateFieldNames', () => {
  it('returns names used by more than one field', () => {
    const fields = [
      { fieldName: 'email' },
      { fieldName: 'name' },
      { fieldName: 'email' },
    ];
    expect(findDuplicateFieldNames(fields)).toEqual(new Set(['email']));
  });

  it('returns an empty set when all names are unique', () => {
    const fields = [{ fieldName: 'email' }, { fieldName: 'name' }];
    expect(findDuplicateFieldNames(fields).size).toBe(0);
  });

  it('ignores null (auto-generate) field names', () => {
    const fields = [{ fieldName: null }, { fieldName: null }, { fieldName: 'email' }];
    expect(findDuplicateFieldNames(fields).size).toBe(0);
  });
});
