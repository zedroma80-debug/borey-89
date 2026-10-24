import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { makeCharacter, makeHidden } from '../src/model.js';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const credential = () => 'b89_' + randomBytes(32).toString('base64url');
export function openStore(path = process.env.DB_PATH || './data/borey.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, obr_id TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS identities (id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), slot INTEGER, code_hash TEXT NOT NULL UNIQUE, CHECK(slot IS NULL OR slot BETWEEN 0 AND 3));
    CREATE TABLE IF NOT EXISTS sheets (room_id TEXT NOT NULL REFERENCES rooms(id), slot INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL, hidden TEXT NOT NULL, PRIMARY KEY(room_id,slot));
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, identity_id TEXT NOT NULL REFERENCES identities(id), expires INTEGER NOT NULL);
  `);
  return db;
}
export function createRoom(db, obrId) {
  const roomId = randomUUID();
  const codes = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO rooms VALUES (?,?)').run(roomId, obrId);
    for (const slot of [null, 0, 1, 2, 3]) {
      const code = credential();
      db.prepare('INSERT INTO identities VALUES (?,?,?,?)').run(randomUUID(), roomId, slot, digest(code));
      codes.push({ slot, code });
      if (slot !== null) db.prepare('INSERT INTO sheets VALUES (?,?,0,?,?)').run(roomId, slot, JSON.stringify(makeCharacter(slot)), JSON.stringify(makeHidden()));
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { roomId, obrId, codes };
}
export function rotateCode(db, obrId, slot) {
  const identity = db.prepare('SELECT i.id FROM identities i JOIN rooms r ON r.id=i.room_id WHERE r.obr_id=? AND i.slot IS ?').get(obrId, slot);
  if (!identity) throw new Error('Комната или персонаж не найдены');
  const code = credential();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE identities SET code_hash=? WHERE id=?').run(digest(code), identity.id);
    db.prepare('DELETE FROM sessions WHERE identity_id=?').run(identity.id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return code;
}
