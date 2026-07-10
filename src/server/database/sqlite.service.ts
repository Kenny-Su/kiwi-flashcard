import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const schema = `
  CREATE TABLE IF NOT EXISTS decks (
    id TEXT PRIMARY KEY,
    class_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    class_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
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

  CREATE INDEX IF NOT EXISTS cards_owner_class_idx ON cards(class_id, owner_user_id);
  CREATE INDEX IF NOT EXISTS cards_deck_idx ON cards(deck_id);
  CREATE INDEX IF NOT EXISTS cards_pdf_idx ON cards(pdf_id);
  CREATE INDEX IF NOT EXISTS decks_owner_class_idx ON decks(class_id, owner_user_id);
  CREATE INDEX IF NOT EXISTS sessions_owner_class_idx ON review_sessions(class_id, user_id);
  CREATE INDEX IF NOT EXISTS sessions_deck_idx ON review_sessions(deck_id);
  CREATE INDEX IF NOT EXISTS reviews_owner_class_idx ON reviews(class_id, user_id);
  CREATE INDEX IF NOT EXISTS reviews_card_idx ON reviews(card_id);
  CREATE INDEX IF NOT EXISTS reviews_session_idx ON reviews(session_id);
`;

export class SqliteService {
  readonly database: DatabaseSync;

  constructor(path = process.env.DATABASE_PATH || 'data/flashcards.db') {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.database = new DatabaseSync(path, { timeout: 5_000 });
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    this.database.exec(schema);
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
}
