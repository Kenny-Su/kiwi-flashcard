import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { ApiClient, GeneratedCardDraft } from '../api';
import type { Deck } from '../types';
import { Icon, Modal, Notice, Spinner } from './ui';

type PreviewCard = GeneratedCardDraft & { id: string };

export default function FlashcardCreationModal({ open, decks, defaultDeckId, onClose, api, onCreated }: { open: boolean; decks: Deck[]; defaultDeckId?: string; onClose: () => void; api: ApiClient; onCreated: () => Promise<void> }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [sourceContent, setSourceContent] = useState('');
  const [tagText, setTagText] = useState('');
  const [deckIds, setDeckIds] = useState<string[]>(defaultDeckId ? [defaultDeckId] : []);
  const [tags, setTags] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<PreviewCard[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();

  const reset = () => {
    setQuestion('');
    setAnswer('');
    setSourceContent('');
    setTags([]);
    setTagText('');
    setDeckIds(defaultDeckId ? [defaultDeckId] : []);
    setDrafts([]);
    setPreviewOpen(false);
    setError(null);
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const create = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!question.trim() || !answer.trim()) {
      setError('Add both a question and an answer before creating the card.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createCard({
        question: question.trim(),
        answer: answer.trim(),
        tags,
        sourceContent: sourceContent.trim() || undefined,
        deckIds,
      });
      reset();
      await onCreated();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to create card.');
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (!sourceContent.trim()) {
      setError('Paste source content before generating cards.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const generated = await api.generateCards({ sourceContent: sourceContent.trim(), count: 3, deckId: deckIds[0] });
      if (generated.length === 0) {
        setError('No usable flashcards were generated. Try adding more source detail.');
        return;
      }
      setDrafts(generated.map((card, index) => ({ ...card, id: `generated-${Date.now()}-${index}` })));
      setPreviewOpen(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to generate cards.');
    } finally {
      setBusy(false);
    }
  };

  const acceptDrafts = async () => {
    if (drafts.length === 0) {
      setError('Keep at least one card before saving.');
      return;
    }
    if (drafts.some((card) => !card.question.trim() || !card.answer.trim())) {
      setError('Every accepted card needs both a question and an answer.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api.createCards(drafts.map((card) => ({
        question: card.question.trim(),
        answer: card.answer.trim(),
        sourceContent: sourceContent.trim(),
        deckIds,
      })));
      reset();
      await onCreated();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to save generated cards.');
    } finally {
      setBusy(false);
    }
  };

  const updateDraft = (id: string, field: 'question' | 'answer', value: string) => {
    setDrafts((previous) => previous.map((card) => card.id === id ? { ...card, [field]: value } : card));
  };

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

  useEffect(() => {
    if (open) setDeckIds(defaultDeckId ? [defaultDeckId] : []);
  }, [defaultDeckId, open]);

  return (
    <Modal
      open={open}
      onClose={close}
      title={previewOpen ? 'Review generated cards' : 'Create a flashcard'}
      eyebrow={previewOpen ? 'Edit, reject, then save' : 'Build your deck'}
      size="large"
      footer={
        previewOpen ? (
          <>
            <button className="button button--ghost" type="button" disabled={busy} onClick={() => { setPreviewOpen(false); setError(null); }}>Back to source</button>
            <button className="button button--primary" type="button" disabled={busy || drafts.length === 0} onClick={() => void acceptDrafts()}>
              {busy ? <Spinner label="Saving cards" size="small" /> : <Icon name="check" />}
              Add {drafts.length} {drafts.length === 1 ? 'card' : 'cards'}
            </button>
          </>
        ) : (
          <>
            <button className="button button--ghost" type="button" onClick={close}>Cancel</button>
            <button className="button button--primary" type="submit" form={formId} disabled={busy}>
              {busy ? <Spinner label="Creating card" size="small" /> : <Icon name="add" />}
              Create card
            </button>
          </>
        )
      }
    >
      {error && <Notice tone="error" onClose={() => setError(null)}>{error}</Notice>}

      {previewOpen ? (
        <section className="generation-preview" aria-busy={busy}>
          <p className="generation-preview__intro">Nothing is saved yet. Refine the drafts below and remove anything you do not want in your library.</p>

          {drafts.length === 0 ? (
            <div className="generation-preview__empty">All generated cards were removed. Return to the source and generate another set.</div>
          ) : (
            <div className="generation-preview__list">
              {drafts.map((card, index) => (
                <article className="generation-preview__card" key={card.id}>
                  <header className="generation-preview__header">
                    <strong>Draft {index + 1}</strong>
                    <button className="icon-button icon-button--small icon-button--danger" type="button" disabled={busy} onClick={() => setDrafts((previous) => previous.filter((item) => item.id !== card.id))} aria-label={`Reject draft ${index + 1}`} title="Reject card">
                      <Icon name="trash" size={15} />
                    </button>
                  </header>
                  <label className="field">
                    <span className="field__label">Question</span>
                    <textarea value={card.question} onChange={(event) => updateDraft(card.id, 'question', event.currentTarget.value)} rows={3} />
                  </label>
                  <label className="field">
                    <span className="field__label">Answer</span>
                    <textarea value={card.answer} onChange={(event) => updateDraft(card.id, 'answer', event.currentTarget.value)} rows={4} />
                  </label>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : <div className="creation-grid" aria-busy={busy}>
        <section className="creation-pane creation-pane--ai">
          <div className="section-heading">
            <span className="section-heading__icon"><Icon name="sparkles" /></span>
            <div>
              <h3>Generate from source</h3>
              <p>Turn lecture notes or reading material into three ready-to-study cards.</p>
            </div>
          </div>

          <label className="field">
            <span className="field__label">Source content <small>optional for a manual card</small></span>
            <textarea
              value={sourceContent}
              onChange={(event) => setSourceContent(event.currentTarget.value)}
              placeholder="Paste a passage, concept summary, or class notes…"
              rows={8}
            />
          </label>

          <button className="button button--secondary button--block" type="button" onClick={() => void generate()} disabled={busy || !sourceContent.trim()}>
            {busy ? <Spinner label="Generating cards" size="small" /> : <Icon name="sparkles" />}
            Generate 3 cards
          </button>
        </section>

        <form className="creation-pane" id={formId} onSubmit={(event) => void create(event)}>
          <div className="section-heading">
            <span className="section-heading__icon"><Icon name="cards" /></span>
            <div>
              <h3>Write one manually</h3>
              <p>Keep the prompt focused and the answer easy to recall.</p>
            </div>
          </div>

          <label className="field">
            <span className="field__label">Question</span>
            <textarea value={question} onChange={(event) => setQuestion(event.currentTarget.value)} placeholder="What should you be able to recall?" rows={4} required />
          </label>

          <label className="field">
            <span className="field__label">Answer</span>
            <textarea value={answer} onChange={(event) => setAnswer(event.currentTarget.value)} placeholder="Write a concise, memorable answer…" rows={5} required />
          </label>

          <fieldset className="field deck-choice">
            <legend className="field__label">Study sets <small>optional</small></legend>
            {decks.length === 0 ? <span className="field-help">Create a deck to add this card to a study set.</span> : decks.map((deck) => (
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
          <div className="field-help">Press Enter or select Add. Tags help organize future study sessions.</div>

          {tags.length > 0 && (
            <div className="chip-list" aria-label="Card tags">
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
      </div>}
    </Modal>
  );
}
