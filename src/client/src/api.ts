import type { Card, CardLink, Deck, MultipleChoiceQuestion, Stats, SuggestedCardLink } from './types';
import type { ContextualChatResponse } from './kiwiBridge';

export interface GeneratedCardDraft {
  question: string;
  answer: string;
}

export type AcceptedCardDraft = GeneratedCardDraft & {
  sourceContent?: string;
  deckId?: string;
  deckIds?: string[];
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
  generateCardsFromContext(input: { count: number; focus?: string }): Promise<GeneratedCardDraft[]>;
  generateMcq(id: string, numChoices?: number): Promise<MultipleChoiceQuestion>;
  listCardLinks(deckId: string): Promise<CardLink[]>;
  createCardLinks(links: Array<{ sourceCardId: string; targetCardId: string; explanation: string }>): Promise<CardLink[]>;
  explainCardLink(sourceCardId: string, targetCardId: string): Promise<{ explanation: string }>;
  updateCardLink(id: string, explanation: string): Promise<CardLink>;
  deleteCardLink(id: string): Promise<void>;
  suggestCardLinks(deckId: string): Promise<SuggestedCardLink[]>;
  recordReview(input: { cardId: string; isCorrect: boolean; sessionId?: string }): Promise<void>;
  getStats(): Promise<Stats>;
  listDecks(): Promise<Deck[]>;
  createDeck(input: { name: string; description?: string }): Promise<Deck>;
  updateDeck(id: string, input: { name?: string; description?: string | null }): Promise<Deck>;
  deleteDeck(id: string): Promise<void>;
  addCardToDeck(deckId: string, cardId: string): Promise<Card>;
  removeCardFromDeck(deckId: string, cardId: string): Promise<Card>;
  reorderDeckCards(deckId: string, cardIds: string[]): Promise<Card[]>;
  startSession(deckId?: string): Promise<{ id: string }>;
  endSession(sessionId: string): Promise<void>;
}

export function createApiClient(
  token: string,
  classId: string,
  contextualChat: (params: Record<string, unknown>) => Promise<ContextualChatResponse>,
): ApiClient {
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
    generateCardsFromContext: async ({ count, focus }) => {
      const retrievalQuery = focus?.trim().slice(0, 500) || undefined;
      const response = await contextualChat({
        promptId: 'generate-cards',
        userMessage: `Generate ${count} personalized flashcards from my learning context.${retrievalQuery ? ` Focus on: ${retrievalQuery}.` : ''}`,
        contextRequest: {
          kind: 'student_learning_context',
          scope: 'current_user_current_class',
          timeWindowDays: 30,
          include: ['recent_questions', 'weak_concepts', 'relevant_materials'],
          retrievalQuery,
        },
        outputSchema: {
          type: 'object',
          properties: {
            flashcards: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  question: { type: 'string' },
                  answer: { type: 'string' },
                },
                required: ['question', 'answer'],
                additionalProperties: false,
              },
            },
          },
          required: ['flashcards'],
          additionalProperties: false,
        },
      });
      const parsed = JSON.parse(response.output) as { flashcards?: GeneratedCardDraft[] };
      return (parsed.flashcards || [])
        .filter((card) => typeof card?.question === 'string' && typeof card?.answer === 'string')
        .slice(0, count);
    },
    generateMcq: (id, numChoices = 4) => request(`/api/cards/${id}/mcq`, { method: 'POST', body: JSON.stringify({ numChoices }) }),
    listCardLinks: (deckId) => request(`/api/card-links?deckId=${encodeURIComponent(deckId)}&${classQuery}`),
    createCardLinks: (links) => request('/api/card-links', { method: 'POST', body: JSON.stringify({ links }) }),
    explainCardLink: (sourceCardId, targetCardId) => request('/api/card-links/explain', { method: 'POST', body: JSON.stringify({ sourceCardId, targetCardId }) }),
    updateCardLink: (id, explanation) => request(`/api/card-links/${id}`, { method: 'PATCH', body: JSON.stringify({ explanation }) }),
    deleteCardLink: async (id) => { await request(`/api/card-links/${id}`, { method: 'DELETE' }); },
    suggestCardLinks: (deckId) => request('/api/card-links/suggest', { method: 'POST', body: JSON.stringify({ deckId }) }),
    recordReview: (input) => request('/api/reviews', { method: 'POST', body: JSON.stringify(input) }),
    getStats: () => request(`/api/stats?${classQuery}`),
    listDecks: () => request(`/api/decks?${classQuery}`),
    createDeck: (input) => request('/api/decks', { method: 'POST', body: JSON.stringify({ ...input, classId }) }),
    updateDeck: (id, input) => request(`/api/decks/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    deleteDeck: async (id) => { await request(`/api/decks/${id}`, { method: 'DELETE' }); },
    addCardToDeck: (deckId, cardId) => request(`/api/decks/${deckId}/cards/${cardId}`, { method: 'POST' }),
    removeCardFromDeck: (deckId, cardId) => request(`/api/decks/${deckId}/cards/${cardId}`, { method: 'DELETE' }),
    reorderDeckCards: (deckId, cardIds) => request(`/api/decks/${deckId}/cards/order`, { method: 'PUT', body: JSON.stringify({ cardIds }) }),
    startSession: (deckId) => request('/api/sessions', { method: 'POST', body: JSON.stringify({ deckId }) }),
    endSession: async (sessionId) => { await request(`/api/sessions/${sessionId}/end`, { method: 'POST' }); },
  };
}
