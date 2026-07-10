import type { Card, Deck, MultipleChoiceQuestion, Stats } from './types';

export interface GeneratedCardDraft {
  question: string;
  answer: string;
}

export type AcceptedCardDraft = GeneratedCardDraft & {
  sourceContent?: string;
  deckId?: string;
  tags?: string[];
};

export interface ApiClient {
  listCards(): Promise<Card[]>;
  searchCards(q: string): Promise<Card[]>;
  createCard(input: Partial<Card> & { question: string; answer: string }): Promise<Card>;
  createCards(input: AcceptedCardDraft[]): Promise<Card[]>;
  updateCard(id: string, input: Partial<Card>): Promise<Card>;
  deleteCard(id: string): Promise<void>;
  generateCards(input: { sourceContent: string; count: number; deckId?: string }): Promise<GeneratedCardDraft[]>;
  generateMcq(id: string, numChoices?: number): Promise<MultipleChoiceQuestion>;
  recordReview(input: { cardId: string; isCorrect: boolean; sessionId?: string }): Promise<void>;
  getStats(): Promise<Stats>;
  listDecks(): Promise<Deck[]>;
  createDeck(input: { name: string; description?: string }): Promise<Deck>;
  startSession(deckId?: string): Promise<{ id: string }>;
  endSession(sessionId: string): Promise<void>;
}

export function createApiClient(token: string, classId: string): ApiClient {
  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `Request failed: ${response.status}`);
    }
    if (response.status === 204) return undefined as T;
    return response.json();
  }

  const classQuery = `classId=${encodeURIComponent(classId)}`;
  return {
    listCards: () => request(`/api/cards?${classQuery}`),
    searchCards: (q) => request(`/api/cards/search?${classQuery}&q=${encodeURIComponent(q)}`),
    createCard: (input) => request('/api/cards', { method: 'POST', body: JSON.stringify({ ...input, classId }) }),
    createCards: (cards) => request('/api/cards/batch', {
      method: 'POST',
      body: JSON.stringify({ cards: cards.map((card) => ({ ...card, classId })) }),
    }),
    updateCard: (id, input) => request(`/api/cards/${id}`, { method: 'PATCH', body: JSON.stringify({ ...input, classId }) }),
    deleteCard: async (id) => { await request(`/api/cards/${id}`, { method: 'DELETE' }); },
    generateCards: (input) => request('/api/cards/generate', { method: 'POST', body: JSON.stringify({ ...input, classId }) }),
    generateMcq: (id, numChoices = 4) => request(`/api/cards/${id}/mcq`, { method: 'POST', body: JSON.stringify({ numChoices }) }),
    recordReview: (input) => request('/api/reviews', { method: 'POST', body: JSON.stringify(input) }),
    getStats: () => request(`/api/stats?${classQuery}`),
    listDecks: () => request(`/api/decks?${classQuery}`),
    createDeck: (input) => request('/api/decks', { method: 'POST', body: JSON.stringify({ ...input, classId }) }),
    startSession: (deckId) => request('/api/sessions', { method: 'POST', body: JSON.stringify({ deckId }) }),
    endSession: async (sessionId) => { await request(`/api/sessions/${sessionId}/end`, { method: 'POST' }); },
  };
}
