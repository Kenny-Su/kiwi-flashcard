import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { KiwiMcpService } from './kiwi-mcp.service';

describe('KiwiMcpService', () => {
  let toolResult: any;
  let connectCalls: any[];
  let toolCalls: any[][];
  let terminateCount: number;
  let closeCount: number;
  let transportUrl: URL;
  let transportToken: string;
  const transport = {
    terminateSession: async () => { terminateCount += 1; },
  };
  const client = {
    connect: async (value: unknown) => { connectCalls.push(value); },
    callTool: async (...args: any[]) => {
      toolCalls.push(args);
      return toolResult;
    },
    close: async () => { closeCount += 1; },
  };
  const service = new KiwiMcpService(
    'http://localhost:3000',
    () => client as any,
    (url, token) => {
      transportUrl = url;
      transportToken = token;
      return transport as any;
    },
  );

  beforeEach(() => {
    toolResult = { content: [] };
    connectCalls = [];
    toolCalls = [];
    terminateCount = 0;
    closeCount = 0;
  });

  it('generates cards without detecting concepts', async () => {
    toolResult = { content: [{ type: 'text', text: '[{"question":"Q","answer":"A","concepts":["inaccurate"]}]' }] };

    const cards = await service.generateCards('app-token', 'flashcards', 'source', 1);

    assert.deepEqual(cards, [{ question: 'Q', answer: 'A' }]);
    assert.match(toolCalls[0][0].arguments.userMessage, /^Generate exactly 1 flashcard/);
  });

  it('lets Kiwi choose up to ten useful cards in auto mode', async () => {
    toolResult = { content: [{ type: 'text', text: JSON.stringify({
      flashcards: Array.from({ length: 11 }, (_, index) => ({ question: `Q${index}`, answer: `A${index}` })),
    }) }] };

    const cards = await service.generateCards('app-token', 'flashcards', 'source', 'auto');

    assert.equal(cards.length, 10);
    assert.match(toolCalls[0][0].arguments.userMessage, /Choose the number of flashcards needed/);
    assert.match(toolCalls[0][0].arguments.userMessage, /between 1 and 10 cards/);
  });

  it('parses fenced JSON', () => {
    const parsed = (service as any).parseJson('```json\n{"question":"Q","choices":["A","B"],"correctIndex":0}\n```');
    assert.equal(parsed.correctIndex, 0);
  });

  it('parses only explained card-link suggestions', async () => {
    toolResult = { content: [{ type: 'text', text: JSON.stringify({ links: [
      { sourceCardId: 'a', targetCardId: 'b', explanation: 'A and B use different approaches.' },
      { sourceCardId: 'a', targetCardId: 'c', explanation: '' },
    ] }) }] };

    const links = await service.suggestCardLinks('app-token', 'flashcards', [
      { id: 'a', question: 'A?', answer: 'A' }, { id: 'b', question: 'B?', answer: 'B' },
    ]);

    assert.deepEqual(links, [{ sourceCardId: 'a', targetCardId: 'b', explanation: 'A and B use different approaches.' }]);
  });

  it('generates one grounded card-link explanation', async () => {
    toolResult = { content: [{ type: 'text', text: '{"explanation":"A and B solve different parts of the same problem."}' }] };
    const explanation = await service.explainCardLink('app-token', 'flashcards', { question: 'A?', answer: 'A' }, { question: 'B?', answer: 'B' });
    assert.equal(explanation, 'A and B solve different parts of the same problem.');
  });

  it('rejects non-json text', () => {
    assert.throws(() => (service as any).parseJson('not json'), /AI response did not contain JSON/);
  });

  it('calls kiwi_app_chat through the Streamable HTTP MCP transport', async () => {
    toolResult = { content: [{ type: 'text', text: '{"flashcards":[]}' }] };
    const result = await (service as any).callKiwiAppChat('app-token', 'flashcards', 'generate-cards', 'source');

    assert.equal(result, '{"flashcards":[]}');
    assert.equal(connectCalls.length, 1);
    assert.equal(transportUrl.toString(), 'http://localhost:3000/mcp');
    assert.equal(transportToken, 'app-token');
    assert.deepEqual(toolCalls[0], [
      { name: 'kiwi_app_chat', arguments: { appSlug: 'flashcards', promptId: 'generate-cards', userMessage: 'source' } },
      undefined,
      { timeout: 120_000 },
    ]);
    assert.equal(terminateCount, 1);
    assert.equal(closeCount, 1);
  });

  it('surfaces MCP tool errors and still closes the session', async () => {
    toolResult = { isError: true, content: [{ type: 'text', text: 'Prompt is not active' }] };

    await assert.rejects(
      () => (service as any).callKiwiAppChat('app-token', 'flashcards', 'generate-cards', 'source'),
      /Prompt is not active/,
    );
    assert.equal(terminateCount, 1);
    assert.equal(closeCount, 1);
  });
});
