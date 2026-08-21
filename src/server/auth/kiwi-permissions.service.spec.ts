import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AppRequestContext } from './app-token.types';
import { KiwiPermissionsService } from './kiwi-permissions.service';

const context: AppRequestContext = {
  userId: 'user-1', classId: 'class-1', appSlug: 'flashcards', scopes: [], token: 'token',
};

describe('KiwiPermissionsService', () => {
  it('accepts professors and binds the check to the token user and class', async () => {
    let requested = '';
    const service = new KiwiPermissionsService('https://kiwi.example', async (input) => {
      requested = String(input);
      return new Response(JSON.stringify({ role: 'professor' }), { status: 200 });
    });
    await service.requireClassManager(context);
    assert.equal(requested, 'https://kiwi.example/api/permissions/class-role?userId=user-1&classId=class-1');
  });

  it('rejects students', async () => {
    const service = new KiwiPermissionsService('https://kiwi.example', async () =>
      new Response(JSON.stringify({ role: 'student' }), { status: 200 }));
    await assert.rejects(() => service.requireClassManager(context), /Only class instructors/);
  });
});
