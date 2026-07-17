import { describe, it, expect } from 'vitest';
import { migrate, type Migration, type Versioned } from '../../src/domain/migrations/migrations.js';

interface Doc extends Versioned {
  version: number;
  payload?: unknown;
}

/** A step that just bumps the version (and records the hop). */
function bump(from: number): Migration<Doc> {
  return {
    fromVersion: from,
    up: (doc) => ({ ...doc, version: from + 1, [`step${from}`]: true }),
  };
}

describe('migrate', () => {
  it('is a no-op when already at the target version', () => {
    const doc: Doc = { version: 3, payload: 'x' };
    const result = migrate(doc, 3, [bump(1), bump(2)]);
    expect(result).toBe(doc);
  });

  it('applies a sequential chain of steps', () => {
    const doc: Doc = { version: 1 };
    const result = migrate(doc, 3, [bump(1), bump(2)]);
    expect(result.version).toBe(3);
    expect(result.step1).toBe(true);
    expect(result.step2).toBe(true);
  });

  it('preserves unknown fields through a migration', () => {
    const doc: Doc = { version: 1, payload: { keep: 'me' } };
    const result = migrate(doc, 2, [bump(1)]);
    expect(result.payload).toEqual({ keep: 'me' });
  });

  it('does not mutate the input document', () => {
    const doc: Doc = { version: 1, payload: 'x' };
    const snapshot = JSON.parse(JSON.stringify(doc));
    migrate(doc, 2, [bump(1)]);
    expect(doc).toEqual(snapshot);
  });

  it('throws when a required step is missing', () => {
    const doc: Doc = { version: 1 };
    expect(() => migrate(doc, 3, [bump(1)])).toThrow(/missing migration from version 2/);
  });

  it('throws on a duplicate fromVersion', () => {
    const doc: Doc = { version: 1 };
    expect(() => migrate(doc, 2, [bump(1), bump(1)])).toThrow(/duplicate migration from version 1/);
  });

  it('throws when a step produces the wrong output version', () => {
    const doc: Doc = { version: 1 };
    const bad: Migration<Doc> = { fromVersion: 1, up: (d) => ({ ...d, version: 5 }) };
    expect(() => migrate(doc, 2, [bad])).toThrow(/produced version 5, expected 2/);
  });

  it('throws on a downgrade (document newer than target)', () => {
    const doc: Doc = { version: 5 };
    expect(() => migrate(doc, 2, [])).toThrow(/downgrade is not supported/);
  });

  it('throws when the document has no numeric version', () => {
    const doc = { version: 'oops' } as unknown as Doc;
    expect(() => migrate(doc, 2, [])).toThrow(TypeError);
  });
});
