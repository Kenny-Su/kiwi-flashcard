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
  let suggestedLinks: any[];
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
    suggestCardLinks: async () => suggestedLinks,
    explainCardLink: async () => 'Transactions use WAL to preserve durable changes.',
  } as unknown as KiwiMcpService;

  beforeEach(() => {
    generatedCards = [];
    suggestedLinks = [];
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
    assert.ok(decks[0].lastStudiedAt);
    assert.deepEqual(stats, { total: 1, reviewed: 1, recentlyCreated: 1 });
  });

  it('can remove an existing card from its deck', async () => {
    const deck = await service.createDeck(context, { name: 'Databases' });
    const card = await service.createCard(context, { question: 'Q', answer: 'A', deckId: deck.id });

    const updated = await service.updateCard(context, card.id, { question: 'Q', answer: 'A', deckId: null });

    assert.deepEqual(updated.deckIds, []);
  });

  it('updates decks and isolates deck management by owner', async () => {
    const deck = await service.createDeck(context, { name: 'Old name', description: 'Old description' });
    const updated = await service.updateDeck(context, deck.id, { name: 'New name', description: null });

    assert.equal(updated.name, 'New name');
    assert.equal(updated.description, null);
    await assert.rejects(
      () => service.updateDeck({ ...context, userId: 'user-2' }, deck.id, { name: 'No access' }),
      (error: any) => error.status === 404,
    );
  });

  it('supports reusable membership and preserves global relationships', async () => {
    const firstDeck = await service.createDeck(context, { name: 'First' });
    const secondDeck = await service.createDeck(context, { name: 'Second' });
    const first = await service.createCard(context, { question: 'First?', answer: 'A', deckId: firstDeck.id });
    const second = await service.createCard(context, { question: 'Second?', answer: 'B', deckId: firstDeck.id });
    await service.createCardLinks(context, { links: [{
      sourceCardId: first.id, targetCardId: second.id, explanation: 'First and second form a pair.',
    }] });

    const added = await service.addCardToDeck(context, secondDeck.id, first.id);
    assert.deepEqual(new Set(added.deckIds), new Set([firstDeck.id, secondDeck.id]));
    assert.equal((await service.listCardLinks(context, firstDeck.id)).length, 1);
    await service.addCardToDeck(context, secondDeck.id, second.id);
    assert.equal((await service.listCardLinks(context, secondDeck.id)).length, 1);
    const reordered = await service.reorderDeckCards(context, firstDeck.id, { cardIds: [second.id, first.id] });
    assert.deepEqual(reordered.map((card) => card.id), [second.id, first.id]);

    const removed = await service.removeCardFromDeck(context, secondDeck.id, first.id);
    assert.deepEqual(removed.deckIds, [firstDeck.id]);
    await assert.rejects(
      () => service.removeCardFromDeck(context, secondDeck.id, first.id),
      (error: any) => error.status === 404,
    );
  });

  it('deletes a deck while preserving cards, reviews, and session history', async () => {
    const deck = await service.createDeck(context, { name: 'Databases' });
    const first = await service.createCard(context, { question: 'First?', answer: 'A', deckId: deck.id });
    const second = await service.createCard(context, { question: 'Second?', answer: 'B', deckId: deck.id });
    const session = await service.startSession(context, { deckId: deck.id });
    await service.recordReview(context, { cardId: first.id, sessionId: session.id, isCorrect: true });
    await service.createCardLinks(context, { links: [{
      sourceCardId: first.id, targetCardId: second.id, explanation: 'First and second form a pair.',
    }] });

    await service.deleteDeck(context, deck.id);

    const cards = await service.listCards(context);
    assert.equal(cards.length, 2);
    assert.ok(cards.every((card) => card.deckIds.length === 0));
    assert.equal(cards.find((card) => card.id === first.id)?.reviewCount, 1);
    assert.equal((sqlite.prepare('SELECT COUNT(*) AS count FROM card_relationships').get() as any).count, 1);
    const ended = await service.endSession(context, session.id);
    assert.equal(ended.deckId, null);
    assert.equal(ended.reviews.length, 1);
  });

  it('permanently deleting a card removes its reviews', async () => {
    const deck = await service.createDeck(context, { name: 'Test' });
    const card = await service.createCard(context, { question: 'Q', answer: 'A', deckIds: [deck.id] });
    const other = await service.createCard(context, { question: 'Other', answer: 'A', deckIds: [deck.id] });
    await service.createCardLinks(context, { links: [{ sourceCardId: card.id, targetCardId: other.id, explanation: 'Q and Other are compared.' }] });
    await service.recordReview(context, { cardId: card.id, isCorrect: true });
    await service.deleteCard(context, card.id);

    assert.equal((sqlite.prepare('SELECT COUNT(*) AS count FROM reviews').get() as any).count, 0);
    assert.equal((sqlite.prepare('SELECT COUNT(*) AS count FROM deck_cards WHERE card_id = ?').get(card.id) as any).count, 0);
    assert.equal((sqlite.prepare('SELECT COUNT(*) AS count FROM card_relationships').get() as any).count, 0);
  });

  it('previews generated cards without storing them', async () => {
    generatedCards = [{ question: 'Generated Q', answer: 'Generated A' }];
    const cards = await service.generateCards(context, { sourceContent: 'Class context', count: 1 });

    assert.deepEqual(cards, generatedCards);
    assert.deepEqual(await service.listCards(context), []);
    assert.deepEqual(generateCalls[0], ['app-token', 'flashcards', 'Class context', 1]);
  });

  it('stores an accepted batch of generated card drafts', async () => {
    const cards = await service.createCards(context, { cards: [
      { question: 'Edited Q1', answer: 'Edited A1', sourceContent: 'Class context' },
      { question: 'Edited Q2', answer: 'Edited A2', sourceContent: 'Class context' },
    ] });

    assert.equal(cards.length, 2);
    assert.equal((await service.listCards(context)).length, 2);
    assert.equal(cards[0].sourceContent, 'Class context');
  });

  it('creates, lists, and deletes deck-scoped card links', async () => {
    const deck = await service.createDeck(context, { name: 'Databases' });
    const source = await service.createCard(context, { question: 'Transactions?', answer: 'Atomic units', deckId: deck.id });
    const target = await service.createCard(context, { question: 'WAL?', answer: 'Write-ahead log', deckId: deck.id });

    const [created] = await service.createCardLinks(context, { links: [{
      sourceCardId: source.id, targetCardId: target.id, explanation: 'Transactions use WAL for durable changes.',
    }] });

    assert.equal((await service.listCardLinks(context, deck.id)).length, 1);
    const [duplicate] = await service.createCardLinks(context, { links: [{
      sourceCardId: target.id, targetCardId: source.id, explanation: 'A duplicate sentence.',
    }] });
    assert.equal(duplicate.id, created.id);
    const updated = await service.updateCardLink(context, created.id, { explanation: 'WAL makes transaction changes durable.' });
    assert.equal(updated.explanation, 'WAL makes transaction changes durable.');
    const generated = await service.explainCardLink(context, { sourceCardId: source.id, targetCardId: target.id });
    assert.equal(generated.explanation, 'Transactions use WAL to preserve durable changes.');
    await service.deleteCardLink(context, created.id);
    assert.deepEqual(await service.listCardLinks(context, deck.id), []);
  });

  it('rejects self-links but allows global links across decks', async () => {
    const firstDeck = await service.createDeck(context, { name: 'First' });
    const secondDeck = await service.createDeck(context, { name: 'Second' });
    const first = await service.createCard(context, { question: 'First?', answer: 'A', deckId: firstDeck.id });
    const second = await service.createCard(context, { question: 'Second?', answer: 'B', deckId: secondDeck.id });

    await assert.rejects(() => service.createCardLinks(context, { links: [{
      sourceCardId: first.id, targetCardId: first.id, explanation: 'Invalid self link.',
    }] }), /cannot link to itself/);
    const links = await service.createCardLinks(context, { links: [{
      sourceCardId: first.id, targetCardId: second.id, explanation: 'First and second can be compared.',
    }] });
    assert.equal(links.length, 1);
  });

  it('keeps relationships when deck memberships change', async () => {
    const firstDeck = await service.createDeck(context, { name: 'First' });
    const secondDeck = await service.createDeck(context, { name: 'Second' });
    const first = await service.createCard(context, { question: 'First?', answer: 'A', deckId: firstDeck.id });
    const second = await service.createCard(context, { question: 'Second?', answer: 'B', deckId: firstDeck.id });
    await service.createCardLinks(context, { links: [{
      sourceCardId: first.id, targetCardId: second.id, explanation: 'First and second form a pair.',
    }] });

    await service.updateCard(context, first.id, { question: first.question, answer: first.answer, deckIds: [secondDeck.id] });

    assert.deepEqual(await service.listCardLinks(context, firstDeck.id), []);
    await service.addCardToDeck(context, secondDeck.id, second.id);
    assert.equal((await service.listCardLinks(context, secondDeck.id)).length, 1);
  });

  it('filters invalid and duplicate AI relationship suggestions', async () => {
    const deck = await service.createDeck(context, { name: 'Databases' });
    const source = await service.createCard(context, { question: 'Transactions?', answer: 'Atomic units', deckId: deck.id });
    const target = await service.createCard(context, { question: 'WAL?', answer: 'Write-ahead log', deckId: deck.id });
    suggestedLinks = [
      { sourceCardId: source.id, targetCardId: target.id, explanation: 'Transactions use WAL for durable changes.' },
      { sourceCardId: source.id, targetCardId: target.id, explanation: 'Duplicate explanation.' },
      { sourceCardId: source.id, targetCardId: 'invented', explanation: 'Invalid card.' },
    ];

    const suggestions = await service.suggestCardLinks(context, { deckId: deck.id });

    assert.deepEqual(suggestions, [suggestedLinks[0]]);
  });
});
