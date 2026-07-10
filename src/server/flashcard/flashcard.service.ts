import { randomUUID } from 'node:crypto';
import type { AppRequestContext } from '../auth/app-token.types';
import { SqliteService } from '../database/sqlite.service';
import { HttpError } from '../http-error';
import type { CreateCardDto, CreateCardsDto, CreateDeckDto, GenerateCardsDto, RecordReviewDto, StartSessionDto, UpdateCardDto } from './dto';
import { KiwiMcpService } from './kiwi-mcp.service';

type Row = Record<string, unknown>;

export class FlashcardService {
  constructor(
    private readonly sqlite: SqliteService,
    private readonly kiwiMcp: KiwiMcpService,
  ) {}

  async listCards(ctx: AppRequestContext) {
    return this.findCards(ctx);
  }

  async searchCards(ctx: AppRequestContext, query: string) {
    const normalized = query.toLocaleLowerCase();
    return this.findCards(ctx).filter((card) =>
      card.question.toLocaleLowerCase().includes(normalized)
      || card.answer.toLocaleLowerCase().includes(normalized)
      || card.concepts.includes(query)
      || card.tags.includes(query));
  }

  async createCard(ctx: AppRequestContext, dto: CreateCardDto) {
    if (dto.deckId) this.assertDeckOwned(ctx, dto.deckId);
    return this.insertCard(ctx, dto);
  }

  async createCards(ctx: AppRequestContext, dto: CreateCardsDto) {
    for (const card of dto.cards) {
      if (card.deckId) this.assertDeckOwned(ctx, card.deckId);
    }
    return this.sqlite.transaction(() => dto.cards.map((card) => this.insertCard(ctx, card)));
  }

  async updateCard(ctx: AppRequestContext, id: string, dto: UpdateCardDto) {
    this.assertCardOwned(ctx, id);
    if (dto.deckId) this.assertDeckOwned(ctx, dto.deckId);

    const fields = ['question = ?', 'answer = ?', 'updated_at = ?'];
    const values: unknown[] = [dto.question, dto.answer, new Date().toISOString()];
    const optionalFields: Array<[keyof UpdateCardDto, string, (value: unknown) => unknown]> = [
      ['deckId', 'deck_id', (value) => value],
      ['concepts', 'concepts', (value) => JSON.stringify(value)],
      ['tags', 'tags', (value) => JSON.stringify(value)],
      ['pdfId', 'pdf_id', (value) => value],
      ['pageNumber', 'page_number', (value) => value],
      ['materialType', 'material_type', (value) => value],
      ['sourceContent', 'source_content', (value) => value],
      ['difficultyRating', 'difficulty_rating', (value) => value],
      ['confidence', 'confidence', (value) => value],
    ];

    for (const [key, column, serialize] of optionalFields) {
      if (dto[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push(serialize(dto[key]));
      }
    }

    values.push(id);
    this.sqlite.prepare(`UPDATE cards SET ${fields.join(', ')} WHERE id = ?`).run(...values as any[]);
    return this.getCard(id)!;
  }

  async deleteCard(ctx: AppRequestContext, id: string) {
    this.assertCardOwned(ctx, id);
    this.sqlite.prepare('DELETE FROM cards WHERE id = ?').run(id);
    return { message: 'Card deleted successfully' };
  }

  async generateCards(ctx: AppRequestContext, dto: GenerateCardsDto) {
    if (dto.deckId) this.assertDeckOwned(ctx, dto.deckId);
    return this.kiwiMcp.generateCards(ctx.token, ctx.appSlug, dto.sourceContent, dto.count || 3);
  }

  async generateMcq(ctx: AppRequestContext, id: string, numChoices = 4) {
    const card = this.assertCardOwned(ctx, id);
    return this.kiwiMcp.generateMcq(ctx.token, ctx.appSlug, card, numChoices);
  }

  async stats(ctx: AppRequestContext) {
    const cards = this.findCards(ctx);
    const reviewed = cards.filter((card) => card.reviewCount > 0).length;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return {
      total: cards.length,
      reviewed,
      recentlyCreated: cards.filter((card) => Date.parse(card.createdAt) > sevenDaysAgo).length,
    };
  }

  async listDecks(ctx: AppRequestContext) {
    const rows = this.sqlite.prepare(`
      SELECT * FROM decks WHERE owner_user_id = ? AND class_id = ? ORDER BY created_at DESC
    `).all(ctx.userId, ctx.classId) as Row[];
    return rows.map((row) => {
      const deck = toDeck(row);
      return { ...deck, cards: this.findCards(ctx, deck.id) };
    });
  }

  async createDeck(ctx: AppRequestContext, dto: CreateDeckDto) {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.sqlite.prepare(`
      INSERT INTO decks (id, class_id, owner_user_id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, ctx.classId, ctx.userId, dto.name, dto.description ?? null, now, now);
    return { ...toDeck(this.getDeckRow(id)), cards: [] };
  }

  async addCardToDeck(ctx: AppRequestContext, deckId: string, cardId: string) {
    this.assertDeckOwned(ctx, deckId);
    this.assertCardOwned(ctx, cardId);
    this.sqlite.prepare('UPDATE cards SET deck_id = ?, updated_at = ? WHERE id = ?')
      .run(deckId, new Date().toISOString(), cardId);
    return this.getCard(cardId)!;
  }

  async startSession(ctx: AppRequestContext, dto: StartSessionDto) {
    if (dto.deckId) this.assertDeckOwned(ctx, dto.deckId);
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    this.sqlite.prepare(`
      INSERT INTO review_sessions (id, user_id, class_id, deck_id, started_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, ctx.userId, ctx.classId, dto.deckId ?? null, startedAt);
    return toSession(this.getSessionRow(id));
  }

  async endSession(ctx: AppRequestContext, sessionId: string) {
    this.assertSessionOwned(ctx, sessionId, 404);
    this.sqlite.prepare('UPDATE review_sessions SET ended_at = ? WHERE id = ?')
      .run(new Date().toISOString(), sessionId);
    const reviews = this.sqlite.prepare('SELECT * FROM reviews WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId) as Row[];
    return { ...toSession(this.getSessionRow(sessionId)), reviews: reviews.map(toReview) };
  }

  async recordReview(ctx: AppRequestContext, dto: RecordReviewDto) {
    this.assertCardOwned(ctx, dto.cardId);
    if (dto.sessionId) this.assertSessionOwned(ctx, dto.sessionId, 403);

    return this.sqlite.transaction(() => {
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      this.sqlite.prepare(`
        INSERT INTO reviews (id, session_id, card_id, user_id, class_id, is_correct, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, dto.sessionId ?? null, dto.cardId, ctx.userId, ctx.classId, dto.isCorrect ? 1 : 0, createdAt);
      this.sqlite.prepare(`
        UPDATE cards SET review_count = review_count + 1, last_reviewed_at = ?, updated_at = ? WHERE id = ?
      `).run(createdAt, createdAt, dto.cardId);
      return toReview(this.getReviewRow(id));
    });
  }

  private findCards(ctx: AppRequestContext, deckId?: string) {
    const deckClause = deckId ? ' AND deck_id = ?' : '';
    const values = deckId ? [ctx.userId, ctx.classId, deckId] : [ctx.userId, ctx.classId];
    const rows = this.sqlite.prepare(`
      SELECT * FROM cards
      WHERE owner_user_id = ? AND class_id = ?${deckClause}
      ORDER BY created_at DESC
    `).all(...values) as Row[];
    return rows.map(toCard);
  }

  private insertCard(ctx: AppRequestContext, dto: CreateCardDto) {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.sqlite.prepare(`
      INSERT INTO cards (
        id, class_id, owner_user_id, deck_id, question, answer, concepts, tags,
        pdf_id, page_number, material_type, source_content, difficulty_rating,
        confidence, review_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id, ctx.classId, ctx.userId, dto.deckId ?? null, dto.question, dto.answer,
      JSON.stringify(dto.concepts || []), JSON.stringify(dto.tags || []), dto.pdfId ?? null,
      dto.pageNumber ?? null, dto.materialType ?? null, dto.sourceContent ?? null,
      dto.difficultyRating ?? null, dto.confidence ?? null, now, now,
    );
    return this.getCard(id)!;
  }

  private assertCardOwned(ctx: AppRequestContext, id: string) {
    const card = this.getCard(id);
    if (!card || card.ownerUserId !== ctx.userId || card.classId !== ctx.classId) {
      throw new HttpError(404, 'Card not found');
    }
    return card;
  }

  private assertDeckOwned(ctx: AppRequestContext, id: string) {
    const row = this.sqlite.prepare('SELECT * FROM decks WHERE id = ?').get(id) as Row | undefined;
    if (!row || row.owner_user_id !== ctx.userId || row.class_id !== ctx.classId) {
      throw new HttpError(404, 'Deck not found');
    }
    return toDeck(row);
  }

  private assertSessionOwned(ctx: AppRequestContext, id: string, status: 403 | 404) {
    const row = this.sqlite.prepare('SELECT * FROM review_sessions WHERE id = ?').get(id) as Row | undefined;
    if (!row || row.user_id !== ctx.userId || row.class_id !== ctx.classId) {
      throw new HttpError(status, status === 404
        ? 'Review session not found'
        : 'Review session does not belong to this user and class');
    }
    return toSession(row);
  }

  private getCard(id: string) {
    const row = this.sqlite.prepare('SELECT * FROM cards WHERE id = ?').get(id) as Row | undefined;
    return row ? toCard(row) : undefined;
  }

  private getDeckRow(id: string): Row {
    return this.sqlite.prepare('SELECT * FROM decks WHERE id = ?').get(id) as Row;
  }

  private getSessionRow(id: string): Row {
    return this.sqlite.prepare('SELECT * FROM review_sessions WHERE id = ?').get(id) as Row;
  }

  private getReviewRow(id: string): Row {
    return this.sqlite.prepare('SELECT * FROM reviews WHERE id = ?').get(id) as Row;
  }
}

function toCard(row: Row) {
  return {
    id: String(row.id),
    classId: String(row.class_id),
    ownerUserId: String(row.owner_user_id),
    deckId: nullableString(row.deck_id),
    question: String(row.question),
    answer: String(row.answer),
    concepts: stringArray(row.concepts),
    tags: stringArray(row.tags),
    pdfId: nullableString(row.pdf_id),
    pageNumber: nullableNumber(row.page_number),
    materialType: nullableString(row.material_type),
    sourceContent: nullableString(row.source_content),
    difficultyRating: nullableNumber(row.difficulty_rating),
    confidence: nullableNumber(row.confidence),
    reviewCount: Number(row.review_count),
    lastReviewedAt: nullableString(row.last_reviewed_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toDeck(row: Row) {
  return {
    id: String(row.id),
    classId: String(row.class_id),
    ownerUserId: String(row.owner_user_id),
    name: String(row.name),
    description: nullableString(row.description),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toSession(row: Row) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    classId: String(row.class_id),
    deckId: nullableString(row.deck_id),
    startedAt: String(row.started_at),
    endedAt: nullableString(row.ended_at),
  };
}

function toReview(row: Row) {
  return {
    id: String(row.id),
    sessionId: nullableString(row.session_id),
    cardId: String(row.card_id),
    userId: String(row.user_id),
    classId: String(row.class_id),
    isCorrect: Boolean(row.is_correct),
    createdAt: String(row.created_at),
  };
}

function stringArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
