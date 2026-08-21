import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { ApiClient } from '../api';
import type { AdminView } from '../kiwiBridge';
import type { Card, Deck } from '../types';
import { Icon, Modal, Notice, Spinner } from './ui';

export default function AdminInterface({ api, className, view, onNavigate }: {
  api: ApiClient;
  className?: string;
  view: AdminView;
  onNavigate: (view: AdminView) => void;
}) {
  const [cards, setCards] = useState<Card[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
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
      const nextDecks = await api.listClassDecks();
      const nextCards = [...new Map(nextDecks.flatMap((deck) => deck.cards).map((card) => [card.id, card])).values()];
      setCards(nextCards);
      setDecks(nextDecks);
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
    await run(async () => { await api.deleteClassDeck(deleteDeck.id); setDeleteDeck(null); });
  };
  const removeCard = async () => {
    if (!deleteCard) return;
    await run(async () => { await api.deleteClassCard(deleteCard.id); setDeleteCard(null); });
  };
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await operation(); await load(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'The change could not be saved.'); }
    finally { setBusy(false); }
  };

  return <main className="app-shell admin-interface"><div className="app-container">
    <header className="page-header admin-interface__header">
      <div><div className="eyebrow">{className || 'Class administration'}</div><h1>Class decks</h1><p className="page-header__subtitle">Publish official flashcard decks that everyone in this class can study.</p></div>
      <button className="button button--secondary" type="button" disabled={loading} onClick={() => void load()}><Icon name="reset" /> Refresh</button>
    </header>
    <nav className="admin-interface__local-nav" aria-label="Flashcard manager sections">
      {(['overview', 'decks', 'cards'] as AdminView[]).map((item) => <button key={item} type="button" className={view === item ? 'is-active' : ''} onClick={() => onNavigate(item)}>{item === 'cards' ? 'Card library' : title(item)}</button>)}
    </nav>
    {error && <Notice tone="error" onClose={() => setError(null)}>{error}</Notice>}
    {loading ? <div className="loading-state"><Spinner label="Loading manager" /></div> : <>
      {view === 'overview' && <Overview decks={decks} cards={cards} onNavigate={onNavigate} />}
      {view === 'decks' && <Decks decks={decks} onCreate={() => setDeckEditor('new')} onEdit={setDeckEditor} onDelete={setDeleteDeck} />}
      {view === 'cards' && <Cards cards={filteredCards} decks={decks} query={query} onQuery={setQuery} onCreate={() => setCardEditor('new')} onEdit={setCardEditor} onDelete={setDeleteCard} />}
    </>}
    {deckEditor && <DeckEditor api={api} deck={deckEditor === 'new' ? undefined : deckEditor} busy={busy} onClose={() => setDeckEditor(null)} onSave={async (operation) => { await run(operation); setDeckEditor(null); }} />}
    {cardEditor && <ClassCardEditor api={api} decks={decks} card={cardEditor === 'new' ? undefined : cardEditor} busy={busy} onClose={() => setCardEditor(null)} onSave={async (operation) => { await run(operation); setCardEditor(null); }} />}
    <ConfirmDelete open={Boolean(deleteDeck)} title="Delete deck?" detail={deleteDeck ? `“${deleteDeck.name}” will be removed. Its cards remain in the library.` : ''} busy={busy} onClose={() => setDeleteDeck(null)} onConfirm={() => void removeDeck()} />
    <ConfirmDelete open={Boolean(deleteCard)} title="Delete card everywhere?" detail={deleteCard ? `“${deleteCard.question}” will be removed from every deck, with its review history.` : ''} busy={busy} onClose={() => setDeleteCard(null)} onConfirm={() => void removeCard()} />
  </div></main>;
}

function Overview({ decks, cards, onNavigate }: { decks: Deck[]; cards: Card[]; onNavigate: (view: AdminView) => void }) {
  const reviews = cards.reduce((sum, card) => sum + card.reviewCount, 0);
  return <>
    <section className="stats-grid"><Stat label="Published cards" value={cards.length} /><Stat label="Class decks" value={decks.length} /><Stat label="Cards studied" value={cards.filter((card) => card.reviewCount > 0).length} /><Stat label="Class review attempts" value={reviews} /></section>
    <section className="admin-overview-grid">
      <article><div className="eyebrow">Published content</div><h2>One source of truth</h2><p>Cards in these decks are immediately available to every student enrolled in the selected class.</p><button className="button button--primary" type="button" onClick={() => onNavigate('decks')}>Manage decks <Icon name="arrow-right" /></button></article>
      <article><div className="eyebrow">Class library</div><h2>{cards.length} official cards</h2><p>Students can study official decks, while their answers and personal flashcards remain private.</p><button className="button button--secondary" type="button" onClick={() => onNavigate('cards')}>Open class cards</button></article>
    </section>
    <Notice>Editing a class card updates it for everyone. Student review history remains user-scoped and is never exposed here.</Notice>
  </>;
}

function Decks({ decks, onCreate, onEdit, onDelete }: { decks: Deck[]; onCreate: () => void; onEdit: (deck: Deck) => void; onDelete: (deck: Deck) => void }) {
  return <section className="admin-section"><header><div><h2>Published decks</h2><p>Everyone enrolled in this class can study these decks.</p></div><button className="button button--primary" type="button" onClick={onCreate}><Icon name="add" /> New class deck</button></header>
    {decks.length ? <div className="admin-table" role="table"><div className="admin-table__head" role="row"><span>Name</span><span>Cards</span><span>Last studied</span><span>Actions</span></div>{decks.map((deck) => <div className="admin-table__row" role="row" key={deck.id}><span><strong>{deck.name}</strong><small>{deck.description || 'No description'}</small></span><span>{deck.cards.length}</span><span>{deck.lastStudiedAt ? new Date(deck.lastStudiedAt).toLocaleDateString() : 'Never'}</span><span className="admin-table__actions"><button className="button button--ghost button--compact" type="button" onClick={() => onEdit(deck)}><Icon name="edit" /> Edit</button><button className="icon-button icon-button--small icon-button--danger" type="button" onClick={() => onDelete(deck)} aria-label={`Delete ${deck.name}`}><Icon name="trash" size={15} /></button></span></div>)}</div> : <Empty title="No decks yet" detail="Create the first organized study set for this class." action="Create deck" onAction={onCreate} />}
  </section>;
}

function Cards({ cards, decks, query, onQuery, onCreate, onEdit, onDelete }: { cards: Card[]; decks: Deck[]; query: string; onQuery: (value: string) => void; onCreate: () => void; onEdit: (card: Card) => void; onDelete: (card: Card) => void }) {
  return <section className="admin-section"><header><div><h2>Class cards</h2><p>Search and maintain cards published in official decks.</p></div><button className="button button--primary" type="button" disabled={!decks.length} onClick={onCreate}><Icon name="add" /> New class card</button></header>
    <label className="search-field admin-interface__search"><Icon name="search" /><span className="visually-hidden">Search cards</span><input value={query} onChange={(event) => onQuery(event.currentTarget.value)} placeholder="Search questions, answers, concepts, or tags" /></label>
    {cards.length ? <div className="admin-card-list">{cards.map((card) => <article key={card.id}><div><strong>{card.question}</strong><p>{card.answer}</p><div className="chip-list">{card.deckIds.map((id) => <span className="chip" key={id}>{decks.find((deck) => deck.id === id)?.name || 'Deck'}</span>)}{card.tags.map((tag) => <span className="chip" key={tag}>{tag}</span>)}</div></div><div className="admin-table__actions"><button className="button button--ghost button--compact" type="button" onClick={() => onEdit(card)}><Icon name="edit" /> Edit</button><button className="icon-button icon-button--small icon-button--danger" type="button" onClick={() => onDelete(card)} aria-label={`Delete ${card.question}`}><Icon name="trash" size={15} /></button></div></article>)}</div> : <Empty title={query ? 'No matching cards' : 'No cards yet'} detail={query ? 'Try a broader search.' : 'Create the first card in this class library.'} action={query ? 'Clear search' : 'Create card'} onAction={() => query ? onQuery('') : onCreate()} />}
  </section>;
}

function DeckEditor({ api, deck, busy, onClose, onSave }: { api: ApiClient; deck?: Deck; busy: boolean; onClose: () => void; onSave: (operation: () => Promise<void>) => Promise<void> }) {
  const [name, setName] = useState(deck?.name || '');
  const [description, setDescription] = useState(deck?.description || '');
  const submit = (event: FormEvent) => { event.preventDefault(); if (!name.trim()) return; void onSave(async () => { if (deck) await api.updateClassDeck(deck.id, { name: name.trim(), description: description.trim() || null }); else await api.createClassDeck({ name: name.trim(), description: description.trim() || undefined }); }); };
  return <Modal open title={deck ? 'Edit deck' : 'Create deck'} eyebrow="Class library" size="small" onClose={onClose} footer={<><button className="button button--ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button button--primary" type="submit" form="admin-deck-editor" disabled={busy || !name.trim()}>{busy ? <Spinner label="Saving" size="small" /> : 'Save deck'}</button></>}><form id="admin-deck-editor" onSubmit={submit}><label className="field"><span className="field__label">Name</span><input autoFocus value={name} onChange={(event) => setName(event.currentTarget.value)} /></label><label className="field"><span className="field__label">Description <small>optional</small></span><textarea rows={3} value={description} onChange={(event) => setDescription(event.currentTarget.value)} /></label></form></Modal>;
}

function ClassCardEditor({ api, decks, card, busy, onClose, onSave }: { api: ApiClient; decks: Deck[]; card?: Card; busy: boolean; onClose: () => void; onSave: (operation: () => Promise<void>) => Promise<void> }) {
  const [deckId, setDeckId] = useState(card?.deckIds[0] || decks[0]?.id || '');
  const [question, setQuestion] = useState(card?.question || '');
  const [answer, setAnswer] = useState(card?.answer || '');
  const [concepts, setConcepts] = useState((card?.concepts || []).join(', '));
  const [tags, setTags] = useState((card?.tags || []).join(', '));
  const list = (value: string) => [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!question.trim() || !answer.trim() || (!card && !deckId)) return;
    void onSave(async () => {
      const input = { question: question.trim(), answer: answer.trim(), concepts: list(concepts), tags: list(tags) };
      if (card) await api.updateClassCard(card.id, input);
      else await api.createClassCard({ ...input, deckId });
    });
  };
  return <Modal open title={card ? 'Edit class card' : 'Create class card'} eyebrow="Published to the class" size="medium" onClose={onClose} footer={<><button className="button button--ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button button--primary" type="submit" form="class-card-editor" disabled={busy || !question.trim() || !answer.trim() || (!card && !deckId)}>{busy ? <Spinner label="Publishing" size="small" /> : card ? 'Save changes' : 'Publish card'}</button></>}><form id="class-card-editor" onSubmit={submit}>
    {!card && <label className="field"><span className="field__label">Class deck</span><select value={deckId} onChange={(event) => setDeckId(event.currentTarget.value)}>{decks.map((deck) => <option value={deck.id} key={deck.id}>{deck.name}</option>)}</select></label>}
    <label className="field"><span className="field__label">Question</span><textarea rows={3} autoFocus value={question} onChange={(event) => setQuestion(event.currentTarget.value)} /></label>
    <label className="field"><span className="field__label">Answer</span><textarea rows={4} value={answer} onChange={(event) => setAnswer(event.currentTarget.value)} /></label>
    <label className="field"><span className="field__label">Concepts <small>comma separated</small></span><input value={concepts} onChange={(event) => setConcepts(event.currentTarget.value)} /></label>
    <label className="field"><span className="field__label">Tags <small>comma separated</small></span><input value={tags} onChange={(event) => setTags(event.currentTarget.value)} /></label>
  </form></Modal>;
}

function ConfirmDelete({ open, title: heading, detail, busy, onClose, onConfirm }: { open: boolean; title: string; detail: string; busy: boolean; onClose: () => void; onConfirm: () => void }) { return <Modal open={open} title={heading} eyebrow="This cannot be undone" size="small" onClose={onClose} footer={<><button className="button button--ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button button--danger-ghost" type="button" disabled={busy} onClick={onConfirm}>{busy ? <Spinner label="Deleting" size="small" /> : <><Icon name="trash" /> Delete</>}</button></>}><p>{detail}</p></Modal>; }
function Stat({ label, value }: { label: string; value: number }) { return <article className="stat-card"><div className="stat-card__value">{value}</div><div className="stat-card__label">{label}</div></article>; }
function Empty({ title: heading, detail, action, onAction }: { title: string; detail: string; action: string; onAction: () => void }) { return <div className="empty-state"><Icon name="cards" size={28} /><h2>{heading}</h2><p>{detail}</p><button className="button button--secondary" type="button" onClick={onAction}>{action}</button></div>; }
function title(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
