import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { ApiClient } from '../api';
import { Icon, Modal, Notice, Spinner } from './ui';

export default function FlashcardCreationModal({ open, onClose, api, onCreated }: { open: boolean; onClose: () => void; api: ApiClient; onCreated: () => Promise<void> }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [sourceContent, setSourceContent] = useState('');
  const [tagText, setTagText] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();

  const reset = () => {
    setQuestion('');
    setAnswer('');
    setSourceContent('');
    setTags([]);
    setTagText('');
    setError(null);
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
      await api.generateCards({ sourceContent: sourceContent.trim(), count: 3 });
      reset();
      await onCreated();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to generate cards.');
    } finally {
      setBusy(false);
    }
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a flashcard"
      eyebrow="Build your deck"
      size="large"
      footer={
        <>
          <button className="button button--ghost" type="button" onClick={onClose}>Cancel</button>
          <button className="button button--primary" type="submit" form={formId} disabled={busy}>
            {busy ? <Spinner label="Creating card" size="small" /> : <Icon name="add" />}
            Create card
          </button>
        </>
      }
    >
      {error && <Notice tone="error" onClose={() => setError(null)}>{error}</Notice>}

      <div className="creation-grid" aria-busy={busy}>
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
      </div>
    </Modal>
  );
}
