import { parseArgs } from 'node:util';
import { openStore, createRoom, rotateCode } from './store.js';
import { roles } from '../src/model.js';
process.umask(0o077);
const { values, positionals } = parseArgs({ allowPositionals: true, options: { 'obr-room': { type: 'string' }, slot: { type: 'string' } } });
const obrId = values['obr-room']?.trim();
if (!obrId || obrId.length > 150 || !['create', 'rotate'].includes(positionals[0])) {
  console.error('Использование: npm run room:create -- --obr-room ID или npm run room:rotate -- --obr-room ID --slot gm|0|1|2|3');
  process.exit(1);
}
const db = openStore();
try {
  console.log('Коды — секретные пароли. Передавайте каждый код только его владельцу; не публикуйте этот вывод.');
  if (positionals[0] === 'create') {
    const room = createRoom(db, obrId);
    for (const { slot, code } of room.codes) console.log(`${slot === null ? 'Ведущий' : roles[slot]}: ${code}`);
  } else {
    if (!['gm', '0', '1', '2', '3'].includes(values.slot)) throw new Error('--slot должен быть gm, 0, 1, 2 или 3');
    console.log('Новый код: ' + rotateCode(db, obrId, values.slot === 'gm' ? null : Number(values.slot)));
    console.log('Предыдущий код и все его сессии отозваны.');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { db.close(); }
