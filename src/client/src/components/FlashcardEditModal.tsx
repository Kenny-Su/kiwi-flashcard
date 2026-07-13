import { useState, type FormEvent, type KeyboardEvent } from 'react';
import type { ApiClient } from '../api';
import type { Card, Deck } from '../types';
import { Icon, Modal, Notice, Spinner } from './ui';

export default function FlashcardEditModal({ card, decks, api, onClose, onUpdated }: {
  card: Card;
  decks: Deck[];
  api: ApiClient;
  onClose: () => void;
  onUpdated: () => Promise<void>;
}) {
  const [question, setQuestion] = useState(card.question);
  const [answer, setAnswer] = useState(card.answer);
  const [deckIds, setDeckIds] = useState(card.deckIds);
  const [tagText, setTagText] = useState('');
  const [tags, setTags] = useState(card.tags);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addTag = () => {
    const value = tagText.trim();
    if (value && !tags.includes(value)) setTags((previous) => [...previous, value]);
    setTagText('');
  };

  const handleTagKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addTag();
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!question.trim() || !answer.trim()) {
      setError('Question and answer cannot be empty.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await api.updateCard(card.id, {
        question: question.trim(),
        answer: answer.trim(),
        tags,
        deckIds,
      });
      await onUpdated();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to update flashcard.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Edit flashcard"
      eyebrow="Update study material"
      onClose={() => { if (!saving) onClose(); }}
      footer={
        <>
          <button className="button button--ghost" type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="button button--primary" type="submit" form="edit-flashcard-form" disabled={saving}>
            {saving ? <Spinner label="Saving flashcard" size="small" /> : <Icon name="check" />}
            Save changes
          </button>
        </>
      }
    >
      {error && <Notice tone="error" onClose={() => setError(null)}>{error}</Notice>}

      <form id="edit-flashcard-form" onSubmit={(event) => void save(event)} aria-busy={saving}>
        <label className="field">
          <span className="field__label">Question</span>
          <textarea value={question} onChange={(event) => setQuestion(event.currentTarget.value)} rows={4} required />
        </label>

        <label className="field">
          <span className="field__label">Answer</span>
          <textarea value={answer} onChange={(event) => setAnswer(event.currentTarget.value)} rows={5} required />
        </label>

        <fieldset className="field deck-choice">
          <legend className="field__label">Study sets</legend>
          {decks.length === 0 ? <span className="field-help">No decks yet.</span> : decks.map((deck) => (
            <label className="check-row" key={deck.id}><input type="checkbox" checked={deckIds.includes(deck.id)} onChange={() => setDeckIds((previous) => previous.includes(deck.id) ? previous.filter((id) => id !== deck.id) : [...previous, deck.id])} /> {deck.name}</label>
          ))}
        </fieldset>

        <div className="field-row">
          <label className="field">
            <span className="field__label">Tag</span>
            <input value={tagText} onChange={(event) => setTagText(event.currentTarget.value)} onKeyDown={handleTagKeyDown} placeholder="e.g. midterm" />
          </label>
          <button className="button button--secondary" type="button" onClick={addTag} disabled={!tagText.trim()}>
            <Icon name="add" /> Add
          </button>
        </div>

        {tags.length > 0 && (
          <div className="chip-list edit-card__tags" aria-label="Card tags">
            {tags.map((tag) => (
              <span className="chip chip--removable" key={tag}>
                {tag}
                <button className="chip__remove" type="button" onClick={() => setTags((previous) => previous.filter((item) => item !== tag))} aria-label={`Remove ${tag}`}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </form>
    </Modal>
  );
}
