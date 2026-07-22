import type { Card, Deck } from './types';

export type ExportFormat = 'csv' | 'json';

export interface ExportCollection {
  name: string;
  cards: Card[];
  deck?: Pick<Deck, 'id' | 'name' | 'description'>;
}

export function prepareCardsExport(collection: ExportCollection, format: ExportFormat) {
  const filename = `${safeFilename(collection.name)}.${format}`;
  const contents = format === 'csv' ? cardsToCsv(collection.cards) : cardsToJson(collection);
  return { filename, contents, format };
}

export function cardsToCsv(cards: Card[]) {
  const rows = [
    ['question', 'answer', 'tags', 'concepts', 'source_content'],
    ...cards.map((card) => [card.question, card.answer, card.tags.join(', '), card.concepts.join(', '), card.sourceContent || '']),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function cardsToJson({ name, cards, deck }: ExportCollection) {
  return `${JSON.stringify({
    format: 'kiwi-flashcards',
    version: 1,
    exportedAt: new Date().toISOString(),
    collection: deck ? { type: 'deck', name: deck.name, description: deck.description || null } : { type: 'library', name },
    cards: cards.map((card) => ({
      question: card.question,
      answer: card.answer,
      tags: card.tags,
      concepts: card.concepts,
      sourceContent: card.sourceContent || null,
      source: card.pdfId || card.pageNumber || card.materialType ? {
        pdfId: card.pdfId || null,
        pageNumber: card.pageNumber || null,
        materialType: card.materialType || null,
      } : null,
    })),
  }, null, 2)}\n`;
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function safeFilename(value: string) {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return cleaned || 'kiwi-flashcards';
}
