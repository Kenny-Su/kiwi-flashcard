import { useEffect, useState } from 'react';
import type { Card as Flashcard } from '../types';
import { Icon, Notice, Spinner } from './ui';

export default function FlashcardViewer({ card, onReview }: { card: Flashcard; onReview?: (isCorrect: boolean) => Promise<void> | void }) {
  const [showAnswer, setShowAnswer] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  useEffect(() => {
    setShowAnswer(false);
    setReviewing(false);
    setReviewError(null);
  }, [card.id]);

  const review = async (isCorrect: boolean) => {
    if (reviewing) return;
    setReviewing(true);
    setReviewError(null);
    try {
      await onReview?.(isCorrect);
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Could not save this review.');
    } finally {
      setReviewing(false);
    }
  };

  return (
    <article className="flashcard">
      <header className="flashcard__topline">
        <span className="flashcard__side-label">{showAnswer ? 'Answer' : 'Question'}</span>
        <span className="flashcard__hint">{showAnswer ? 'Tap to see question' : 'Tap to reveal answer'}</span>
      </header>

      <button
        className="flashcard__face"
        type="button"
        onClick={() => setShowAnswer((previous) => !previous)}
        aria-expanded={showAnswer}
        aria-label={showAnswer ? 'Showing answer. Activate to return to the question.' : 'Showing question. Activate to reveal the answer.'}
      >
        <span className="flashcard__content" key={`${card.id}-${showAnswer ? 'answer' : 'question'}`}>
          {showAnswer ? card.answer : card.question}
        </span>
      </button>

      <footer className="flashcard__footer">
        <div className="flashcard__concepts" aria-label="Concepts">
          {card.concepts.slice(0, 4).map((concept) => <span className="flashcard__concept" key={concept}>{concept}</span>)}
        </div>

        {reviewError && <Notice tone="error">{reviewError}</Notice>}

        {showAnswer && (
          <div className="review-actions">
            <button className="button button--secondary" type="button" disabled={reviewing} onClick={() => void review(false)}>
              {reviewing ? <Spinner label="Saving review" size="small" /> : <Icon name="thumb-down" />}
              Again
            </button>
            <button className="button button--primary" type="button" disabled={reviewing} onClick={() => void review(true)}>
              {reviewing ? <Spinner label="Saving review" size="small" /> : <Icon name="thumb-up" />}
              Got it
            </button>
          </div>
        )}
      </footer>
    </article>
  );
}
