import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ExportTicketService } from './export-tickets';

describe('ExportTicketService', () => {
  it('creates a single-use attachment ticket', () => {
    const service = new ExportTicketService();
    const id = service.create({ filename: 'Biology.csv', contents: 'question,answer\r\nQ,A', format: 'csv' });
    const file = service.consume(id);

    assert.equal(file.filename, 'Biology.csv');
    assert.equal(file.contentType, 'text/csv; charset=utf-8');
    assert.match(file.contents, /question,answer/);
    assert.throws(() => service.consume(id), /expired/);
  });

  it('sanitizes filenames and rejects malformed exports', () => {
    const service = new ExportTicketService();
    const id = service.create({ filename: '../cards\n.json', contents: '{}', format: 'json' });
    assert.equal(service.consume(id).filename, '..-cards-.json');
    assert.throws(() => service.create({ filename: 'cards.csv', contents: '', format: 'csv' }), /required/);
  });
});
