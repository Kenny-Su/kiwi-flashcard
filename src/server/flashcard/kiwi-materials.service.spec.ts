import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { HttpError } from '../http-error';
import type { AppRequestContext } from '../auth/app-token.types';
import { KiwiMaterialsService } from './kiwi-materials.service';

type Page = {
  documents: Array<{
    documentId: string;
    fileName: string;
    totalChunks: number;
    chunks: Array<{ chunkId: string; index: number; pageNumber: number | null; type: string; text: string }>;
  }>;
  nextCursor?: string | null;
};

function chunk(text: string, pageNumber: number | null = 1) {
  return { chunkId: `c-${text.slice(0, 8)}`, index: 0, pageNumber, type: 'CompositeElement', text };
}

function context(overrides: Partial<AppRequestContext> = {}): AppRequestContext {
  return {
    userId: 'user-1',
    classId: 'class-1',
    appSlug: 'flashcards',
    scopes: ['class:materials:chunks:read'],
    token: 'app-token',
    ...overrides,
  };
}

describe('KiwiMaterialsService', () => {
  let requests: URL[];
  let headers: Array<Record<string, string>>;
  let pages: Page[];
  let failure: { status: number; body?: unknown } | null;
  let clock: number;

  const fetchImpl = (async (url: URL | RequestInfo, init?: RequestInit) => {
    requests.push(url as URL);
    headers.push((init?.headers || {}) as Record<string, string>);

    if (failure) {
      return {
        ok: false,
        status: failure.status,
        json: async () => failure!.body ?? {},
      } as unknown as Response;
    }

    const page = pages.shift() || { documents: [] };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        classId: 'class-1',
        documents: page.documents,
        nextCursor: page.nextCursor ?? null,
        hasMore: Boolean(page.nextCursor),
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const service = () => new KiwiMaterialsService('http://kiwi.test', fetchImpl, () => clock);

  beforeEach(() => {
    requests = [];
    headers = [];
    pages = [];
    failure = null;
    clock = 1_000;
  });

  it('lists every document across pages without repeating one', async () => {
    pages = [
      {
        documents: [{ documentId: 'doc-1', fileName: 'week1.pdf', totalChunks: 3, chunks: [chunk('a')] }],
        nextCursor: 'cursor-1',
      },
      {
        documents: [
          { documentId: 'doc-1', fileName: 'week1.pdf', totalChunks: 3, chunks: [chunk('b')] },
          { documentId: 'doc-2', fileName: 'week2.pdf', totalChunks: 1, chunks: [chunk('c')] },
        ],
      },
    ];

    const documents = await service().listDocuments(context());

    assert.deepEqual(documents, [
      { documentId: 'doc-1', fileName: 'week1.pdf', totalChunks: 3 },
      { documentId: 'doc-2', fileName: 'week2.pdf', totalChunks: 1 },
    ]);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].pathname, '/api/kiwi-apps/classes/class-1/document-chunks');
    assert.equal(requests[0].searchParams.get('limit'), '200');
    assert.equal(requests[1].searchParams.get('cursor'), 'cursor-1');
    assert.equal(headers[0].Authorization, 'Bearer app-token');
  });

  it('serves the document list from cache until it expires', async () => {
    const materials = service();
    pages = [{ documents: [{ documentId: 'doc-1', fileName: 'week1.pdf', totalChunks: 1, chunks: [chunk('a')] }] }];

    await materials.listDocuments(context());
    await materials.listDocuments(context());
    assert.equal(requests.length, 1);

    clock += 5 * 60_000 + 1;
    pages = [{ documents: [{ documentId: 'doc-2', fileName: 'week2.pdf', totalChunks: 1, chunks: [chunk('b')] }] }];
    const refreshed = await materials.listDocuments(context());

    assert.equal(requests.length, 2);
    assert.deepEqual(refreshed.map((document) => document.documentId), ['doc-2']);
  });

  it('refuses to call Kiwi when the token has no materials scope', async () => {
    await assert.rejects(
      () => service().listDocuments(context({ scopes: ['llm:prompt:generate-cards'] })),
      (error: HttpError) => error.status === 403 && /class:materials:chunks:read/.test(error.message),
    );
    assert.equal(requests.length, 0);
  });

  it('accepts a wildcard scope grant', () => {
    assert.equal(KiwiMaterialsService.hasMaterialsScope(['class:materials:*']), true);
    assert.equal(KiwiMaterialsService.hasMaterialsScope(['class:info:read']), false);
  });

  it('assembles selected documents into prompt source with file and page markers', async () => {
    pages = [{
      documents: [{
        documentId: 'doc-1',
        fileName: 'week1.pdf',
        totalChunks: 2,
        chunks: [chunk('Recursion calls itself.', 4), chunk('Base cases stop it.', null)],
      }],
    }];

    const source = await service().getSourceText(context(), ['doc-1']);

    assert.equal(source.text, '## week1.pdf\n[p. 4] Recursion calls itself.\nBase cases stop it.');
    assert.equal(source.truncated, false);
    assert.deepEqual(source.documents, [{ documentId: 'doc-1', fileName: 'week1.pdf', totalChunks: 2 }]);
    assert.equal(requests[0].searchParams.get('documentIds'), 'doc-1');
  });

  it('stops at the source cap and reports truncation', async () => {
    pages = [
      {
        documents: [{
          documentId: 'doc-1',
          fileName: 'big.pdf',
          totalChunks: 2,
          chunks: [chunk('x'.repeat(20_000), 1), chunk('y'.repeat(20_000), 2)],
        }],
        nextCursor: 'cursor-1',
      },
      { documents: [{ documentId: 'doc-2', fileName: 'never.pdf', totalChunks: 1, chunks: [chunk('z')] }] },
    ];

    const source = await service().getSourceText(context(), ['doc-1', 'doc-2']);

    assert.equal(source.truncated, true);
    assert.ok(source.text.includes('x'.repeat(20_000)));
    assert.ok(!source.text.includes('y'.repeat(20_000)));
    assert.equal(requests.length, 1, 'should stop paging once the cap is reached');
  });

  it('reports an empty selection as a 404 rather than an empty prompt', async () => {
    pages = [{ documents: [{ documentId: 'doc-1', fileName: 'blank.pdf', totalChunks: 1, chunks: [chunk('   ')] }] }];

    await assert.rejects(
      () => service().getSourceText(context(), ['doc-1']),
      (error: HttpError) => error.status === 404,
    );
  });

  it('turns an expired token into a reload hint', async () => {
    failure = { status: 401 };

    await assert.rejects(
      () => service().listDocuments(context()),
      (error: HttpError) => error.status === 401 && /Reload the page/.test(error.message),
    );
  });

  it('passes a Kiwi 403 message through', async () => {
    failure = { status: 403, body: { message: 'App token is scoped to class "other"' } };

    await assert.rejects(
      () => service().listDocuments(context()),
      (error: HttpError) => error.status === 403 && /scoped to class "other"/.test(error.message),
    );
  });

  it('reports an unreachable Kiwi as a gateway error', async () => {
    const materials = new KiwiMaterialsService('http://kiwi.test', (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof fetch, () => clock);

    await assert.rejects(
      () => materials.listDocuments(context()),
      (error: HttpError) => error.status === 502 && /ECONNREFUSED/.test(error.message),
    );
  });
});
