import { describe, expect, it } from 'vitest';
import { migrateMapFile } from '../../src/app/services/MapPersistence';

function legacyGrid(grid: Record<string, unknown>): unknown {
  return { grid: { enabled: true, size: 70, offsetX: 0, offsetY: 0, opacity: 0.7, ...grid } };
}

it('migrateMapFile grid numbering', () => {
  // reads an older hexNumbers field as cellNumbers
  {
    const migrated = migrateMapFile(legacyGrid({ hexNumbers: 'column-row' }));
    expect(migrated.grid?.cellNumbers).toBe('column-row');
  }

  // reads an older hexNumberOpacity field as cellNumberOpacity
  {
    const migrated = migrateMapFile(legacyGrid({ hexNumbers: 'column-row', hexNumberOpacity: 0.5 }));
    expect(migrated.grid?.cellNumberOpacity).toBe(0.5);
  }
});
