import { useEffect, useState } from 'react';
import type { Card as Flashcard } from '../types';

export default function FlashcardViewer({ card }: { card: Flashcard }) {
  const [showAnswer, setShowAnswer] = useState(false);

  useEffect(() => {
    setShowAnswer(false);
  }, [card.id]);

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
      </footer>
    </article>
  );
}
