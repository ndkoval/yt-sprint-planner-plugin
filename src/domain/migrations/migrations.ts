/**
 * Schema migration framework. See §20.2.
 *
 * Every persisted JSON document carries a `version`. Migrations are:
 *   - sequential   (v_n → v_{n+1}, never skipping)
 *   - idempotent   (running an already-current doc is a no-op)
 *   - fail-safe    (unknown fields preserved; a throwing migration aborts the chain)
 *   - pure         (returns a new object; never mutates input)
 *
 * The backend takes a backup before writing the migrated result (§20.2), which is an
 * I/O concern handled by the repository layer, not here.
 */

/** A document that at minimum declares its schema version. */
export interface Versioned {
  version: number;
  [key: string]: unknown;
}

/** A single step from `fromVersion` to `fromVersion + 1`. */
export interface Migration<T extends Versioned = Versioned> {
  fromVersion: number;
  /** Transform a v_{fromVersion} document into a v_{fromVersion+1} document. */
  up: (doc: T) => T;
}

/**
 * Run the ordered migration chain to bring `doc` up to `targetVersion`.
 * Throws if a required step is missing or a step produces the wrong version.
 */
export function migrate<T extends Versioned>(
  doc: T,
  targetVersion: number,
  migrations: readonly Migration<T>[],
): T {
  if (typeof doc.version !== 'number') {
    throw new TypeError('document has no numeric version');
  }
  if (doc.version > targetVersion) {
    throw new RangeError(
      `document version ${doc.version} is newer than target ${targetVersion}; ` +
        'downgrade is not supported',
    );
  }

  // Index steps by their fromVersion for O(1) lookup and to detect duplicates.
  const byFrom = new Map<number, Migration<T>>();
  for (const m of migrations) {
    if (byFrom.has(m.fromVersion)) {
      throw new Error(`duplicate migration from version ${m.fromVersion}`);
    }
    byFrom.set(m.fromVersion, m);
  }

  let current = doc;
  while (current.version < targetVersion) {
    const step = byFrom.get(current.version);
    if (!step) {
      throw new Error(`missing migration from version ${current.version}`);
    }
    const next = step.up(current);
    if (next.version !== current.version + 1) {
      throw new Error(
        `migration from ${current.version} produced version ${next.version}, expected ${
          current.version + 1
        }`,
      );
    }
    current = next;
  }
  return current;
}
