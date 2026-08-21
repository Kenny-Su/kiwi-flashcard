import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { ApiClient } from '../api';
import type { AdminView } from '../kiwiBridge';
import type { Card, Deck, Stats } from '../types';
import FlashcardCreationModal from './FlashcardCreationModal';
import FlashcardEditModal from './FlashcardEditModal';
import { Icon, Modal, Notice, Spinner } from './ui';

const EMPTY_STATS: Stats = { total: 0, reviewed: 0, recentlyCreated: 0 };

export default function AdminInterface({ api, className, view, onNavigate }: {
  api: ApiClient;
  className?: string;
  view: AdminView;
  onNavigate: (view: AdminView) => void;
}) {
  const [cards, setCards] = useState<Card[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deckEditor, setDeckEditor] = useState<Deck | 'new' | null>(null);
  const [cardEditor, setCardEditor] = useState<Card | 'new' | null>(null);
  const [deleteDeck, setDeleteDeck] = useState<Deck | null>(null);
  const [deleteCard, setDeleteCard] = useState<Card | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextCards, nextDecks, nextStats] = await Promise.all([
        api.listCards(), api.listDecks(), api.getStats(),
      ]);
      setCards(nextCards);
      setDecks(nextDecks);
      setStats(nextStats);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load flashcard administration data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [api]);

  const filteredCards = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return cards;
    return cards.filter((card) => [card.question, card.answer, ...card.tags, ...card.concepts]
      .some((value) => value.toLocaleLowerCase().includes(needle)));
  }, [cards, query]);

  const removeDeck = async () => {
    if (!deleteDeck) return;
    await run(async () => { await api.deleteDeck(deleteDeck.id); setDeleteDeck(null); });
  };
  const removeCard = async () => {
    if (!deleteCard) return;
    await run(async () => { await api.deleteCard(deleteCard.id); setDeleteCard(null); });
  };
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await operation(); await load(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'The change could not be saved.'); }
    finally { setBusy(false); }
  };

  return <main className="app-shell admin-interface"><div className="app-container">
    <header className="page-header admin-interface__header">
      <div><div className="eyebrow">{className || 'Class administration'}</div><h1>Flashcard Manager</h1><p className="page-header__subtitle">Manage the flashcard resources you maintain for this class.</p></div>
      <button className="button button--secondary" type="button" disabled={loading} onClick={() => void load()}><Icon name="reset" /> Refresh</button>
    </header>
    <nav className="admin-interface__local-nav" aria-label="Flashcard manager sections">
      {(['overview', 'decks', 'cards'] as AdminView[]).map((item) => <button key={item} type="button" className={view === item ? 'is-active' : ''} onClick={() => onNavigate(item)}>{item === 'cards' ? 'Card library' : title(item)}</button>)}
    </nav>
    {error && <Notice tone="error" onClose={() => setError(null)}>{error}</Notice>}
    {loading ? <div className="loading-state"><Spinner label="Loading manager" /></div> : <>
      {view === 'overview' && <Overview stats={stats} decks={decks} cards={cards} onNavigate={onNavigate} />}
      {view === 'decks' && <Decks decks={decks} onCreate={() => setDeckEditor('new')} onEdit={setDeckEditor} onDelete={setDeleteDeck} />}
      {view === 'cards' && <Cards cards={filteredCards} decks={decks} query={query} onQuery={setQuery} onCreate={() => setCardEditor('new')} onEdit={setCardEditor} onDelete={setDeleteCard} />}
    </>}
    {deckEditor && <DeckEditor api={api} deck={deckEditor === 'new' ? undefined : deckEditor} busy={busy} onClose={() => setDeckEditor(null)} onSave={async (operation) => { await run(operation); setDeckEditor(null); }} />}
    <FlashcardCreationModal open={cardEditor === 'new'} decks={decks} api={api} onClose={() => setCardEditor(null)} onCreated={async () => { setCardEditor(null); await load(); }} />
    {cardEditor && cardEditor !== 'new' && <FlashcardEditModal card={cardEditor} decks={decks} api={api} onClose={() => setCardEditor(null)} onUpdated={async () => { setCardEditor(null); await load(); }} />}
    <ConfirmDelete open={Boolean(deleteDeck)} title="Delete deck?" detail={deleteDeck ? `“${deleteDeck.name}” will be removed. Its cards remain in the library.` : ''} busy={busy} onClose={() => setDeleteDeck(null)} onConfirm={() => void removeDeck()} />
    <ConfirmDelete open={Boolean(deleteCard)} title="Delete card everywhere?" detail={deleteCard ? `“${deleteCard.question}” will be removed from every deck, with its review history.` : ''} busy={busy} onClose={() => setDeleteCard(null)} onConfirm={() => void removeCard()} />
  </div></main>;
}

function Overview({ stats, decks, cards, onNavigate }: { stats: Stats; decks: Deck[]; cards: Card[]; onNavigate: (view: AdminView) => void }) {
  const reviews = cards.reduce((sum, card) => sum + card.reviewCount, 0);
  return <>
    <section className="stats-grid"><Stat label="Cards" value={stats.total} /><Stat label="Decks" value={decks.length} /><Stat label="Cards reviewed" value={stats.reviewed} /><Stat label="Review attempts" value={reviews} /></section>
    <section className="admin-overview-grid">
      <article><div className="eyebrow">Content</div><h2>Organize class study material</h2><p>Create focused decks, maintain reusable cards, and keep concepts and tags consistent.</p><button className="button button--primary" type="button" onClick={() => onNavigate('decks')}>Manage decks <Icon name="arrow-right" /></button></article>
      <article><div className="eyebrow">Activity</div><h2>{stats.recentlyCreated} new this week</h2><p>{reviews ? `${reviews} review attempts have been recorded for your class-scoped library.` : 'Review activity will appear after the first study session.'}</p><button className="button button--secondary" type="button" onClick={() => onNavigate('cards')}>Open card library</button></article>
    </section>
    <Notice>This view currently covers resources owned by your account. Student-level and class-wide analytics require a future scoped Kiwi aggregate API.</Notice>
  </>;
}

function Decks({ decks, onCreate, onEdit, onDelete }: { decks: Deck[]; onCreate: () => void; onEdit: (deck: Deck) => void; onDelete: (deck: Deck) => void }) {
  return <section className="admin-section"><header><div><h2>Decks</h2><p>Maintain the sets available in your class-scoped library.</p></div><button className="button button--primary" type="button" onClick={onCreate}><Icon name="add" /> New deck</button></header>
    {decks.length ? <div className="admin-table" role="table"><div className="admin-table__head" role="row"><span>Name</span><span>Cards</span><span>Last studied</span><span>Actions</span></div>{decks.map((deck) => <div className="admin-table__row" role="row" key={deck.id}><span><strong>{deck.name}</strong><small>{deck.description || 'No description'}</small></span><span>{deck.cards.length}</span><span>{deck.lastStudiedAt ? new Date(deck.lastStudiedAt).toLocaleDateString() : 'Never'}</span><span className="admin-table__actions"><button className="button button--ghost button--compact" type="button" onClick={() => onEdit(deck)}><Icon name="edit" /> Edit</button><button className="icon-button icon-button--small icon-button--danger" type="button" onClick={() => onDelete(deck)} aria-label={`Delete ${deck.name}`}><Icon name="trash" size={15} /></button></span></div>)}</div> : <Empty title="No decks yet" detail="Create the first organized study set for this class." action="Create deck" onAction={onCreate} />}
  </section>;
}

function Cards({ cards, decks, query, onQuery, onCreate, onEdit, onDelete }: { cards: Card[]; decks: Deck[]; query: string; onQuery: (value: string) => void; onCreate: () => void; onEdit: (card: Card) => void; onDelete: (card: Card) => void }) {
  return <section className="admin-section"><header><div><h2>Card library</h2><p>Search and maintain reusable flashcard content.</p></div><button className="button button--primary" type="button" onClick={onCreate}><Icon name="add" /> New card</button></header>
    <label className="search-field admin-interface__search"><Icon name="search" /><span className="visually-hidden">Search cards</span><input value={query} onChange={(event) => onQuery(event.currentTarget.value)} placeholder="Search questions, answers, concepts, or tags" /></label>
    {cards.length ? <div className="admin-card-list">{cards.map((card) => <article key={card.id}><div><strong>{card.question}</strong><p>{card.answer}</p><div className="chip-list">{card.deckIds.map((id) => <span className="chip" key={id}>{decks.find((deck) => deck.id === id)?.name || 'Deck'}</span>)}{card.tags.map((tag) => <span className="chip" key={tag}>{tag}</span>)}</div></div><div className="admin-table__actions"><button className="button button--ghost button--compact" type="button" onClick={() => onEdit(card)}><Icon name="edit" /> Edit</button><button className="icon-button icon-button--small icon-button--danger" type="button" onClick={() => onDelete(card)} aria-label={`Delete ${card.question}`}><Icon name="trash" size={15} /></button></div></article>)}</div> : <Empty title={query ? 'No matching cards' : 'No cards yet'} detail={query ? 'Try a broader search.' : 'Create the first card in this class library.'} action={query ? 'Clear search' : 'Create card'} onAction={() => query ? onQuery('') : onCreate()} />}
  </section>;
}

function DeckEditor({ api, deck, busy, onClose, onSave }: { api: ApiClient; deck?: Deck; busy: boolean; onClose: () => void; onSave: (operation: () => Promise<void>) => Promise<void> }) {
  const [name, setName] = useState(deck?.name || '');
  const [description, setDescription] = useState(deck?.description || '');
  const submit = (event: FormEvent) => { event.preventDefault(); if (!name.trim()) return; void onSave(async () => { if (deck) await api.updateDeck(deck.id, { name: name.trim(), description: description.trim() || null }); else await api.createDeck({ name: name.trim(), description: description.trim() || undefined }); }); };
  return <Modal open title={deck ? 'Edit deck' : 'Create deck'} eyebrow="Class library" size="small" onClose={onClose} footer={<><button className="button button--ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button button--primary" type="submit" form="admin-deck-editor" disabled={busy || !name.trim()}>{busy ? <Spinner label="Saving" size="small" /> : 'Save deck'}</button></>}><form id="admin-deck-editor" onSubmit={submit}><label className="field"><span className="field__label">Name</span><input autoFocus value={name} onChange={(event) => setName(event.currentTarget.value)} /></label><label className="field"><span className="field__label">Description <small>optional</small></span><textarea rows={3} value={description} onChange={(event) => setDescription(event.currentTarget.value)} /></label></form></Modal>;
}

function ConfirmDelete({ open, title: heading, detail, busy, onClose, onConfirm }: { open: boolean; title: string; detail: string; busy: boolean; onClose: () => void; onConfirm: () => void }) { return <Modal open={open} title={heading} eyebrow="This cannot be undone" size="small" onClose={onClose} footer={<><button className="button button--ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button button--danger-ghost" type="button" disabled={busy} onClick={onConfirm}>{busy ? <Spinner label="Deleting" size="small" /> : <><Icon name="trash" /> Delete</>}</button></>}><p>{detail}</p></Modal>; }
function Stat({ label, value }: { label: string; value: number }) { return <article className="stat-card"><div className="stat-card__value">{value}</div><div className="stat-card__label">{label}</div></article>; }
function Empty({ title: heading, detail, action, onAction }: { title: string; detail: string; action: string; onAction: () => void }) { return <div className="empty-state"><Icon name="cards" size={28} /><h2>{heading}</h2><p>{detail}</p><button className="button button--secondary" type="button" onClick={onAction}>{action}</button></div>; }
function title(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
