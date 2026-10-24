import { makeCharacter, validateCharacter } from './model.js';

export const PREFIX = 'com.borey89.characters/v2/';
export const keyFor = (ownerId, slot) => PREFIX + encodeURIComponent(ownerId) + '/' + slot;
export function validateRecord(record) {
  return record && typeof record === 'object' && !Array.isArray(record)
    && Object.keys(record).sort().join(',') === 'character,ownerId,ownerName,revision,slot,version'
    && record.version === 2 && typeof record.ownerId === 'string' && record.ownerId.length > 0 && record.ownerId.length <= 200
    && typeof record.ownerName === 'string' && record.ownerName.length <= 200
    && Number.isInteger(record.slot) && record.slot >= 0 && record.slot < 4
    && typeof record.revision === 'string' && record.revision.length > 0 && record.revision.length <= 100
    && validateCharacter(record.character);
}
export function makeRecord(ownerId, ownerName, slot, character) {
  const record = { version: 2, ownerId, ownerName: ownerName.slice(0, 200), slot, revision: crypto.randomUUID(), character: structuredClone(character) };
  if (!validateRecord(record)) throw new Error('Проверьте поля: максимум 40 предметов, 2000 символов записей и 1500 символов задач.');
  if (new TextEncoder().encode(JSON.stringify(record)).length > 12000) throw new Error('Лист превышает 12 КБ. Сократите записи или инвентарь и повторите сохранение.');
  return record;
}
export class RoomStore {
  constructor(room) { this.room = room; this.metadata = {}; }
  async load() { this.metadata = await this.room.getMetadata(); }
  subscribe(callback) {
    return this.room.onMetadataChange(metadata => { this.metadata = metadata; callback(); });
  }
  owners() {
    const owners = new Map();
    for (const [key, value] of Object.entries(this.metadata)) {
      if (validateRecord(value) && key === keyFor(value.ownerId, value.slot)) owners.set(value.ownerId, value.ownerName);
    }
    return owners;
  }
  sheets(ownerId) {
    return Array.from({ length: 4 }, (_, slot) => {
      const record = this.metadata[keyFor(ownerId, slot)];
      if (record !== undefined && (!validateRecord(record) || record.ownerId !== ownerId || record.slot !== slot)) throw new Error('Неизвестный формат сохранённого листа. Существующая запись не изменена.');
      return { slot, revision: record?.revision ?? null, character: structuredClone(record?.character ?? makeCharacter(slot)) };
    });
  }
  async save(record, expectedRevision) {
    if (!validateRecord(record)) throw new Error('Недопустимый формат листа.');
    const key = keyFor(record.ownerId, record.slot);
    const metadata = await this.room.getMetadata();
    const existing = metadata[key];
    if (existing !== undefined && !validateRecord(existing)) throw new Error('Неизвестный формат сохранённого листа.');
    if ((existing?.revision ?? null) !== expectedRevision) throw new Error('Лист уже изменён в другом окне. Скачайте черновик и загрузите сохранённую версию.');
    // Only this player's profession key is patched; other players/slots/extensions are untouched.
    // SDK has no compare-and-swap: truly simultaneous writes to this same key are last-writer-wins.
    await this.room.setMetadata({ [key]: record });
    const latest = await this.room.getMetadata();
    this.metadata = latest;
    if (latest[key]?.revision !== record.revision) throw new Error('Обнаружена параллельная запись. Скачайте черновик и загрузите сохранённую версию.');
    return record;
  }
}
