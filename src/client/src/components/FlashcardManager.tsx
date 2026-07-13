import { useEffect, useMemo, useState } from 'react';
import type { ApiClient } from '../api';
import type { Card, Deck, Stats } from '../types';
import ConceptMapModal from './ConceptMapModal';
import DeckDashboard from './DeckDashboard';
import DeckDetail from './DeckDetail';
import FlashcardCreationModal from './FlashcardCreationModal';
import FlashcardEditModal from './FlashcardEditModal';
import FlashcardViewer from './FlashcardViewer';
import StudyMode from './StudyMode';
import { Icon, Modal, Notice, Spinner } from './ui';

const emptyStats: Stats = { total: 0, reviewed: 0, recentlyCreated: 0 };

export default function FlashcardManager({ api, className }: { api: ApiClient; className?: string }) {
  const [cards, setCards] = useState<Card[]>([]); const [decks, setDecks] = useState<Deck[]>([]); const [stats, setStats] = useState<Stats>(emptyStats);
  const [view, setView] = useState<'decks' | 'library' | 'detail'>('decks'); const [activeDeckId, setActiveDeckId] = useState('');
  const [query, setQuery] = useState(''); const [selectedTags, setSelectedTags] = useState<string[]>([]); const [selectedConcepts, setSelectedConcepts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false); const [createDeckId, setCreateDeckId] = useState<string>(); const [editTarget, setEditTarget] = useState<Card | null>(null);
  const [studyCards, setStudyCards] = useState<Card[] | null>(null); const [studyDeckId, setStudyDeckId] = useState<string>(); const [mapDeckId, setMapDeckId] = useState<string>();
  const [deleteTarget, setDeleteTarget] = useState<Card | null>(null); const [deleting, setDeleting] = useState(false);
  const load = async () => { setLoading(true); setError(null); try { const [nextCards, nextStats, nextDecks] = await Promise.all([api.listCards(), api.getStats(), api.listDecks()]); setCards(nextCards); setStats(nextStats); setDecks(nextDecks); } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load flashcards.'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [api]);
  const tags = useMemo(() => [...new Set(cards.flatMap((card) => card.tags))].sort(), [cards]);
  const concepts = useMemo(() => [...new Set(cards.flatMap((card) => card.concepts))].sort(), [cards]);
  const filtered = useMemo(() => { const lower = query.trim().toLowerCase(); return cards.filter((card) => (!lower || [card.question, card.answer, ...card.tags, ...card.concepts].some((value) => value.toLowerCase().includes(lower))) && (!selectedTags.length || card.tags.some((tag) => selectedTags.includes(tag))) && (!selectedConcepts.length || card.concepts.some((concept) => selectedConcepts.includes(concept)))); }, [cards, query, selectedConcepts, selectedTags]);
  const activeDeck = decks.find((deck) => deck.id === activeDeckId);
  useEffect(() => { if (view === 'detail' && activeDeckId && !activeDeck) setView('decks'); }, [activeDeck, activeDeckId, view]);
  const study = (deck?: Deck, selected = filtered) => { setStudyCards(deck?.cards || selected); setStudyDeckId(deck?.id); };
  const remove = async () => { if (!deleteTarget || deleting) return; setDeleting(true); try { await api.deleteCard(deleteTarget.id); setDeleteTarget(null); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Failed to delete card.'); } finally { setDeleting(false); } };
  const toggle = (value: string, values: string[], setter: (next: string[]) => void) => setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);

  return <main className="app-shell"><div className="app-container">
    {view === 'decks' && <><header className="page-header"><div><div className="eyebrow">{className || 'Kiwi study space'}</div><h1>Your study decks</h1><p className="page-header__subtitle">Choose a focused set, then study it in the order that works for you.</p></div><button className="button button--secondary" type="button" onClick={() => setView('library')}><Icon name="cards" /> All cards</button></header><section className="stats-grid"><Stat label="Total cards" value={stats.total} /><Stat label="Reviewed" value={stats.reviewed} /><Stat label="Study decks" value={decks.length} /></section>{error && <Notice tone="error" onClose={() => setError(null)}>{error}</Notice>}{loading ? <div className="loading-state"><Spinner label="Loading decks" /></div> : <DeckDashboard api={api} decks={decks} onChanged={load} onLibrary={() => setView('library')} onOpen={(deck) => { setActiveDeckId(deck.id); setView('detail'); }} onStudy={(deck) => study(deck)} />}</>}

    {view === 'library' && <><header className="page-header"><div><div className="eyebrow">Card library</div><h1>All cards</h1><p className="page-header__subtitle">Your reusable knowledge library. Tags describe cards; decks organize study goals.</p></div><div className="page-header__actions"><button className="button button--secondary" type="button" onClick={() => setView('decks')}><Icon name="arrow-left" /> Decks</button><button className="button button--secondary" type="button" disabled={!filtered.length} onClick={() => study()}><Icon name="study" /> Study selection</button><button className="button button--primary" type="button" onClick={() => { setCreateDeckId(undefined); setCreateOpen(true); }}><Icon name="add" /> New card</button></div></header>{error && <Notice tone="error" onClose={() => setError(null)}>{error}</Notice>}<section className="filter-panel"><label className="search-field"><span className="visually-hidden">Search cards</span><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search questions, answers, tags, or concepts" /></label>{tags.length > 0 && <Filter label="Tags" values={tags} selected={selectedTags} onToggle={(value) => toggle(value, selectedTags, setSelectedTags)} />}{concepts.length > 0 && <Filter label="Concepts" values={concepts} selected={selectedConcepts} onToggle={(value) => toggle(value, selectedConcepts, setSelectedConcepts)} />}</section>{loading ? <div className="loading-state"><Spinner label="Loading cards" /></div> : filtered.length === 0 ? <Empty onAction={() => { setQuery(''); setSelectedTags([]); setSelectedConcepts([]); }} /> : <section className="card-grid">{filtered.map((card) => <div className="card-shell" key={card.id}><div className="card-memberships">{card.deckIds.map((id) => <span className="chip" key={id}>{decks.find((deck) => deck.id === id)?.name || 'Deck'}</span>)}</div><div className="card-shell__actions"><button className="icon-button icon-button--small icon-button--surface" type="button" onClick={() => setEditTarget(card)}><Icon name="edit" size={15} /></button><button className="icon-button icon-button--small icon-button--surface icon-button--danger" type="button" onClick={() => setDeleteTarget(card)}><Icon name="trash" size={15} /></button></div><FlashcardViewer card={card} /></div>)}</section>}</>}

    {view === 'detail' && activeDeck && <DeckDetail api={api} deck={activeDeck} allCards={cards} onBack={() => setView('decks')} onChanged={load} onStudy={() => study(activeDeck)} onMap={() => setMapDeckId(activeDeck.id)} onCreate={() => { setCreateDeckId(activeDeck.id); setCreateOpen(true); }} onEdit={setEditTarget} onDeleteCard={setDeleteTarget} />}

    <FlashcardCreationModal open={createOpen} decks={decks} defaultDeckId={createDeckId} api={api} onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); await load(); }} />
    {editTarget && <FlashcardEditModal card={editTarget} decks={decks} api={api} onClose={() => setEditTarget(null)} onUpdated={async () => { setEditTarget(null); await load(); }} />}
    {studyCards && <StudyMode cards={studyCards} deckId={studyDeckId} api={api} onClose={async () => { setStudyCards(null); setStudyDeckId(undefined); await load(); }} />}
    {mapDeckId && <ConceptMapModal decks={decks} initialDeckId={mapDeckId} api={api} onClose={() => setMapDeckId(undefined)} onEdit={(card) => { setMapDeckId(undefined); setEditTarget(card); }} />}
    <Modal open={Boolean(deleteTarget)} title="Delete flashcard?" eyebrow="This cannot be undone" size="small" onClose={() => { if (!deleting) setDeleteTarget(null); }} footer={<><button className="button button--ghost" type="button" disabled={deleting} onClick={() => setDeleteTarget(null)}>Keep card</button><button className="button button--danger-ghost" type="button" disabled={deleting} onClick={() => void remove()}>{deleting ? <Spinner label="Deleting card" size="small" /> : <Icon name="trash" />} Delete everywhere</button></>}><p className="delete-copy">This card will be removed from every deck, along with its relationships and review history.{deleteTarget && <strong>{deleteTarget.question}</strong>}</p></Modal>
  </div></main>;
}

function Filter({ label, values, selected, onToggle }: { label: string; values: string[]; selected: string[]; onToggle: (value: string) => void }) { return <div className="filter-group"><span className="filter-group__label">{label}</span><div className="chip-list">{values.map((value) => <button className={`chip${selected.includes(value) ? ' chip--selected' : ''}`} type="button" key={value} onClick={() => onToggle(value)}>{selected.includes(value) && <Icon name="check" size={13} />}{value}</button>)}</div></div>; }
function Stat({ label, value }: { label: string; value: number }) { return <article className="stat-card"><div className="stat-card__value">{value}</div><div className="stat-card__label">{label}</div></article>; }
function Empty({ onAction }: { onAction: () => void }) { return <section className="empty-state"><Icon name="search" size={26} /><h2>No cards match</h2><p>Clear the current filters to see your library.</p><button className="button button--secondary" type="button" onClick={onAction}>Clear filters</button></section>; }
