import { randomUUID } from 'node:crypto';
import { HttpError } from '../http-error';

interface ExportTicket {
  filename: string;
  contents: string;
  contentType: string;
  expiresAt: number;
}

export class ExportTicketService {
  private readonly tickets = new Map<string, ExportTicket>();

  create(input: unknown) {
    const value = input as Record<string, unknown> | null;
    const filename = typeof value?.filename === 'string' ? safeFilename(value.filename) : '';
    const contents = typeof value?.contents === 'string' ? value.contents : '';
    const format = value?.format;
    if (!filename || !contents || (format !== 'csv' && format !== 'json')) {
      throw new HttpError(400, 'A filename, file contents, and valid export format are required');
    }
    if (contents.length > 900_000) throw new HttpError(413, 'Export is too large');

    this.prune();
    const id = randomUUID();
    this.tickets.set(id, {
      filename: ensureExtension(filename, format),
      contents,
      contentType: format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      expiresAt: Date.now() + 60_000,
    });
    return id;
  }

  consume(id: string) {
    const ticket = this.tickets.get(id);
    this.tickets.delete(id);
    if (!ticket || ticket.expiresAt < Date.now()) throw new HttpError(404, 'Export link has expired');
    return ticket;
  }

  private prune() {
    const now = Date.now();
    for (const [id, ticket] of this.tickets) if (ticket.expiresAt < now) this.tickets.delete(id);
  }
}

function safeFilename(value: string) {
  return value.replace(/[\\/\r\n";]/g, '-').trim().slice(0, 120);
}

function ensureExtension(filename: string, format: 'csv' | 'json') {
  return filename.toLowerCase().endsWith(`.${format}`) ? filename : `${filename}.${format}`;
}
