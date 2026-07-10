import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { AppRequestContext } from '../auth/app-token.types';
import { SqliteService } from '../database/sqlite.service';
import { FlashcardService } from './flashcard.service';
import { KiwiMcpService } from './kiwi-mcp.service';

describe('FlashcardService with SQLite', () => {
  let sqlite: SqliteService;
  let service: FlashcardService;
  let generatedCards: any[];
  let generateCalls: any[][];
  const context: AppRequestContext = {
    userId: 'user-1', classId: 'class-1', appSlug: 'flashcards', scopes: ['llm:prompt:*'], token: 'app-token',
  };
  const kiwiMcp = {
    generateCards: async (...args: any[]) => {
      generateCalls.push(args);
      return generatedCards;
    },
    generateMcq: async () => ({}),
  } as unknown as KiwiMcpService;

  beforeEach(() => {
    generatedCards = [];
    generateCalls = [];
    sqlite = new SqliteService(':memory:');
    service = new FlashcardService(sqlite, kiwiMcp);
  });

  afterEach(() => sqlite.close());

  it('creates, lists, searches, and updates cards', async () => {
    const created = await service.createCard(context, {
      question: 'What is WAL?', answer: 'Write-ahead logging', concepts: ['sqlite'], tags: ['database'],
    });

    assert.equal((await service.listCards(context)).length, 1);
    assert.equal((await service.searchCards(context, 'sqlite')).length, 1);
    const updated = await service.updateCard(context, created.id, {
      question: 'What does WAL mean?', answer: 'Write-ahead logging', confidence: 4,
    });
    assert.equal(updated.question, 'What does WAL mean?');
    assert.equal(updated.confidence, 4);
  });

  it('isolates cards by user and class', async () => {
    const created = await service.createCard(context, { question: 'Q', answer: 'A' });
    const anotherContext = { ...context, userId: 'user-2' };

    assert.deepEqual(await service.listCards(anotherContext), []);
    await assert.rejects(() => service.deleteCard(anotherContext, created.id), (error: any) => error.status === 404);
  });

  it('supports decks, sessions, reviews, and statistics', async () => {
    const deck = await service.createDeck(context, { name: 'Databases' });
    const card = await service.createCard(context, { question: 'Q', answer: 'A', deckId: deck.id });
    const session = await service.startSession(context, { deckId: deck.id });

    await service.recordReview(context, { cardId: card.id, sessionId: session.id, isCorrect: true });
    const ended = await service.endSession(context, session.id);
    const decks = await service.listDecks(context);
    const stats = await service.stats(context);

    assert.equal(ended.reviews.length, 1);
    assert.equal(decks[0].id, deck.id);
    assert.equal(decks[0].cards[0].id, card.id);
    assert.deepEqual(stats, { total: 1, reviewed: 1, averageReviews: 1, recentlyCreated: 1 });
  });

  it('stores cards generated through Kiwi MCP', async () => {
    generatedCards = [{ question: 'Generated Q', answer: 'Generated A', concepts: ['context'] }];
    const cards = await service.generateCards(context, { sourceContent: 'Class context', count: 1 });

    assert.equal(cards.length, 1);
    assert.equal(cards[0].question, 'Generated Q');
    assert.deepEqual(cards[0].concepts, ['context']);
    assert.deepEqual(generateCalls[0], ['app-token', 'flashcards', 'Class context', 1]);
  });
});
