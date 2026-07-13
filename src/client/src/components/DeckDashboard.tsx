import { useState, type FormEvent } from 'react';
import type { ApiClient } from '../api';
import type { Deck } from '../types';
import { Icon, Modal, Notice, Spinner } from './ui';

export default function DeckDashboard({ api, decks, onChanged, onOpen, onStudy, onLibrary }: {
  api: ApiClient; decks: Deck[]; onChanged: () => Promise<void>; onOpen: (deck: Deck) => void;
  onStudy: (deck: Deck) => void; onLibrary: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async (event: FormEvent) => {
    event.preventDefault(); if (!name.trim()) return;
    setBusy(true); setError(null);
    try { await api.createDeck({ name: name.trim(), description: description.trim() || undefined }); setCreating(false); setName(''); setDescription(''); await onChanged(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Failed to create deck.'); }
    finally { setBusy(false); }
  };
  return <>
    {error && <Notice tone="error" onClose={() => setError(null)}>{error}</Notice>}
    <section className="deck-dashboard" aria-label="Study decks">
      <button className="deck-tile deck-tile--create" type="button" onClick={() => setCreating(true)}><Icon name="add" size={26} /><strong>Create a study deck</strong><span>Build an ordered set for a study goal.</span></button>
      {decks.map((deck) => <article className="deck-tile" key={deck.id}>
        <button className="deck-tile__body" type="button" onClick={() => onOpen(deck)}>
          <span className="deck-tile__count">{deck.cards.length} {deck.cards.length === 1 ? 'card' : 'cards'}</span>
          <h2>{deck.name}</h2><p>{deck.description || 'An ordered study set.'}</p>
          <small>{deck.lastStudiedAt ? `Last studied ${formatRelative(deck.lastStudiedAt)}` : 'Not studied yet'}</small>
        </button>
        <button className="button button--primary" type="button" disabled={deck.cards.length === 0} onClick={() => onStudy(deck)}><Icon name="study" /> {deck.lastStudiedAt ? 'Study again' : 'Study'}</button>
      </article>)}
      <button className="deck-tile deck-tile--library" type="button" onClick={onLibrary}><Icon name="cards" size={26} /><strong>All cards</strong><span>Browse, search, tag, and reuse your card library.</span></button>
    </section>
    {creating && <Modal open title="Create a study deck" eyebrow="Define a study goal" size="small" onClose={() => { if (!busy) setCreating(false); }} footer={<><button className="button button--ghost" type="button" disabled={busy} onClick={() => setCreating(false)}>Cancel</button><button className="button button--primary" form="create-study-deck" type="submit" disabled={busy || !name.trim()}>{busy ? <Spinner label="Creating deck" size="small" /> : <Icon name="add" />} Create deck</button></>}>
      <form id="create-study-deck" onSubmit={(event) => void create(event)}><label className="field"><span className="field__label">Name</span><input autoFocus required value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="Biology midterm" /></label><label className="field"><span className="field__label">Description <small>optional</small></span><textarea rows={3} value={description} onChange={(event) => setDescription(event.currentTarget.value)} placeholder="What are you preparing for?" /></label></form>
    </Modal>}
  </>;
}

function formatRelative(value: string) {
  const days = Math.floor((Date.now() - Date.parse(value)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
