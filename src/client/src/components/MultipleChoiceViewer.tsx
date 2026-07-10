import { useEffect, useState } from 'react';
import type { ApiClient } from '../api';
import type { Card, MultipleChoiceQuestion } from '../types';
import { Notice, Spinner } from './ui';

export default function MultipleChoiceViewer({ api, card, onReview }: { api: ApiClient; card: Card; onReview: (isCorrect: boolean) => void }) {
  const [mcq, setMcq] = useState<MultipleChoiceQuestion | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setMcq(null);
    setSelected(null);
    setSubmitted(false);
    setError(null);
    api.generateMcq(card.id)
      .then((question) => { if (active) setMcq(question); })
      .catch((requestError) => { if (active) setError(requestError instanceof Error ? requestError.message : 'Failed to generate quiz.'); });
    return () => { active = false; };
  }, [api, card.id, attempt]);

  if (error) {
    return (
      <Notice
        tone="error"
        action={<button className="button button--compact button--secondary" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button>}
      >
        {error}
      </Notice>
    );
  }

  if (!mcq) {
    return (
      <div className="mcq-loading" aria-live="polite">
        <div><Spinner label="Generating multiple-choice question" /><p>Building a question from this card…</p></div>
      </div>
    );
  }

  const correct = submitted && selected === mcq.correctIndex;

  const submit = () => {
    if (selected === null || submitted) return;
    setSubmitted(true);
    onReview(selected === mcq.correctIndex);
  };

  return (
    <section className="mcq-card">
      <fieldset>
        <legend>{mcq.question}</legend>
        <div className="mcq-choices">
          {mcq.choices.map((choice, index) => {
            const isCorrectChoice = submitted && index === mcq.correctIndex;
            const isWrongSelection = submitted && index === selected && index !== mcq.correctIndex;
            const className = [
              'mcq-choice',
              submitted ? 'mcq-choice--disabled' : '',
              isCorrectChoice ? 'mcq-choice--correct' : '',
              isWrongSelection ? 'mcq-choice--wrong' : '',
            ].filter(Boolean).join(' ');
            return (
              <label className={className} key={`${index}-${choice}`}>
                <input
                  type="radio"
                  name={`mcq-${card.id}`}
                  value={index}
                  checked={selected === index}
                  disabled={submitted}
                  onChange={() => setSelected(index)}
                />
                <span>{choice}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {!submitted ? (
        <button className="button button--primary" type="button" disabled={selected === null} onClick={submit}>Check answer</button>
      ) : (
        <Notice tone={correct ? 'success' : 'error'}>
          <strong>{correct ? 'Correct.' : `Correct answer: ${mcq.choices[mcq.correctIndex]}`}</strong>
          {mcq.explanation && <> {mcq.explanation}</>}
        </Notice>
      )}
    </section>
  );
}
