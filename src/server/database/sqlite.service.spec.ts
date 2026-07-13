import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { SqliteService } from './sqlite.service';

describe('SQLite reusable-deck migration', () => {
  const directories: string[] = [];
  afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

  it('imports legacy membership and relationships exactly once', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kiwi-deck-migration-'));
    directories.push(directory);
    const path = join(directory, 'test.db');
    const setup = new SqliteService(path);
    setup.prepare('DELETE FROM schema_migrations WHERE id = ?').run('reusable-decks-v1');
    setup.prepare('INSERT INTO decks(id, class_id, owner_user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('deck-1', 'class-1', 'user-1', 'Legacy', '2025-01-01', '2025-01-01');
    for (const [id, created] of [['card-1', '2025-01-01'], ['card-2', '2025-01-02']]) {
      setup.prepare('INSERT INTO cards(id, class_id, owner_user_id, deck_id, question, answer, concepts, tags, review_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, 'class-1', 'user-1', 'deck-1', `Question ${id}`, 'Answer', '[]', '[]', 0, created, created);
    }
    setup.prepare('INSERT INTO card_links(id, class_id, owner_user_id, deck_id, source_card_id, target_card_id, relationship, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('link-1', 'class-1', 'user-1', 'deck-1', 'card-1', 'card-2', 'related', '2025-01-03');
    setup.close();

    const migrated = new SqliteService(path);
    assert.equal((migrated.prepare('SELECT COUNT(*) AS count FROM deck_cards').get() as any).count, 2);
    assert.equal((migrated.prepare('SELECT COUNT(*) AS count FROM card_relationships').get() as any).count, 1);
    migrated.prepare('DELETE FROM deck_cards WHERE card_id = ?').run('card-1');
    migrated.prepare('DELETE FROM card_relationships WHERE id = ?').run('link-1');
    migrated.close();

    const reopened = new SqliteService(path);
    assert.equal((reopened.prepare('SELECT COUNT(*) AS count FROM deck_cards').get() as any).count, 1);
    assert.equal((reopened.prepare('SELECT COUNT(*) AS count FROM card_relationships').get() as any).count, 0);
    reopened.close();
  });

  it('converts typed relationships into one explained undirected pair', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kiwi-link-migration-'));
    directories.push(directory);
    const path = join(directory, 'test.db');
    const setup = new SqliteService(path);
    setup.prepare('INSERT INTO cards(id, class_id, owner_user_id, question, answer, concepts, tags, review_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('card-a', 'class-1', 'user-1', 'A?', 'A', '[]', '[]', 0, '2025-01-01', '2025-01-01');
    setup.prepare('INSERT INTO cards(id, class_id, owner_user_id, question, answer, concepts, tags, review_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('card-b', 'class-1', 'user-1', 'B?', 'B', '[]', '[]', 0, '2025-01-01', '2025-01-01');
    setup.database.exec(`
      DROP TABLE card_relationships;
      CREATE TABLE card_relationships (
        id TEXT PRIMARY KEY, class_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
        source_card_id TEXT NOT NULL, target_card_id TEXT NOT NULL,
        relationship TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL
      );
    `);
    setup.prepare('INSERT INTO card_relationships VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('old-1', 'class-1', 'user-1', 'card-b', 'card-a', 'contrast', 'A and B take different approaches.', '2025-01-02');
    setup.prepare('INSERT INTO card_relationships VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('old-2', 'class-1', 'user-1', 'card-a', 'card-b', 'related', '', '2025-01-03');
    setup.close();

    const migrated = new SqliteService(path);
    const rows = migrated.prepare('SELECT * FROM card_relationships').all() as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source_card_id, 'card-a');
    assert.equal(rows[0].target_card_id, 'card-b');
    assert.equal(rows[0].explanation, 'A and B take different approaches.');
    migrated.close();
  });
});
