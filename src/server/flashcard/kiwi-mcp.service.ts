import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

type ClientFactory = () => Client;
type TransportFactory = (url: URL, token: string) => StreamableHTTPClientTransport;

export interface GeneratedCard {
  question: string;
  answer: string;
}

export interface MultipleChoiceQuestion {
  question: string;
  choices: string[];
  correctIndex: number;
  explanation?: string;
}

export interface SuggestedCardLink {
  sourceCardId: string;
  targetCardId: string;
  explanation: string;
}

export class KiwiMcpService {
  constructor(
    private readonly baseUrl = process.env.KIWI_API_URL || 'http://localhost:3000',
    private readonly clientFactory: ClientFactory = () => new Client({ name: 'kiwi-flashcard', version: '0.1.0' }),
    private readonly transportFactory: TransportFactory = (url, token) => new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  ) {}

  async generateCards(token: string, appSlug: string, sourceContent: string, count: number): Promise<GeneratedCard[]> {
    const userMessage = `Generate ${count} flashcards from this educational content. Return JSON only.\n\n${sourceContent}`;
    const text = await this.callKiwiAppChat(token, appSlug, 'generate-cards', userMessage);
    const parsed = this.parseJson(text);
    const cards = Array.isArray(parsed) ? parsed : Array.isArray(parsed.flashcards) ? parsed.flashcards : parsed.question ? [parsed] : [];
    return cards
      .filter((card: any) => card?.question && card?.answer)
      .slice(0, count)
      .map((card: any) => ({
        question: String(card.question),
        answer: String(card.answer),
      }));
  }

  async generateMcq(token: string, appSlug: string, card: { question: string; answer: string; concepts: string[] }, numChoices: number): Promise<MultipleChoiceQuestion> {
    const userMessage = `Create a ${numChoices}-choice multiple choice question from this flashcard. Return JSON only.\n\nQuestion: ${card.question}\nAnswer: ${card.answer}\nConcepts: ${card.concepts.join(', ')}`;
    const text = await this.callKiwiAppChat(token, appSlug, 'generate-mcq', userMessage);
    const mcq = this.parseJson(text);
    if (!mcq.question || !Array.isArray(mcq.choices) || typeof mcq.correctIndex !== 'number') {
      throw new Error('Invalid MCQ response from Kiwi prompt');
    }
    if (mcq.choices.length !== numChoices) {
      throw new Error(`Expected ${numChoices} choices, got ${mcq.choices.length}`);
    }
    if (mcq.correctIndex < 0 || mcq.correctIndex >= mcq.choices.length) {
      throw new Error('MCQ correctIndex out of bounds');
    }
    return {
      question: String(mcq.question),
      choices: mcq.choices.map(String),
      correctIndex: mcq.correctIndex,
      explanation: mcq.explanation ? String(mcq.explanation) : undefined,
    };
  }

  async suggestCardLinks(token: string, appSlug: string, cards: Array<{ id: string; question: string; answer: string }>): Promise<SuggestedCardLink[]> {
    const userMessage = `Suggest up to 12 meaningful connections between these flashcards. For each pair, write one concise sentence that explicitly names both concepts and explains their specific connection using only the card content. Never use a generic phrase such as "is related to". Return JSON only as {"links":[{"sourceCardId":"...","targetCardId":"...","explanation":"..."}]}.\n\n${JSON.stringify({ cards })}`;
    const text = await this.callKiwiAppChat(token, appSlug, 'suggest-card-links', userMessage);
    const parsed = this.parseJson(text);
    const links = Array.isArray(parsed) ? parsed : Array.isArray(parsed.links) ? parsed.links : [];
    return links
      .filter((link: any) =>
        link
        && typeof link.sourceCardId === 'string'
        && typeof link.targetCardId === 'string'
        && typeof link.explanation === 'string'
        && link.explanation.trim())
      .slice(0, 12)
      .map((link: any) => ({
        sourceCardId: link.sourceCardId,
        targetCardId: link.targetCardId,
        explanation: link.explanation.trim(),
      }));
  }

  async explainCardLink(token: string, appSlug: string, source: { question: string; answer: string }, target: { question: string; answer: string }): Promise<string> {
    const userMessage = `Write one concise sentence that explicitly names both flashcard concepts and explains their specific connection. Use only the information in the two cards. Do not say they are merely "related". Return JSON only as {"explanation":"..."}.\n\n${JSON.stringify({ source, target })}`;
    const parsed = this.parseJson(await this.callKiwiAppChat(token, appSlug, 'explain-card-link', userMessage));
    if (typeof parsed.explanation !== 'string' || !parsed.explanation.trim()) throw new Error('Invalid relationship explanation from Kiwi prompt');
    return parsed.explanation.trim();
  }

  private async callKiwiAppChat(token: string, appSlug: string, promptId: string, userMessage: string): Promise<string> {
    const client = this.clientFactory();
    const transport = this.transportFactory(new URL('/mcp', this.baseUrl), token);

    try {
      await client.connect(transport);

      const result = await client.callTool(
        {
          name: 'kiwi_app_chat',
          arguments: { appSlug, promptId, userMessage },
        },
        undefined,
        { timeout: 120_000 },
      );

      const content = Array.isArray(result.content) ? result.content : [];
      const text = content
        .filter((item: unknown): item is { type: 'text'; text: string } =>
          typeof item === 'object'
          && item !== null
          && (item as Record<string, unknown>).type === 'text'
          && typeof (item as Record<string, unknown>).text === 'string')
        .map((item) => item.text)
        .join('\n')
        .trim();

      if (result.isError) {
        throw new Error(text || 'Kiwi MCP tool returned an error');
      }
      if (!text) {
        throw new Error('Kiwi MCP response did not contain text');
      }

      return text;
    } finally {
      await transport.terminateSession().catch(() => undefined);
      await client.close().catch(() => undefined);
    }
  }

  private parseJson(text: string): any {
    const trimmed = text.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/) || trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (!match) throw new Error('AI response did not contain JSON');
      return JSON.parse(match[1]);
    }
  }
}
