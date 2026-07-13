import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiClient } from '../api';
import type { Card } from '../types';
import FlashcardViewer from './FlashcardViewer';
import MultipleChoiceViewer from './MultipleChoiceViewer';
import { Icon, Modal, Notice } from './ui';

export default function StudyMode({ cards, deckId, api, onClose }: { cards: Card[]; deckId?: string; api: ApiClient; onClose: () => Promise<void> | void }) {
  const [studyCards, setStudyCards] = useState(cards);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<'flashcard' | 'mcq'>('flashcard');
  const [correct, setCorrect] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>();
  const sessionPromise = useRef<Promise<{ id: string }> | null>(null);
  const advanceTimer = useRef<number | null>(null);
  const current = studyCards[index];
  const progress = useMemo(() => studyCards.length ? ((index + 1) / studyCards.length) * 100 : 0, [index, studyCards.length]);

  const clearAdvance = () => {
    if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
    advanceTimer.current = null;
  };

  useEffect(() => {
    let active = true;
    let startedId: string | undefined;
    sessionPromise.current = api.startSession(deckId);
    void sessionPromise.current.then((session) => {
      startedId = session.id;
      if (active) setSessionId(session.id);
      else void api.endSession(session.id);
    }).catch((requestError) => { if (active) setError(requestError instanceof Error ? requestError.message : 'Could not start study session.'); });
    return () => {
      active = false;
      clearAdvance();
      if (startedId) void api.endSession(startedId);
    };
  }, [api, deckId]);

  const goTo = (nextIndex: number) => {
    clearAdvance();
    setIndex(Math.max(0, Math.min(nextIndex, studyCards.length - 1)));
    setError(null);
  };

  const review = async (isCorrect: boolean) => {
    setError(null);
    const activeSessionId = sessionId || (await sessionPromise.current)?.id;
    await api.recordReview({ cardId: current.id, isCorrect, sessionId: activeSessionId });
    setCorrect((previous) => previous + (isCorrect ? 1 : 0));
    setTotal((previous) => previous + 1);
    clearAdvance();
    advanceTimer.current = window.setTimeout(() => {
      setIndex((previous) => Math.min(previous + 1, studyCards.length - 1));
      advanceTimer.current = null;
    }, 650);
  };

  const shuffle = () => {
    clearAdvance();
    setStudyCards((previous) => [...previous].sort(() => Math.random() - 0.5));
    setIndex(0);
    setError(null);
  };

  const restart = () => {
    clearAdvance();
    setIndex(0);
    setCorrect(0);
    setTotal(0);
    setError(null);
  };

  if (studyCards.length === 0) return <Notice>No cards to study.</Notice>;

  return (
    <Modal open title="Study session" eyebrow="Focused review" size="study" onClose={() => void onClose()}>
      <div className="study-layout">
        <div className="study-toolbar">
          <div className="study-meta">
            <div className="study-meta__copy">
              <span>Card {index + 1} of {studyCards.length}</span>
              <span>{total ? Math.round((correct / total) * 100) : 0}% accuracy</span>
            </div>
            <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-label="Study progress">
              <div className="progress-track__bar" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="study-controls">
            <div className="segmented-control" aria-label="Study mode">
              <button type="button" aria-pressed={mode === 'flashcard'} onClick={() => setMode('flashcard')} title="Flashcard mode" aria-label="Flashcard mode">
                <Icon name="cards" />
              </button>
              <button type="button" aria-pressed={mode === 'mcq'} onClick={() => setMode('mcq')} title="Quiz mode" aria-label="Quiz mode">
                <Icon name="quiz" />
              </button>
            </div>
            <button className="icon-button" type="button" onClick={shuffle} aria-label="Shuffle cards" title="Shuffle cards"><Icon name="shuffle" /></button>
            <button className="icon-button" type="button" onClick={restart} aria-label="Restart session" title="Restart session"><Icon name="reset" /></button>
          </div>
        </div>

        {error && <Notice tone="error" onClose={() => setError(null)}>{error}</Notice>}

        <div className="study-stage">
          {mode === 'flashcard' ? (
            <FlashcardViewer key={current.id} card={current} />
          ) : (
            <MultipleChoiceViewer
              key={current.id}
              api={api}
              card={current}
              onReview={(isCorrect) => { void review(isCorrect).catch((requestError) => setError(requestError instanceof Error ? requestError.message : 'Could not save review.')); }}
            />
          )}
        </div>

        <nav className="study-navigation" aria-label="Study card navigation">
          <button className="button button--secondary" type="button" disabled={index === 0} onClick={() => goTo(index - 1)}>
            <Icon name="arrow-left" /> Previous
          </button>
          <span className="study-navigation__position">{index + 1} / {studyCards.length}</span>
          <button className="button button--secondary" type="button" disabled={index >= studyCards.length - 1} onClick={() => goTo(index + 1)}>
            Next <Icon name="arrow-right" />
          </button>
        </nav>
      </div>
    </Modal>
  );
}
