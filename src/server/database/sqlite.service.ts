import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const schema = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS decks (
    id TEXT PRIMARY KEY,
    class_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    visibility TEXT NOT NULL DEFAULT 'personal',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    class_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'personal',
    deck_id TEXT REFERENCES decks(id) ON DELETE SET NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    concepts TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    pdf_id TEXT,
    page_number INTEGER,
    material_type TEXT,
    source_content TEXT,
    difficulty_rating INTEGER,
    confidence INTEGER,
    review_count INTEGER NOT NULL DEFAULT 0,
    last_reviewed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS review_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    class_id TEXT NOT NULL,
    deck_id TEXT REFERENCES decks(id) ON DELETE SET NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES review_sessions(id) ON DELETE SET NULL,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    class_id TEXT NOT NULL,
    is_correct INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS card_links (
    id TEXT PRIMARY KEY,
    class_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    source_card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    target_card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    relationship TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(owner_user_id, deck_id, source_card_id, target_card_id, relationship)
  );

  CREATE TABLE IF NOT EXISTS deck_cards (
    deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    added_at TEXT NOT NULL,
    PRIMARY KEY(deck_id, card_id)
  );

  CREATE TABLE IF NOT EXISTS card_relationships (
    id TEXT PRIMARY KEY,
    class_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    source_card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    target_card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    explanation TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(owner_user_id, class_id, source_card_id, target_card_id)
  );

  CREATE INDEX IF NOT EXISTS cards_owner_class_idx ON cards(class_id, owner_user_id);
  CREATE INDEX IF NOT EXISTS cards_deck_idx ON cards(deck_id);
  CREATE INDEX IF NOT EXISTS cards_pdf_idx ON cards(pdf_id);
  CREATE INDEX IF NOT EXISTS decks_owner_class_idx ON decks(class_id, owner_user_id);
  CREATE INDEX IF NOT EXISTS sessions_owner_class_idx ON review_sessions(class_id, user_id);
  CREATE INDEX IF NOT EXISTS sessions_deck_idx ON review_sessions(deck_id);
  CREATE INDEX IF NOT EXISTS reviews_owner_class_idx ON reviews(class_id, user_id);
  CREATE INDEX IF NOT EXISTS reviews_card_idx ON reviews(card_id);
  CREATE INDEX IF NOT EXISTS reviews_session_idx ON reviews(session_id);
  CREATE INDEX IF NOT EXISTS card_links_owner_deck_idx ON card_links(owner_user_id, deck_id);
  CREATE INDEX IF NOT EXISTS card_links_source_idx ON card_links(source_card_id);
  CREATE INDEX IF NOT EXISTS card_links_target_idx ON card_links(target_card_id);
  CREATE INDEX IF NOT EXISTS deck_cards_card_idx ON deck_cards(card_id);
  CREATE INDEX IF NOT EXISTS deck_cards_order_idx ON deck_cards(deck_id, position);
  CREATE INDEX IF NOT EXISTS card_relationships_owner_class_idx ON card_relationships(owner_user_id, class_id);
  CREATE INDEX IF NOT EXISTS card_relationships_source_idx ON card_relationships(source_card_id);
  CREATE INDEX IF NOT EXISTS card_relationships_target_idx ON card_relationships(target_card_id);
`;

const migrateLegacyDeckData = `
  INSERT OR IGNORE INTO deck_cards(deck_id, card_id, position, added_at)
  SELECT c.deck_id, c.id,
    (SELECT COUNT(*) FROM cards earlier
      WHERE earlier.deck_id = c.deck_id
        AND (earlier.created_at < c.created_at OR (earlier.created_at = c.created_at AND earlier.id < c.id))),
    c.created_at
  FROM cards c
  WHERE c.deck_id IS NOT NULL;

  INSERT OR IGNORE INTO card_relationships(
    id, class_id, owner_user_id, source_card_id, target_card_id, explanation, created_at
  )
  SELECT id, class_id, owner_user_id,
    CASE WHEN source_card_id < target_card_id THEN source_card_id ELSE target_card_id END,
    CASE WHEN source_card_id < target_card_id THEN target_card_id ELSE source_card_id END,
    COALESCE(NULLIF(reason, ''), 'These two cards share a meaningful conceptual connection.'), created_at
  FROM card_links
  WHERE source_card_id <> target_card_id;
`;

export class SqliteService {
  readonly database: DatabaseSync;

  constructor(path = process.env.DATABASE_PATH || 'data/flashcards.db') {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.database = new DatabaseSync(path, { timeout: 5_000 });
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    this.database.exec(schema);
    const migrated = this.database.prepare('SELECT id FROM schema_migrations WHERE id = ?').get('reusable-decks-v1');
    if (!migrated) {
      this.database.exec('BEGIN IMMEDIATE');
      try {
        this.database.exec(migrateLegacyDeckData);
        this.database.prepare('INSERT INTO schema_migrations(id, applied_at) VALUES (?, ?)')
          .run('reusable-decks-v1', new Date().toISOString());
        this.database.exec('COMMIT');
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      }
    }
    this.migrateRelationshipExplanations();
    this.migrateClassDecks();
  }

  prepare(sql: string): StatementSync {
    return this.database.prepare(sql);
  }

  transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.database.close();
  }

  private migrateRelationshipExplanations() {
    const columns = this.database.prepare('PRAGMA table_info(card_relationships)').all() as Array<Record<string, unknown>>;
    if (columns.some((column) => column.name === 'explanation')) return;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.exec(`
        ALTER TABLE card_relationships RENAME TO legacy_card_relationships_v1;
        CREATE TABLE card_relationships (
          id TEXT PRIMARY KEY,
          class_id TEXT NOT NULL,
          owner_user_id TEXT NOT NULL,
          source_card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
          target_card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
          explanation TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(owner_user_id, class_id, source_card_id, target_card_id)
        );
        INSERT OR IGNORE INTO card_relationships(
          id, class_id, owner_user_id, source_card_id, target_card_id, explanation, created_at
        )
        SELECT id, class_id, owner_user_id,
          CASE WHEN source_card_id < target_card_id THEN source_card_id ELSE target_card_id END,
          CASE WHEN source_card_id < target_card_id THEN target_card_id ELSE source_card_id END,
          COALESCE(NULLIF(reason, ''), 'These two cards share a meaningful conceptual connection.'), created_at
        FROM legacy_card_relationships_v1
        WHERE source_card_id <> target_card_id;
        DROP TABLE legacy_card_relationships_v1;
        CREATE INDEX IF NOT EXISTS card_relationships_owner_class_idx ON card_relationships(owner_user_id, class_id);
        CREATE INDEX IF NOT EXISTS card_relationships_source_idx ON card_relationships(source_card_id);
        CREATE INDEX IF NOT EXISTS card_relationships_target_idx ON card_relationships(target_card_id);
      `);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private migrateClassDecks() {
    const deckColumns = this.database.prepare('PRAGMA table_info(decks)').all() as Array<Record<string, unknown>>;
    const cardColumns = this.database.prepare('PRAGMA table_info(cards)').all() as Array<Record<string, unknown>>;
    if (!deckColumns.some((column) => column.name === 'visibility')) {
      this.database.exec("ALTER TABLE decks ADD COLUMN visibility TEXT NOT NULL DEFAULT 'personal'");
    }
    if (!cardColumns.some((column) => column.name === 'visibility')) {
      this.database.exec("ALTER TABLE cards ADD COLUMN visibility TEXT NOT NULL DEFAULT 'personal'");
    }
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS decks_class_visibility_idx ON decks(class_id, visibility);
      CREATE INDEX IF NOT EXISTS cards_class_visibility_idx ON cards(class_id, visibility);
    `);
  }
}
