import type { Card, CardLink, Deck, MultipleChoiceQuestion, Stats, SuggestedCardLink } from './types';
import type { ContextualChatResponse } from './kiwiBridge';

export interface GeneratedCardDraft {
  question: string;
  answer: string;
}

export type CardGenerationCount = 'auto' | 3 | 5 | 10;

export type AcceptedCardDraft = GeneratedCardDraft & {
  sourceContent?: string;
  deckId?: string;
  deckIds?: string[];
  tags?: string[];
  pdfId?: string;
  materialType?: string;
};

export interface MaterialDocument {
  documentId: string;
  fileName: string;
  totalChunks: number;
}

export interface MaterialGeneration {
  cards: GeneratedCardDraft[];
  documents: MaterialDocument[];
  /** True when the documents held more text than one generation pass can use. */
  truncated: boolean;
}

/** Kiwi scope that lets this app read the class's parsed document text. */
export const MATERIALS_SCOPE = 'class:materials:chunks:read';

export interface ApiClient {
  /**
   * Whether Kiwi granted class-material access for this class. Checked from the
   * token's own scopes so the UI can explain the gap instead of failing a call.
   */
  canReadMaterials: boolean;
  listMaterials(): Promise<MaterialDocument[]>;
  generateCardsFromMaterials(input: { documentIds: string[]; count: CardGenerationCount; deckId?: string }): Promise<MaterialGeneration>;
  listCards(): Promise<Card[]>;
  searchCards(q: string): Promise<Card[]>;
  createCard(input: Partial<Card> & { question: string; answer: string }): Promise<Card>;
  createCards(input: AcceptedCardDraft[]): Promise<Card[]>;
  updateCard(id: string, input: Partial<Card>): Promise<Card>;
  deleteCard(id: string): Promise<void>;
  generateCards(input: { sourceContent: string; count: CardGenerationCount; deckId?: string }): Promise<GeneratedCardDraft[]>;
  generateCardsFromContext(input: { count: CardGenerationCount; focus?: string }): Promise<GeneratedCardDraft[]>;
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
  listClassDecks(): Promise<Deck[]>;
  createClassDeck(input: { name: string; description?: string }): Promise<Deck>;
  updateClassDeck(id: string, input: { name?: string; description?: string | null }): Promise<Deck>;
  deleteClassDeck(id: string): Promise<void>;
  createClassCard(input: { deckId: string; question: string; answer: string; concepts?: string[]; tags?: string[] }): Promise<Card>;
  updateClassCard(id: string, input: { question: string; answer: string; concepts?: string[]; tags?: string[] }): Promise<Card>;
  deleteClassCard(id: string): Promise<void>;
  reorderClassDeckCards(deckId: string, cardIds: string[]): Promise<Card[]>;
  createDeck(input: { name: string; description?: string }): Promise<Deck>;
  updateDeck(id: string, input: { name?: string; description?: string | null }): Promise<Deck>;
  deleteDeck(id: string): Promise<void>;
  addCardToDeck(deckId: string, cardId: string): Promise<Card>;
  removeCardFromDeck(deckId: string, cardId: string): Promise<Card>;
  reorderDeckCards(deckId: string, cardIds: string[]): Promise<Card[]>;
  startSession(deckId?: string): Promise<{ id: string }>;
  endSession(sessionId: string): Promise<void>;
  prepareExport(input: { filename: string; contents: string; format: 'csv' | 'json' }): Promise<{ downloadUrl: string }>;
}

export function createApiClient(
  getToken: (staleToken?: string) => Promise<string>,
  classId: string,
  contextualChat: (params: Record<string, unknown>) => Promise<ContextualChatResponse>,
  scopes: string[] = [],
): ApiClient {
  async function request<T>(path: string, options: RequestInit = {}, retryUnauthorized = true): Promise<T> {
    const token = await getToken();
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });

    // App tokens expire after an hour, which is well inside a study session.
    // A 401 means ours is spent (or was revoked): ask the host for a fresh one
    // and replay the call once, so the student never sees the gap. Passing the
    // rejected token keeps a late 401 from re-minting one someone else already
    // replaced. `options.body` is always a string here, so it is safe to resend.
    if (response.status === 401 && retryUnauthorized) {
      await getToken(token);
      return request<T>(path, options, false);
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `Request failed: ${response.status}`);
    }
    if (response.status === 204) return undefined as T;
    return response.json();
  }

  const classQuery = `classId=${encodeURIComponent(classId)}`;
  // Mirrors Kiwi's wildcard-aware scope match, so a `class:materials:*` grant counts.
  const canReadMaterials = scopes.some((scope) => scope === MATERIALS_SCOPE
    || (scope.endsWith(':*') && MATERIALS_SCOPE.startsWith(scope.slice(0, -1))));

  return {
    canReadMaterials,
    listMaterials: async () => (await request<{ documents: MaterialDocument[] }>(`/api/materials?${classQuery}`)).documents,
    generateCardsFromMaterials: (input) => request('/api/cards/generate-from-materials', {
      method: 'POST',
      body: JSON.stringify({ ...input, classId }),
    }),
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
      const maxCards = count === 'auto' ? 10 : count;
      const quantityInstruction = count === 'auto'
        ? 'Choose the number of personalized flashcards needed to cover the distinct, useful concepts in my learning context. Generate between 1 and 10 cards, and avoid redundant or trivial cards.'
        : `Generate exactly ${count} personalized flashcards from my learning context.`;
      const response = await contextualChat({
        promptId: 'generate-cards',
        userMessage: `${quantityInstruction}${retrievalQuery ? ` Focus on: ${retrievalQuery}.` : ''}`,
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
              minItems: count === 'auto' ? 1 : count,
              maxItems: maxCards,
            },
          },
          required: ['flashcards'],
          additionalProperties: false,
        },
      });
      const parsed = JSON.parse(response.output) as { flashcards?: GeneratedCardDraft[] };
      const cards = Array.isArray(parsed.flashcards) ? parsed.flashcards : [];
      return cards
        .filter((card) => typeof card?.question === 'string' && typeof card?.answer === 'string')
        .slice(0, maxCards);
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
    listClassDecks: () => request(`/api/class-decks?${classQuery}`),
    createClassDeck: (input) => request('/api/class-decks', { method: 'POST', body: JSON.stringify({ ...input, classId }) }),
    updateClassDeck: (id, input) => request(`/api/class-decks/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    deleteClassDeck: async (id) => { await request(`/api/class-decks/${id}`, { method: 'DELETE' }); },
    createClassCard: (input) => request('/api/class-cards', { method: 'POST', body: JSON.stringify({ ...input, classId }) }),
    updateClassCard: (id, input) => request(`/api/class-cards/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    deleteClassCard: async (id) => { await request(`/api/class-cards/${id}`, { method: 'DELETE' }); },
    reorderClassDeckCards: (deckId, cardIds) => request(`/api/class-decks/${deckId}/cards/order`, { method: 'PUT', body: JSON.stringify({ cardIds }) }),
    createDeck: (input) => request('/api/decks', { method: 'POST', body: JSON.stringify({ ...input, classId }) }),
    updateDeck: (id, input) => request(`/api/decks/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    deleteDeck: async (id) => { await request(`/api/decks/${id}`, { method: 'DELETE' }); },
    addCardToDeck: (deckId, cardId) => request(`/api/decks/${deckId}/cards/${cardId}`, { method: 'POST' }),
    removeCardFromDeck: (deckId, cardId) => request(`/api/decks/${deckId}/cards/${cardId}`, { method: 'DELETE' }),
    reorderDeckCards: (deckId, cardIds) => request(`/api/decks/${deckId}/cards/order`, { method: 'PUT', body: JSON.stringify({ cardIds }) }),
    startSession: (deckId) => request('/api/sessions', { method: 'POST', body: JSON.stringify({ deckId }) }),
    endSession: async (sessionId) => { await request(`/api/sessions/${sessionId}/end`, { method: 'POST' }); },
    prepareExport: (input) => request('/api/exports', { method: 'POST', body: JSON.stringify(input) }),
  };
}
