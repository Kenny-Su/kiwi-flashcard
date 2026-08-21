import { useEffect, useState } from 'react';
import type { ApiClient, CardGenerationCount, GeneratedCardDraft, MaterialDocument } from '../api';
import type { Deck } from '../types';
import { Icon, Modal, Notice, Spinner } from './ui';

type Draft = GeneratedCardDraft & { id: string };
const COUNTS: CardGenerationCount[] = ['auto', 3, 5, 10];

export default function ClassDeckGenerationModal({ deck, api, onClose, onPublished }: { deck: Deck; api: ApiClient; onClose: () => void; onPublished: () => Promise<void> }) {
  const [materials, setMaterials] = useState<MaterialDocument[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [count, setCount] = useState<CardGenerationCount>(3);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    if (!api.canReadMaterials) return;
    setBusy(true);
    api.listMaterials().then(setMaterials).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load class materials.')).finally(() => setBusy(false));
  }, [api]);

  const generate = async () => {
    if (!selected.length) return;
    setBusy(true); setError(null);
    try {
      const result = await api.generateClassCardsFromMaterials(deck.id, { documentIds: selected, count });
      if (!result.cards.length) { setError('No usable cards were generated. Try different material.'); return; }
      setDrafts(result.cards.map((card, index) => ({ ...card, id: `${Date.now()}-${index}` })));
      setTruncated(result.truncated); setReviewing(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Generation failed.'); }
    finally { setBusy(false); }
  };

  const publish = async () => {
    if (!drafts.length || drafts.some((draft) => !draft.question.trim() || !draft.answer.trim())) { setError('Every accepted card needs a question and answer.'); return; }
    setBusy(true); setError(null);
    try {
      const documents = materials.filter((material) => selected.includes(material.documentId));
      await api.createClassCards(deck.id, drafts.map((draft) => ({ question: draft.question.trim(), answer: draft.answer.trim(), sourceContent: documents.map((document) => document.fileName).join(', '), materialType: 'class-material', pdfId: documents.length === 1 ? documents[0].documentId : undefined })));
      await onPublished(); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not publish cards.'); }
    finally { setBusy(false); }
  };

  const update = (id: string, key: 'question' | 'answer', value: string) => setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, [key]: value } : draft));
  const footer = !api.canReadMaterials ? <button className="button button--ghost" type="button" onClick={onClose}>Close</button> : reviewing ? <><button className="button button--ghost" disabled={busy} type="button" onClick={() => setReviewing(false)}><Icon name="arrow-left" /> Back</button><button className="button button--primary" disabled={busy || !drafts.length} type="button" onClick={() => void publish()}>{busy ? <Spinner label="Publishing" size="small" /> : <Icon name="check" />} Publish {drafts.length} {drafts.length === 1 ? 'card' : 'cards'}</button></> : <><button className="button button--ghost" disabled={busy} type="button" onClick={onClose}>Cancel</button><button className="button button--primary" disabled={busy || !selected.length} type="button" onClick={() => void generate()}>{busy ? <Spinner label="Generating" size="small" /> : <Icon name="sparkles" />} Generate drafts</button></>;

  return <Modal open title={reviewing ? 'Review class card drafts' : `Generate cards for ${deck.name}`} eyebrow={reviewing ? 'Review before publishing' : 'From class materials'} size="large" onClose={onClose} footer={footer}>
    {error && <Notice tone="error" onClose={() => setError(null)}>{error}</Notice>}
    {!api.canReadMaterials ? <Notice tone="info">This app needs the <code>class:materials:chunks:read</code> scope before it can generate from class materials.</Notice> : reviewing ? <section className="generation-preview"><p className="generation-preview__intro">Nothing is published yet. Edit the drafts or remove cards you do not want students to see.</p>{truncated && <Notice tone="info">The selected materials exceeded one generation pass. Select fewer documents for deeper coverage.</Notice>}<div className="generation-preview__list">{drafts.map((draft, index) => <article className="generation-preview__card" key={draft.id}><header className="generation-preview__header"><strong>Draft {index + 1}</strong><button className="icon-button icon-button--small icon-button--danger" type="button" onClick={() => setDrafts((current) => current.filter((item) => item.id !== draft.id))} aria-label={`Reject draft ${index + 1}`}><Icon name="trash" size={15} /></button></header><label className="field"><span className="field__label">Question</span><textarea rows={3} value={draft.question} onChange={(event) => update(draft.id, 'question', event.currentTarget.value)} /></label><label className="field"><span className="field__label">Answer</span><textarea rows={4} value={draft.answer} onChange={(event) => update(draft.id, 'answer', event.currentTarget.value)} /></label></article>)}</div></section> : <section><p className="generation-preview__intro">Choose lecture notes, slides, or readings. Kiwi creates drafts; only cards you approve are published.</p>{busy && !materials.length ? <div className="loading-state"><Spinner label="Loading materials" /></div> : materials.length ? <div className="admin-card-list">{materials.map((material) => <label key={material.documentId}><input type="checkbox" checked={selected.includes(material.documentId)} onChange={() => setSelected((current) => current.includes(material.documentId) ? current.filter((id) => id !== material.documentId) : [...current, material.documentId])} /> <strong>{material.fileName}</strong> <small>{material.totalChunks} sections</small></label>)}</div> : <Notice>No parsed class materials are available yet.</Notice>}<fieldset className="field generation-count"><legend className="field__label">Number of cards</legend><div className="generation-count__options">{COUNTS.map((value) => <button type="button" key={value} aria-pressed={count === value} onClick={() => setCount(value)}>{value === 'auto' ? 'Auto' : value}</button>)}</div></fieldset></section>}
  </Modal>;
}
