import { useEffect, useMemo, useState } from 'react';
import type { ApiClient } from '../api';
import type { Card, Deck, Stats } from '../types';
import FlashcardCreationModal from './FlashcardCreationModal';
import FlashcardEditModal from './FlashcardEditModal';
import FlashcardViewer from './FlashcardViewer';
import StudyMode from './StudyMode';
import { Icon, Modal, Notice, Spinner } from './ui';

const emptyStats: Stats = { total: 0, reviewed: 0, averageReviews: 0, recentlyCreated: 0 };

export default function FlashcardManager({ api, className }: { api: ApiClient; className?: string }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [query, setQuery] = useState('');
  const [concepts, setConcepts] = useState<string[]>([]);
  const [selectedConcepts, setSelectedConcepts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [studyOpen, setStudyOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Card | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Card | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextCards, nextStats, nextDecks] = await Promise.all([api.listCards(), api.getStats(), api.listDecks()]);
      setCards(nextCards);
      setStats(nextStats);
      setDecks(nextDecks);
      setConcepts([...new Set(nextCards.flatMap((card) => card.concepts))].sort());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load flashcards.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [api]);

  const filtered = useMemo(() => {
    const lower = query.trim().toLowerCase();
    return cards.filter((card) => {
      const matchesQuery = !lower
        || card.question.toLowerCase().includes(lower)
        || card.answer.toLowerCase().includes(lower)
        || card.concepts.some((concept) => concept.toLowerCase().includes(lower));
      const matchesConcept = selectedConcepts.length === 0 || card.concepts.some((concept) => selectedConcepts.includes(concept));
      return matchesQuery && matchesConcept;
    });
  }, [cards, query, selectedConcepts]);

  const toggleConcept = (concept: string) => {
    setSelectedConcepts((previous) => previous.includes(concept)
      ? previous.filter((item) => item !== concept)
      : [...previous, concept]);
  };

  const clearFilters = () => {
    setQuery('');
    setSelectedConcepts([]);
  };

  const remove = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteCard(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to delete flashcard.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main className="app-shell">
      <div className="app-container">
        <header className="page-header">
          <div>
            <div className="eyebrow">{className || 'Kiwi study space'}</div>
            <h1>Flashcards</h1>
            <p className="page-header__subtitle">Turn class material into concise prompts, then build recall through focused review.</p>
          </div>
          <div className="page-header__actions">
            <button className="button button--secondary" type="button" disabled={filtered.length === 0} onClick={() => setStudyOpen(true)}>
              <Icon name="study" /> Study
            </button>
            <button className="button button--primary" type="button" onClick={() => setCreateOpen(true)}>
              <Icon name="add" /> New card
            </button>
          </div>
        </header>

        {error && <Notice tone="error" onClose={() => setError(null)}>{error}</Notice>}

        <section className="stats-grid" aria-label="Flashcard statistics">
          <Stat label="Total cards" value={stats.total} />
          <Stat label="Reviewed" value={stats.reviewed} />
          <Stat label="Average reviews" value={stats.averageReviews.toFixed(1)} />
          <Stat label="Created this week" value={stats.recentlyCreated} />
        </section>

        <section className="filter-panel" aria-label="Find and filter flashcards">
          <label className="search-field">
            <span className="visually-hidden">Search flashcards</span>
            <Icon name="search" />
            <input placeholder="Search questions, answers, or concepts" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
            {query && (
              <button className="icon-button icon-button--small search-field__clear" type="button" onClick={() => setQuery('')} aria-label="Clear search">
                <Icon name="close" size={14} />
              </button>
            )}
          </label>

          {concepts.length > 0 && (
            <div className="chip-list" aria-label="Filter by concept">
              {concepts.map((concept) => {
                const selected = selectedConcepts.includes(concept);
                return (
                  <button className={`chip${selected ? ' chip--selected' : ''}`} key={concept} type="button" aria-pressed={selected} onClick={() => toggleConcept(concept)}>
                    {selected && <Icon name="check" size={13} />}
                    {concept}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {loading ? (
          <div className="loading-state"><Spinner label="Loading flashcards" /></div>
        ) : filtered.length === 0 ? (
          <Empty
            filtered={cards.length > 0}
            onAction={cards.length > 0 ? clearFilters : () => setCreateOpen(true)}
          />
        ) : (
          <section className="card-grid" aria-label="Flashcards">
            {filtered.map((card) => (
              <div className="card-shell" key={card.id}>
                <div className="card-shell__actions">
                  <button className="icon-button icon-button--small icon-button--surface" type="button" onClick={() => setEditTarget(card)} aria-label={`Edit card: ${card.question}`} title="Edit card">
                    <Icon name="edit" size={15} />
                  </button>
                  <button className="icon-button icon-button--small icon-button--surface icon-button--danger" type="button" onClick={() => setDeleteTarget(card)} aria-label={`Delete card: ${card.question}`} title="Delete card">
                    <Icon name="trash" size={15} />
                  </button>
                </div>
                <FlashcardViewer
                  card={card}
                  onReview={async (isCorrect) => {
                    await api.recordReview({ cardId: card.id, isCorrect });
                    await load();
                  }}
                />
              </div>
            ))}
          </section>
        )}

        <FlashcardCreationModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          api={api}
          onCreated={async () => { setCreateOpen(false); await load(); }}
        />

        {editTarget && (
          <FlashcardEditModal
            card={editTarget}
            decks={decks}
            api={api}
            onClose={() => setEditTarget(null)}
            onUpdated={async () => { setEditTarget(null); await load(); }}
          />
        )}

        {studyOpen && (
          <StudyMode
            cards={filtered}
            api={api}
            onClose={async () => { setStudyOpen(false); await load(); }}
          />
        )}

        <Modal
          open={Boolean(deleteTarget)}
          title="Delete flashcard?"
          eyebrow="This cannot be undone"
          size="small"
          onClose={() => { if (!deleting) setDeleteTarget(null); }}
          footer={
            <>
              <button className="button button--ghost" type="button" disabled={deleting} onClick={() => setDeleteTarget(null)}>Keep card</button>
              <button className="button button--danger-ghost" type="button" disabled={deleting} onClick={() => void remove()}>
                {deleting ? <Spinner label="Deleting card" size="small" /> : <Icon name="trash" />}
                Delete
              </button>
            </>
          }
        >
          <p className="delete-copy">
            This card and its review history will be removed.
            {deleteTarget && <strong>{deleteTarget.question}</strong>}
          </p>
        </Modal>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="stat-card">
      <div className="stat-card__value">{value}</div>
      <div className="stat-card__label">{label}</div>
    </article>
  );
}

function Empty({ filtered, onAction }: { filtered: boolean; onAction: () => void }) {
  return (
    <section className="empty-state">
      <div className="empty-state__icon"><Icon name={filtered ? 'search' : 'cards'} size={26} /></div>
      <h2>{filtered ? 'No cards match' : 'Your first card starts here'}</h2>
      <p>{filtered ? 'Try a broader search or clear the selected concepts.' : 'Create one manually or turn a passage of class material into a set of study prompts.'}</p>
      <button className="button button--primary" type="button" onClick={onAction}>
        <Icon name={filtered ? 'close' : 'sparkles'} />
        {filtered ? 'Clear filters' : 'Create a card'}
      </button>
    </section>
  );
}
