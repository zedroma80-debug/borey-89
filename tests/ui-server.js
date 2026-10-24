// In-memory test data only: these predictable credentials never exist in a real database.
import { createApp } from '../server/app.js';
import { openStore, createRoom, digest } from '../server/store.js';
const db = openStore(':memory:');
const room = createRoom(db, 'browser-test-room');
for (const entry of room.codes) db.prepare('UPDATE identities SET code_hash=? WHERE code_hash=?').run(digest('test-only-' + (entry.slot ?? 'gm')), digest(entry.code));
createApp(db).listen(3100, '127.0.0.1');
