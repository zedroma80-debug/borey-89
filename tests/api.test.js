import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { openStore, createRoom, rotateCode, digest } from '../server/store.js';

const db = openStore(':memory:');
const room = createRoom(db, 'test-obr-room');
const other = createRoom(db, 'other-obr-room');
let server, base;
const tokens = {};
async function request(path, { token, method = 'GET', body, roomId = 'test-obr-room' } = {}) {
  const response = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token, 'X-OBR-Room': roomId } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
before(async () => {
  server = createApp(db).listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api`;
  for (const entry of room.codes) {
    const login = await request('/login', { method: 'POST', body: { code: entry.code, roomId: room.obrId } });
    assert.equal(login.status, 200); tokens[entry.slot ?? 'gm'] = login.body.token;
  }
});
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
const get = async token => (await request('/sheets', { token })).body;

test('API requires independent credentials; room ID and client GM claim do not authenticate', async () => {
  assert.equal((await request('/sheets')).status, 401);
  assert.equal((await request('/login', { method: 'POST', body: { roomId: room.obrId, code: 'GM', role: 'GM' } })).status, 401);
  assert.equal((await request('/login', { method: 'POST', body: { roomId: other.obrId, code: room.codes[0].code } })).status, 401);
  assert.equal((await request('/sheets', { token: tokens.gm, roomId: other.obrId })).status, 403);
});
test('four players each receive exactly their own sheet and no hidden fields', async () => {
  for (let slot = 0; slot < 4; slot++) {
    const result = await get(tokens[slot]);
    assert.equal(result.role, 'PLAYER'); assert.equal(result.sheets.length, 1); assert.equal(result.sheets[0].slot, slot);
    assert.equal(Object.hasOwn(result.sheets[0], 'hidden'), false);
    assert.equal(/infection|hallucinations|cold/.test(JSON.stringify(result)), false);
  }
  const gm = await get(tokens.gm);
  assert.equal(gm.role, 'GM'); assert.equal(gm.sheets.length, 4);
});
test('player cannot edit another sheet or inject hidden fields', async () => {
  const own = (await get(tokens[0])).sheets[0];
  assert.equal((await request('/sheets/1', { token: tokens[0], method: 'PATCH', body: { revision: 0, character: own.character } })).status, 403);
  assert.equal((await request('/sheets/0', { token: tokens[0], method: 'PATCH', body: { revision: own.revision, character: own.character, hidden: { infection: 10, cold: 10, hallucinations: 10 } } })).status, 403);
  assert.equal((await request('/sheets/0', { token: tokens[0], method: 'PATCH', body: { revision: own.revision, character: { ...own.character, infection: 10 } } })).status, 400);
});
test('player changes synchronize to GM; private text never reaches another player', async () => {
  const own = (await get(tokens[0])).sheets[0];
  const character = { ...own.character, health: 3, stress: 2, name: 'Иванов', secret: 'PRIVATE_SENTINEL_837', notes: 'Запись', tasks: 'Задача', items: ['Ключ'], symptoms: ['Озноб'] };
  const saved = await request('/sheets/0', { token: tokens[0], method: 'PATCH', body: { revision: own.revision, character } });
  assert.equal(saved.status, 200); assert.equal(saved.body.revision, own.revision + 1);
  assert.deepEqual((await get(tokens.gm)).sheets[0].character, character);
  for (let slot = 1; slot < 4; slot++) assert.equal(JSON.stringify(await get(tokens[slot])).includes(character.secret), false);
});
test('only GM changes hidden state; players cannot infer its numeric values from DTO', async () => {
  const sheet = (await get(tokens.gm)).sheets[0];
  const saved = await request('/sheets/0', { token: tokens.gm, method: 'PATCH', body: { revision: sheet.revision, character: sheet.character, hidden: { cold: 7, infection: 8, hallucinations: 9 } } });
  assert.equal(saved.status, 200); assert.deepEqual(saved.body.hidden, { cold: 7, infection: 8, hallucinations: 9 });
  const visible = (await get(tokens[0])).sheets[0];
  assert.deepEqual(visible.character, sheet.character); assert.equal(Object.hasOwn(visible, 'hidden'), false);
  const ownSave = await request('/sheets/0', { token: tokens[0], method: 'PATCH', body: { revision: visible.revision, character: { ...visible.character, stress: 3 } } });
  assert.equal(ownSave.status, 200); assert.equal(Object.hasOwn(ownSave.body, 'hidden'), false);
  assert.deepEqual((await get(tokens.gm)).sheets[0].hidden, saved.body.hidden);
});
test('stale concurrent write returns 409 and does not overwrite data', async () => {
  const snapshot = (await get(tokens[1])).sheets[0];
  const first = await request('/sheets/1', { token: tokens[1], method: 'PATCH', body: { revision: snapshot.revision, character: { ...snapshot.character, notes: 'first' } } });
  assert.equal(first.status, 200);
  const stale = await request('/sheets/1', { token: tokens[1], method: 'PATCH', body: { revision: snapshot.revision, character: { ...snapshot.character, notes: 'overwrite' } } });
  assert.equal(stale.status, 409); assert.equal((await get(tokens[1])).sheets[0].character.notes, 'first');
});
test('validation rejects malformed values, extra properties and path manipulation', async () => {
  const snapshot = (await get(tokens[2])).sheets[0];
  for (const patch of [{ health: 5 }, { stress: -1 }, { name: 'x'.repeat(201) }, { items: [12] }, { symptoms: ['Неизвестный'] }]) {
    assert.equal((await request('/sheets/2', { token: tokens[2], method: 'PATCH', body: { revision: snapshot.revision, character: { ...snapshot.character, ...patch } } })).status, 400);
  }
  assert.equal((await request('/sheets/00', { token: tokens.gm, method: 'PATCH', body: {} })).status, 404);
});
test('code hashes stored instead of credentials; rotation revokes sessions and old code', async () => {
  const old = room.codes.find(c => c.slot === 3).code;
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM identities WHERE code_hash=?').get(old).n, 0);
  const newCode = rotateCode(db, room.obrId, 3);
  assert.equal((await request('/sheets', { token: tokens[3] })).status, 401);
  assert.equal((await request('/login', { method: 'POST', body: { roomId: room.obrId, code: old } })).status, 401);
  assert.equal((await request('/login', { method: 'POST', body: { roomId: room.obrId, code: newCode } })).status, 200);
});
test('expired sessions, logout and cache/security headers', async () => {
  const result = await request('/sheets', { token: tokens[2] });
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.match(result.headers.get('content-security-policy'), /frame-ancestors 'self' https:\/\/owlbear.rodeo https:\/\/\*.owlbear.rodeo/);
  assert.equal(result.headers.get('x-frame-options'), null);
  await request('/logout', { token: tokens[2], method: 'POST' });
  assert.equal((await request('/sheets', { token: tokens[2] })).status, 401);
  db.prepare('UPDATE sessions SET expires=0 WHERE token_hash=?').run(digest(tokens[1]));
  assert.equal((await request('/sheets', { token: tokens[1] })).status, 401);
});
test('SQLite survives closing and reopening the database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'borey-persistence-'));
  try {
    let persistent = openStore(join(dir, 'test.sqlite'));
    createRoom(persistent, 'persisted-room');
    persistent.prepare('UPDATE sheets SET body=? WHERE slot=0').run(JSON.stringify({ secret: 'stored-private-data' }));
    persistent.close(); persistent = openStore(join(dir, 'test.sqlite'));
    assert.equal(persistent.prepare('SELECT COUNT(*) AS n FROM sheets').get().n, 4);
    assert.equal(JSON.parse(persistent.prepare('SELECT body FROM sheets WHERE slot=0').get().body).secret, 'stored-private-data');
    persistent.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
