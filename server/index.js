import { createApp } from './app.js';
import { openStore } from './store.js';
process.umask(0o077);
const db = openStore();
const server = createApp(db).listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => console.log('Борей-89: сервер запущен; порт ' + (process.env.PORT || 3000)));
function stop() { server.close(() => { db.close(); process.exit(0); }); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
