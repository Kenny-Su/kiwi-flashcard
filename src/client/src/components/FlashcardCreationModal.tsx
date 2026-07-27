import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { ApiClient, GeneratedCardDraft } from '../api';
import type { Deck } from '../types';
import { Icon, Modal, Notice, Spinner } from './ui';

type PreviewCard = GeneratedCardDraft & { id: string };
type CreationMethod = 'choose' | 'prompt' | 'context' | 'manual';

export default function FlashcardCreationModal({ open, decks, defaultDeckId, onClose, api, onCreated }: { open: boolean; decks: Deck[]; defaultDeckId?: string; onClose: () => void; api: ApiClient; onCreated: () => Promise<void> }) {
  const [method, setMethod] = useState<CreationMethod>('choose');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [sourceContent, setSourceContent] = useState('');
  const [contextFocus, setContextFocus] = useState('');
  const [tagText, setTagText] = useState('');
  const [deckIds, setDeckIds] = useState<string[]>(defaultDeckId ? [defaultDeckId] : []);
  const [tags, setTags] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<PreviewCard[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();

  const reset = () => {
    setMethod('choose');
    setQuestion('');
    setAnswer('');
    setSourceContent('');
    setContextFocus('');
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

  const generateFromLearningContext = async () => {
    setBusy(true);
    setError(null);
    try {
      const generated = await api.generateCardsFromContext({ count: 3, focus: contextFocus });
      if (generated.length === 0) {
        setError('Kiwi could not find enough learning context to create cards yet.');
        return;
      }
      setDrafts(generated.map((card, index) => ({ ...card, id: `context-${Date.now()}-${index}` })));
      setPreviewOpen(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to generate cards from your learning context.');
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
        sourceContent: method === 'context' ? contextFocus.trim() : sourceContent.trim(),
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
    if (open) {
      setMethod('choose');
      setDeckIds(defaultDeckId ? [defaultDeckId] : []);
    }
  }, [defaultDeckId, open]);

  const chooseMethod = (nextMethod: Exclude<CreationMethod, 'choose'>) => {
    setMethod(nextMethod);
    setError(null);
  };

  const backToMethods = () => {
    setMethod('choose');
    setError(null);
  };

  const deckChoices = (
    <fieldset className="field deck-choice">
      <legend className="field__label">Study sets <small>optional</small></legend>
      {decks.length === 0 ? <span className="field-help">Create a deck to add these cards to a study set.</span> : decks.map((deck) => (
        <label className="check-row" key={deck.id}><input type="checkbox" checked={deckIds.includes(deck.id)} onChange={() => setDeckIds((previous) => previous.includes(deck.id) ? previous.filter((id) => id !== deck.id) : [...previous, deck.id])} /> {deck.name}</label>
      ))}
    </fieldset>
  );

  const title = previewOpen
    ? 'Review generated cards'
    : method === 'choose'
      ? 'How would you like to create cards?'
      : method === 'manual'
        ? 'Write a flashcard'
        : method === 'context'
          ? 'Generate from chat history'
          : 'Generate from your notes';

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      eyebrow={previewOpen ? 'Step 3 of 3 · Review and save' : method === 'choose' ? 'Step 1 of 2 · Choose a method' : 'Step 2 of 2 · Add details'}
      size="large"
      footer={
        previewOpen ? (
          <>
            <button className="button button--ghost" type="button" disabled={busy} onClick={() => { setPreviewOpen(false); setError(null); }}><Icon name="arrow-left" /> Back</button>
            <button className="button button--primary" type="button" disabled={busy || drafts.length === 0} onClick={() => void acceptDrafts()}>
              {busy ? <Spinner label="Saving cards" size="small" /> : <Icon name="check" />}
              Add {drafts.length} {drafts.length === 1 ? 'card' : 'cards'}
            </button>
          </>
        ) : method === 'choose' ? (
          <button className="button button--ghost" type="button" onClick={close}>Cancel</button>
        ) : method === 'manual' ? (
          <>
            <button className="button button--ghost" type="button" disabled={busy} onClick={backToMethods}><Icon name="arrow-left" /> Back</button>
            <button className="button button--primary" type="submit" form={formId} disabled={busy}>
              {busy ? <Spinner label="Creating card" size="small" /> : <Icon name="add" />}
              Create card
            </button>
          </>
        ) : (
          <>
            <button className="button button--ghost" type="button" disabled={busy} onClick={backToMethods}><Icon name="arrow-left" /> Back</button>
            <button
              className="button button--primary"
              type="button"
              disabled={busy || (method === 'prompt' && !sourceContent.trim())}
              onClick={() => void (method === 'context' ? generateFromLearningContext() : generate())}
            >
              {busy ? <Spinner label="Generating cards" size="small" /> : <Icon name="sparkles" />}
              Generate 3 cards
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
      ) : method === 'choose' ? (
        <section className="creation-methods" aria-label="Flashcard creation methods">
          <p className="creation-methods__intro">Choose a starting point. You can review and edit anything Kiwi generates before it is saved.</p>
          <div className="creation-methods__grid">
            <button className="creation-method-card creation-method-card--recommended" type="button" onClick={() => chooseMethod('prompt')}>
              <span className="creation-method-card__icon"><Icon name="sparkles" size={22} /></span>
              <span className="creation-method-card__copy">
                <span className="creation-method-card__meta">Recommended</span>
                <strong>Generate from notes</strong>
                <span>Paste a passage, topic, or class notes and create three focused cards.</span>
              </span>
              <Icon name="arrow-right" />
            </button>
            <button className="creation-method-card" type="button" onClick={() => chooseMethod('context')}>
              <span className="creation-method-card__icon"><Icon name="study" size={22} /></span>
              <span className="creation-method-card__copy">
                <strong>Generate from chat history</strong>
                <span>Turn your recent Kiwi learning conversations into review cards.</span>
              </span>
              <Icon name="arrow-right" />
            </button>
            <button className="creation-method-card" type="button" onClick={() => chooseMethod('manual')}>
              <span className="creation-method-card__icon"><Icon name="cards" size={22} /></span>
              <span className="creation-method-card__copy">
                <strong>Write one manually</strong>
                <span>Create a single card with your own question and answer.</span>
              </span>
              <Icon name="arrow-right" />
            </button>
          </div>
        </section>
      ) : method === 'prompt' ? (
        <section className="creation-pane creation-pane--focused" aria-busy={busy}>
          <div className="section-heading">
            <span className="section-heading__icon"><Icon name="sparkles" /></span>
            <div>
              <h3>What should the cards cover?</h3>
              <p>Include enough detail for Kiwi to identify the most useful ideas to recall.</p>
            </div>
          </div>

          <label className="field">
            <span className="field__label">Notes or source material</span>
            <textarea
              value={sourceContent}
              onChange={(event) => setSourceContent(event.currentTarget.value)}
              placeholder="Paste a passage, concept summary, or class notes…"
              rows={10}
              autoFocus
            />
            <span className="field-help">Kiwi will create three drafts for you to review before saving.</span>
          </label>
          {deckChoices}
        </section>
      ) : method === 'context' ? (
        <section className="creation-pane creation-pane--focused" aria-busy={busy}>
          <div className="context-generation">
            <span className="context-generation__icon"><Icon name="study" size={28} /></span>
            <div>
              <h3>Use your recent Kiwi conversations</h3>
              <p>Kiwi will look at your recent learning activity and turn the most useful concepts into three editable flashcards.</p>
            </div>
          </div>
          <label className="field">
            <span className="field__label">What should Kiwi focus on? <small>optional</small></span>
            <textarea
              value={contextFocus}
              onChange={(event) => setContextFocus(event.currentTarget.value)}
              placeholder="For example: focus on vocabulary from today’s discussion…"
              rows={4}
              autoFocus
            />
          </label>
          {deckChoices}
        </section>
      ) : (
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

          {deckChoices}

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
      )}
    </Modal>
  );
}
