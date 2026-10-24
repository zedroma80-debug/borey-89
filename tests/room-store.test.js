import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCharacter, validateCharacter } from '../src/model.js';
import { RoomStore, keyFor, makeRecord, validateRecord } from '../src/room-store.js';

function fixture() {
  let metadata = { unrelated: { retained: true } };
  const writes = [], listeners = [];
  const room = {
    async getMetadata() { return structuredClone(metadata); },
    async setMetadata(update) { writes.push(structuredClone(update)); metadata = { ...metadata, ...structuredClone(update) }; listeners.forEach(f => f(structuredClone(metadata))); },
    onMetadataChange(callback) { listeners.push(callback); return () => listeners.splice(listeners.indexOf(callback), 1); },
  };
  return { room, writes, store: new RoomStore(room) };
}
test('new rooms load four independent defaults without writing shared state', async () => {
  const { store, writes } = fixture(); await store.load();
  const sheets = store.sheets('player-a');
  assert.equal(sheets.length, 4); assert.equal(sheets[0].revision, null);
  assert.notDeepEqual(sheets[0].character.items, sheets[1].character.items);
  sheets[0].character.health = 1; assert.equal(store.sheets('player-a')[0].character.health, 4);
  assert.equal(writes.length, 0);
});
test('SDK writes patch one owner/profession key and preserve other sheets and extensions', async () => {
  const { room, store, writes } = fixture(); await store.load();
  const a = makeRecord('player-a', 'Первый', 0, { ...makeCharacter(0), notes: 'Запись A' });
  const b = makeRecord('player-b', 'Второй', 0, { ...makeCharacter(0), name: 'Другой охранник' });
  const c = makeRecord('player-a', 'Первый', 1, makeCharacter(1));
  await store.save(a, null); await store.save(b, null); await store.save(c, null);
  assert.deepEqual(writes.map(w => Object.keys(w)), [[keyFor('player-a', 0)], [keyFor('player-b', 0)], [keyFor('player-a', 1)]]);
  const metadata = await room.getMetadata(); assert.deepEqual(metadata.unrelated, { retained: true });
  const reopened = new RoomStore(room); await reopened.load();
  assert.equal(reopened.sheets('player-a')[0].character.notes, 'Запись A');
  assert.equal(reopened.sheets('player-b')[0].character.name, 'Другой охранник');
});
test('subscriptions synchronize saved sheets and identify owners for the GM', async () => {
  const { room, store } = fixture(); await store.load();
  const gmStore = new RoomStore(room); await gmStore.load(); let updates = 0;
  const stop = gmStore.subscribe(() => updates++);
  await store.save(makeRecord('a', 'Анна', 2, { ...makeCharacter(2), stress: 4 }), null);
  assert.equal(updates, 1); assert.equal(gmStore.owners().get('a'), 'Анна'); assert.equal(gmStore.sheets('a')[2].character.stress, 4);
  stop(); await store.save(makeRecord('b', 'Борис', 3, makeCharacter(3)), null); assert.equal(updates, 1);
});
test('stale revisions are rejected before writing; simultaneous SDK writes have no CAS guarantee', async () => {
  const { store, writes } = fixture(); await store.load();
  const first = makeRecord('a', 'Анна', 0, makeCharacter(0)); await store.save(first, null);
  await assert.rejects(store.save(makeRecord('a', 'Анна', 0, { ...makeCharacter(0), health: 1 }), null), /другом окне/);
  assert.equal(writes.length, 1); assert.equal(store.sheets('a')[0].character.health, 4);
});
test('post-write competing revision is reported instead of claiming success', async () => {
  const { room, store } = fixture();
  const competitor = makeRecord('a', 'Анна', 0, { ...makeCharacter(0), health: 2 });
  const original = room.setMetadata.bind(room);
  room.setMetadata = async update => { await original(update); await original({ [keyFor('a', 0)]: competitor }); };
  await assert.rejects(store.save(makeRecord('a', 'Анна', 0, makeCharacter(0)), null), /параллельная запись/);
});
test('secret and hidden fields are not part of the format and are rejected, not migrated', async () => {
  const character = makeCharacter(0); assert.equal(validateCharacter(character), true);
  for (const field of ['secret', 'cold', 'infection', 'hallucinations']) {
    assert.equal(validateCharacter({ ...character, [field]: 'must not be published' }), false);
    assert.throws(() => makeRecord('a', 'Анна', 0, { ...character, [field]: 1 }));
  }
  const record = makeRecord('a', 'Анна', 0, character);
  assert.equal(validateRecord({ ...record, hidden: {} }), false);
});
test('unknown saved formats are preserved and never overwritten', async () => {
  const { room, store, writes } = fixture();
  await room.setMetadata({ [keyFor('a', 0)]: { version: 999 } }); await store.load();
  assert.throws(() => store.sheets('a'), /Неизвестный формат/);
  await assert.rejects(store.save(makeRecord('a', 'Анна', 0, makeCharacter(0)), null), /Неизвестный формат/);
  assert.equal(writes.length, 1); assert.deepEqual(store.owners().size, 0);
});
test('invalid counters, text limits, inventory and oversized UTF-8 records cannot be saved', () => {
  const character = makeCharacter(0);
  for (const change of [{ health: -1 }, { stress: 7 }, { items: Array(41).fill('x') }, { symptoms: ['Неизвестный'] }, { notes: 'x'.repeat(2001) }]) assert.equal(validateCharacter({ ...character, ...change }), false);
  assert.throws(() => makeRecord('a', 'Анна', 0, { ...character, notes: 'Я'.repeat(2000), tasks: 'Я'.repeat(1500), items: Array(40).fill('Я'.repeat(90)) }), /12 КБ/);
});
