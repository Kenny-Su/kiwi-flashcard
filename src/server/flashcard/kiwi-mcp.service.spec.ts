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

  it('parses generated cards from an array', () => {
    const parsed = (service as any).parseJson('[{"question":"Q","answer":"A","concepts":["c"]}]');
    assert.equal(parsed[0].question, 'Q');
  });

  it('parses fenced JSON', () => {
    const parsed = (service as any).parseJson('```json\n{"question":"Q","choices":["A","B"],"correctIndex":0}\n```');
    assert.equal(parsed.correctIndex, 0);
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
