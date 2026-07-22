import { useState } from 'react';
import type { ApiClient } from '../api';
import type { Card, Deck } from '../types';
import { prepareCardsExport, type ExportFormat } from '../export';
import { Icon, Modal, Notice, Spinner } from './ui';

export default function ExportModal({ open, name, cards, deck, api, onClose }: {
  open: boolean;
  name: string;
  cards: Card[];
  deck?: Pick<Deck, 'id' | 'name' | 'description'>;
  api: ApiClient;
  onClose: () => void;
}) {
  const [downloaded, setDownloaded] = useState<ExportFormat | null>(null);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const download = async (format: ExportFormat) => {
    setBusy(format); setError(null);
    const downloadWindow = window.open('about:blank', '_blank');
    try {
      const file = prepareCardsExport({ name, cards, deck }, format);
      const { downloadUrl } = await api.prepareExport(file);
      if (downloadWindow) downloadWindow.location.href = downloadUrl;
      else window.location.href = downloadUrl;
      setDownloaded(format);
    } catch (requestError) {
      downloadWindow?.close();
      setError(requestError instanceof Error ? requestError.message : 'Could not prepare the export.');
    } finally { setBusy(null); }
  };

  return <Modal open={open} title={`Export ${name}`} eyebrow={`${cards.length} ${cards.length === 1 ? 'card' : 'cards'}`} size="small" onClose={onClose} footer={<button className="button button--ghost" type="button" onClick={onClose}>Done</button>}>
    <p className="export-copy">Download questions, answers, tags, concepts, and source references. Study history and account details are not included.</p>
    {error && <Notice tone="error" onClose={() => setError(null)}>{error}</Notice>}
    {downloaded && <Notice tone="success">{downloaded.toUpperCase()} download opened.</Notice>}
    <div className="export-options">
      <button className="button button--secondary" type="button" disabled={!cards.length || Boolean(busy)} onClick={() => void download('csv')}>{busy === 'csv' ? <Spinner label="Preparing CSV" size="small" /> : <Icon name="download" />} Download CSV</button>
      <p>Best for spreadsheets and importing into other flashcard tools.</p>
      <button className="button button--secondary" type="button" disabled={!cards.length || Boolean(busy)} onClick={() => void download('json')}>{busy === 'json' ? <Spinner label="Preparing JSON" size="small" /> : <Icon name="download" />} Download JSON</button>
      <p>Best for preserving Kiwi-specific card details.</p>
    </div>
  </Modal>;
}
