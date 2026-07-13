import { randomUUID } from 'node:crypto';
import type { AppRequestContext } from '../auth/app-token.types';
import { SqliteService } from '../database/sqlite.service';
import { HttpError } from '../http-error';
import type { CreateCardDto, CreateCardLinkDto, CreateCardLinksDto, CreateCardsDto, CreateDeckDto, ExplainCardLinkDto, GenerateCardsDto, RecordReviewDto, ReorderDeckCardsDto, StartSessionDto, SuggestCardLinksDto, UpdateCardDto, UpdateCardLinkDto, UpdateDeckDto } from './dto';
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
    const deckIds = this.requestedDeckIds(dto);
    deckIds.forEach((id) => this.assertDeckOwned(ctx, id));
    return this.sqlite.transaction(() => {
      const card = this.insertCard(ctx, dto);
      deckIds.forEach((deckId) => this.addMembership(deckId, card.id));
      return this.getCard(card.id)!;
    });
  }

  async createCards(ctx: AppRequestContext, dto: CreateCardsDto) {
    for (const card of dto.cards) {
      this.requestedDeckIds(card).forEach((id) => this.assertDeckOwned(ctx, id));
    }
    return this.sqlite.transaction(() => dto.cards.map((input) => {
      const card = this.insertCard(ctx, input);
      this.requestedDeckIds(input).forEach((deckId) => this.addMembership(deckId, card.id));
      return this.getCard(card.id)!;
    }));
  }

  async updateCard(ctx: AppRequestContext, id: string, dto: UpdateCardDto) {
    this.assertCardOwned(ctx, id);
    const membershipUpdate = dto.deckIds !== undefined || dto.deckId !== undefined;
    const deckIds = membershipUpdate ? this.requestedDeckIds(dto) : [];
    deckIds.forEach((deckId) => this.assertDeckOwned(ctx, deckId));

    const fields = ['question = ?', 'answer = ?', 'updated_at = ?'];
    const values: unknown[] = [dto.question, dto.answer, new Date().toISOString()];
    const optionalFields: Array<[keyof UpdateCardDto, string, (value: unknown) => unknown]> = [
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
    if (membershipUpdate) {
      this.sqlite.prepare('DELETE FROM deck_cards WHERE card_id = ?').run(id);
      deckIds.forEach((deckId) => this.addMembership(deckId, id));
    }
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

  async listCardLinks(ctx: AppRequestContext, deckId: string) {
    this.assertDeckOwned(ctx, deckId);
    const cardIds = new Set(this.findCards(ctx, deckId).map((card) => card.id));
    const rows = this.sqlite.prepare(`
      SELECT * FROM card_relationships
      WHERE owner_user_id = ? AND class_id = ?
      ORDER BY created_at ASC
    `).all(ctx.userId, ctx.classId) as Row[];
    return rows.filter((row) => cardIds.has(String(row.source_card_id)) && cardIds.has(String(row.target_card_id))).map(toCardLink);
  }

  async createCardLinks(ctx: AppRequestContext, dto: CreateCardLinksDto) {
    const checked = dto.links.map((input) => {
      const link = normalizeCardLink(input);
      const source = this.assertCardOwned(ctx, link.sourceCardId);
      const target = this.assertCardOwned(ctx, link.targetCardId);
      if (source.id === target.id) throw new HttpError(400, 'A card cannot link to itself');
      return link;
    });

    return this.sqlite.transaction(() => checked.map((link) => {
      const id = randomUUID();
      this.sqlite.prepare(`
        INSERT OR IGNORE INTO card_relationships (
          id, class_id, owner_user_id, source_card_id, target_card_id,
          explanation, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, ctx.classId, ctx.userId, link.sourceCardId, link.targetCardId,
        link.explanation.trim(), new Date().toISOString(),
      );
      const row = this.sqlite.prepare(`
        SELECT * FROM card_relationships WHERE owner_user_id = ? AND class_id = ?
          AND source_card_id = ? AND target_card_id = ?
      `).get(ctx.userId, ctx.classId, link.sourceCardId, link.targetCardId) as Row;
      return toCardLink(row);
    }));
  }

  async explainCardLink(ctx: AppRequestContext, dto: ExplainCardLinkDto) {
    const source = this.assertCardOwned(ctx, dto.sourceCardId);
    const target = this.assertCardOwned(ctx, dto.targetCardId);
    if (source.id === target.id) throw new HttpError(400, 'A card cannot link to itself');
    return { explanation: await this.kiwiMcp.explainCardLink(ctx.token, ctx.appSlug, source, target) };
  }

  async updateCardLink(ctx: AppRequestContext, id: string, dto: UpdateCardLinkDto) {
    const row = this.assertCardLinkOwned(ctx, id);
    this.sqlite.prepare('UPDATE card_relationships SET explanation = ? WHERE id = ?').run(dto.explanation.trim(), id);
    return toCardLink({ ...row, explanation: dto.explanation.trim() });
  }

  async deleteCardLink(ctx: AppRequestContext, id: string) {
    this.assertCardLinkOwned(ctx, id);
    this.sqlite.prepare('DELETE FROM card_relationships WHERE id = ?').run(id);
    return { message: 'Card link deleted successfully' };
  }

  async suggestCardLinks(ctx: AppRequestContext, dto: SuggestCardLinksDto) {
    this.assertDeckOwned(ctx, dto.deckId);
    const cards = this.findCards(ctx, dto.deckId);
    if (cards.length < 2) throw new HttpError(400, 'Add at least two cards to this deck before generating relationships');
    const cardIds = new Set(cards.map((card) => card.id));
    const existing = new Set((await this.listCardLinks(ctx, dto.deckId)).map(cardLinkKey));
    const suggestions = await this.kiwiMcp.suggestCardLinks(ctx.token, ctx.appSlug, cards.map((card) => ({
      id: card.id, question: card.question, answer: card.answer,
    })));
    const seen = new Set<string>();
    return suggestions.filter((link) => {
      const key = cardLinkKey(link);
      if (!cardIds.has(link.sourceCardId) || !cardIds.has(link.targetCardId) || link.sourceCardId === link.targetCardId) return false;
      if (existing.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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
      const last = this.sqlite.prepare('SELECT MAX(started_at) AS last_studied_at FROM review_sessions WHERE user_id = ? AND class_id = ? AND deck_id = ?')
        .get(ctx.userId, ctx.classId, deck.id) as Row;
      return { ...deck, cards: this.findCards(ctx, deck.id), lastStudiedAt: nullableString(last.last_studied_at) };
    });
  }

  async createDeck(ctx: AppRequestContext, dto: CreateDeckDto) {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.sqlite.prepare(`
      INSERT INTO decks (id, class_id, owner_user_id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, ctx.classId, ctx.userId, dto.name, dto.description ?? null, now, now);
    return { ...toDeck(this.getDeckRow(id)), cards: [], lastStudiedAt: null };
  }

  async updateDeck(ctx: AppRequestContext, id: string, dto: UpdateDeckDto) {
    this.assertDeckOwned(ctx, id);
    const fields = ['updated_at = ?'];
    const values: unknown[] = [new Date().toISOString()];
    if (dto.name !== undefined) {
      fields.push('name = ?');
      values.push(dto.name);
    }
    if (dto.description !== undefined) {
      fields.push('description = ?');
      values.push(dto.description);
    }
    values.push(id);
    this.sqlite.prepare(`UPDATE decks SET ${fields.join(', ')} WHERE id = ?`).run(...values as any[]);
    return { ...toDeck(this.getDeckRow(id)), cards: this.findCards(ctx, id), lastStudiedAt: null };
  }

  async deleteDeck(ctx: AppRequestContext, id: string) {
    this.assertDeckOwned(ctx, id);
    this.sqlite.prepare('DELETE FROM decks WHERE id = ?').run(id);
    return { message: 'Deck deleted successfully' };
  }

  async addCardToDeck(ctx: AppRequestContext, deckId: string, cardId: string) {
    this.assertDeckOwned(ctx, deckId);
    this.assertCardOwned(ctx, cardId);
    this.addMembership(deckId, cardId);
    return this.getCard(cardId)!;
  }

  async removeCardFromDeck(ctx: AppRequestContext, deckId: string, cardId: string) {
    this.assertDeckOwned(ctx, deckId);
    this.assertCardOwned(ctx, cardId);
    const result = this.sqlite.prepare('DELETE FROM deck_cards WHERE deck_id = ? AND card_id = ?').run(deckId, cardId);
    if (result.changes === 0) throw new HttpError(404, 'Card is not in this deck');
    return this.getCard(cardId)!;
  }

  async reorderDeckCards(ctx: AppRequestContext, deckId: string, dto: ReorderDeckCardsDto) {
    this.assertDeckOwned(ctx, deckId);
    const current = this.findCards(ctx, deckId).map((card) => card.id);
    if (new Set(dto.cardIds).size !== dto.cardIds.length || dto.cardIds.length !== current.length
      || dto.cardIds.some((id) => !current.includes(id))) {
      throw new HttpError(400, 'cardIds must contain every card in the deck exactly once');
    }
    this.sqlite.transaction(() => dto.cardIds.forEach((cardId, position) => {
      this.sqlite.prepare('UPDATE deck_cards SET position = ? WHERE deck_id = ? AND card_id = ?').run(position, deckId, cardId);
    }));
    return this.findCards(ctx, deckId);
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
    const join = deckId ? ' JOIN deck_cards dc ON dc.card_id = cards.id' : '';
    const deckClause = deckId ? ' AND dc.deck_id = ?' : '';
    const order = deckId ? 'dc.position ASC' : 'cards.created_at DESC';
    const values = deckId ? [ctx.userId, ctx.classId, deckId] : [ctx.userId, ctx.classId];
    const rows = this.sqlite.prepare(`
      SELECT cards.* FROM cards${join}
      WHERE cards.owner_user_id = ? AND cards.class_id = ?${deckClause}
      ORDER BY ${order}
    `).all(...values) as Row[];
    return rows.map((row) => ({ ...toCard(row), deckIds: this.deckIdsForCard(String(row.id)) }));
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
      id, ctx.classId, ctx.userId, null, dto.question, dto.answer,
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

  private assertCardLinkOwned(ctx: AppRequestContext, id: string) {
    const row = this.sqlite.prepare('SELECT * FROM card_relationships WHERE id = ?').get(id) as Row | undefined;
    if (!row || row.owner_user_id !== ctx.userId || row.class_id !== ctx.classId) throw new HttpError(404, 'Card link not found');
    return row;
  }

  private getCard(id: string) {
    const row = this.sqlite.prepare('SELECT * FROM cards WHERE id = ?').get(id) as Row | undefined;
    return row ? { ...toCard(row), deckIds: this.deckIdsForCard(id) } : undefined;
  }

  private deckIdsForCard(cardId: string): string[] {
    return (this.sqlite.prepare('SELECT deck_id FROM deck_cards WHERE card_id = ? ORDER BY added_at ASC').all(cardId) as Row[])
      .map((row) => String(row.deck_id));
  }

  private requestedDeckIds(input: { deckId?: string | null; deckIds?: string[] }): string[] {
    return [...new Set(input.deckIds ?? (input.deckId ? [input.deckId] : []))];
  }

  private addMembership(deckId: string, cardId: string) {
    const row = this.sqlite.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM deck_cards WHERE deck_id = ?').get(deckId) as Row;
    this.sqlite.prepare('INSERT OR IGNORE INTO deck_cards(deck_id, card_id, position, added_at) VALUES (?, ?, ?, ?)')
      .run(deckId, cardId, Number(row.position), new Date().toISOString());
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

function toCardLink(row: Row) {
  return {
    id: String(row.id),
    sourceCardId: String(row.source_card_id),
    targetCardId: String(row.target_card_id),
    explanation: String(row.explanation),
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

function normalizeCardLink<T extends CreateCardLinkDto>(link: T): T {
  if (link.sourceCardId > link.targetCardId) {
    return { ...link, sourceCardId: link.targetCardId, targetCardId: link.sourceCardId };
  }
  return link;
}

function cardLinkKey(link: { sourceCardId: string; targetCardId: string }): string {
  const [source, target] = link.sourceCardId > link.targetCardId
    ? [link.targetCardId, link.sourceCardId]
    : [link.sourceCardId, link.targetCardId];
  return `${source}:${target}`;
}
