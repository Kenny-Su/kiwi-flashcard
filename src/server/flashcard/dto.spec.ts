import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCreateCard, parseCreateCards, parseGenerateCards, parseGenerateMcq, parseRecordReview, parseUpdateCard } from './dto';

describe('request validation', () => {
  it('keeps valid card fields and strips unknown fields', () => {
    const parsed = parseCreateCard({
      question: 'Question', answer: 'Answer', concepts: ['concept'], unknown: 'discarded',
    });

    assert.equal(parsed.question, 'Question');
    assert.equal(parsed.answer, 'Answer');
    assert.deepEqual(parsed.concepts, ['concept']);
    assert.equal('unknown' in parsed, false);
  });

  it('rejects an empty card question', () => {
    assert.throws(
      () => parseCreateCard({ question: '', answer: 'Answer' }),
      /question must be a non-empty string/,
    );
  });

  it('allows an update to remove a card from its deck', () => {
    const parsed = parseUpdateCard({ question: 'Question', answer: 'Answer', deckId: null });
    assert.equal(parsed.deckId, null);
  });

  it('validates batches of reviewed cards', () => {
    const parsed = parseCreateCards({ cards: [{ question: 'Q', answer: 'A' }] });
    assert.deepEqual(parsed.cards, [{
      question: 'Q', answer: 'A', classId: undefined, deckId: undefined, concepts: undefined,
      tags: undefined, pdfId: undefined, pageNumber: undefined, materialType: undefined,
      sourceContent: undefined, difficultyRating: undefined, confidence: undefined,
    }]);
    assert.throws(() => parseCreateCards({ cards: [] }), /between 1 and 10 cards/);
  });

  it('enforces generation limits', () => {
    assert.throws(() => parseGenerateCards({ sourceContent: 'Source', count: 11 }), /count must be an integer/);
    assert.throws(() => parseGenerateMcq({ numChoices: 1 }), /numChoices must be an integer/);
  });

  it('requires a boolean review result', () => {
    assert.throws(
      () => parseRecordReview({ cardId: 'card-1', isCorrect: 'yes' }),
      /isCorrect must be a boolean/,
    );
  });
});
