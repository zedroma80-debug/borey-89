import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { resolve } from 'node:path';
import { credential, digest } from './store.js';
import { validateCharacter, validateHidden } from '../src/model.js';

export function createApp(db, { staticDir = resolve('dist'), production = process.env.NODE_ENV === 'production' } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Set only for a known reverse proxy; never trust arbitrary forwarded client IPs.
  if (process.env.TRUST_PROXY_HOPS) app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS));
  app.use(helmet({
    frameguard: false,
    strictTransportSecurity: production,
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"],
      frameAncestors: ["'self'", 'https://owlbear.rodeo', 'https://*.owlbear.rodeo'],
      upgradeInsecureRequests: production ? [] : null,
    } },
  }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', rateLimit({ windowMs: 60000, limit: 500, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.use(express.json({ limit: '96kb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.post('/api/login', rateLimit({ windowMs: 60000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false }), (req, res) => {
    const { code, roomId } = req.body || {};
    if (typeof code !== 'string' || code.length > 200 || typeof roomId !== 'string' || !roomId || roomId.length > 150) return res.status(400).json({ error: 'Нужны код доступа и ID комнаты.' });
    const identity = db.prepare('SELECT i.* FROM identities i JOIN rooms r ON r.id=i.room_id WHERE i.code_hash=? AND r.obr_id=?').get(digest(code), roomId);
    if (!identity) return res.status(401).json({ error: 'Неверный код или другая комната.' });
    db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
    const token = credential();
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(token), identity.id, Date.now() + 12 * 60 * 60 * 1000);
    res.json({ token });
  });
  app.use('/api', (req, res, next) => {
    const auth = req.get('Authorization') || '';
    if (!/^Bearer b89_[\w-]{43}$/.test(auth)) return res.status(401).json({ error: 'Войдите по персональному коду.' });
    const identity = db.prepare('SELECT i.*,r.obr_id FROM sessions s JOIN identities i ON i.id=s.identity_id JOIN rooms r ON r.id=i.room_id WHERE s.token_hash=? AND s.expires>?').get(digest(auth.slice(7)), Date.now());
    if (!identity) return res.status(401).json({ error: 'Сессия истекла или отозвана. Войдите снова.' });
    if (req.get('X-OBR-Room') !== identity.obr_id) return res.status(403).json({ error: 'Сессия относится к другой комнате.' });
    req.identity = identity;
    next();
  });
  app.post('/api/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(req.get('Authorization').slice(7)));
    res.json({ ok: true });
  });
  const serialize = (row, gm) => ({ slot: row.slot, revision: row.revision, character: JSON.parse(row.body), ...(gm ? { hidden: JSON.parse(row.hidden) } : {}) });
  app.get('/api/sheets', (req, res) => {
    const i = req.identity;
    const gm = i.slot === null;
    const rows = gm ? db.prepare('SELECT * FROM sheets WHERE room_id=? ORDER BY slot').all(i.room_id) : db.prepare('SELECT * FROM sheets WHERE room_id=? AND slot=?').all(i.room_id, i.slot);
    res.json({ role: gm ? 'GM' : 'PLAYER', sheets: rows.map(r => serialize(r, gm)) });
  });
  app.patch('/api/sheets/:slot', (req, res) => {
    const i = req.identity, slot = Number(req.params.slot), gm = i.slot === null;
    if (!/^[0-3]$/.test(req.params.slot)) return res.status(404).json({ error: 'Лист не найден.' });
    if (!gm && i.slot !== slot) return res.status(403).json({ error: 'Нет доступа к этому листу.' });
    const { revision, character, hidden } = req.body || {};
    if (!gm && Object.hasOwn(req.body || {}, 'hidden')) return res.status(403).json({ error: 'Скрытые показатели доступны только ведущему.' });
    const allowed = gm ? ['revision', 'character', 'hidden'] : ['revision', 'character'];
    if (Object.keys(req.body || {}).some(k => !allowed.includes(k)) || !Number.isSafeInteger(revision) || revision < 0 || !validateCharacter(character) || (gm && !validateHidden(hidden))) return res.status(400).json({ error: 'Недопустимые данные листа.' });
    // Revision check and update are one atomic SQL operation, including changes from other processes.
    const result = gm
      ? db.prepare('UPDATE sheets SET body=?,hidden=?,revision=revision+1 WHERE room_id=? AND slot=? AND revision=?').run(JSON.stringify(character), JSON.stringify(hidden), i.room_id, slot, revision)
      : db.prepare('UPDATE sheets SET body=?,revision=revision+1 WHERE room_id=? AND slot=? AND revision=?').run(JSON.stringify(character), i.room_id, slot, revision);
    if (!result.changes) return res.status(409).json({ error: 'Лист уже изменён другим участником. Сохраните черновик и загрузите свежую версию.' });
    res.json(serialize(db.prepare('SELECT * FROM sheets WHERE room_id=? AND slot=?').get(i.room_id, slot), gm));
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API-маршрут не найден.' }));
  app.use(express.static(staticDir, { index: 'index.html', dotfiles: 'deny' }));
  app.use((err, _req, res, _next) => {
    const status = err.type === 'entity.too.large' ? 413 : err instanceof SyntaxError ? 400 : 500;
    res.status(status).json({ error: status === 500 ? 'Ошибка сервера. Обратитесь к администратору.' : 'Некорректный или слишком большой запрос.' });
  });
  return app;
}
