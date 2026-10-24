import { test, expect } from '@playwright/test';

async function login(page, code) {
  await page.goto('/');
  await page.locator('#roomId').fill('browser-test-room');
  await page.locator('#accessCode').fill('test-only-' + code);
  await page.getByRole('button', { name: 'Подключиться к комнате' }).click();
  await expect(page.locator('#sheet')).toBeVisible();
}
test('local MVP: all tabs, counters, symptoms, inventory, four professions and persistence at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/'); await page.locator('#localMode').click();
  await page.locator('[data-change="health:-1"]').click();
  await page.locator('[data-change="stress:1"]').click();
  await expect(page.locator('#hpValue')).toHaveText('3 / 4');
  await expect(page.locator('#stressValue')).toHaveText('1 / 6');
  await page.getByLabel('Озноб', { exact: true }).check();
  await page.locator('[data-tab="gear"]').click();
  await page.locator('#itemInput').fill('<img src=x onerror=alert(1)>');
  await page.locator('#addItem button').click();
  await expect(page.locator('#itemList')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#itemList img')).toHaveCount(0);
  await page.locator('#itemList .item').last().locator('button').click();
  await page.locator('[data-tab="dossier"]').click();
  await page.locator('#name').fill('Иванов Иван'); await page.locator('#secret').fill('Локальная тайна');
  await page.locator('[data-tab="notes"]').click();
  await page.locator('#notesText').fill('Найдена записка'); await page.locator('#tasksText').fill('Открыть шлюз');
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено в этом браузере');
  for (let slot = 1; slot < 4; slot++) {
    await page.locator('#role').selectOption(String(slot));
    await expect(page.locator('#notesText')).toHaveValue('');
    await expect(page.locator('#roleLabel')).toHaveText(['', 'Медик', 'Электрик', 'Механик'][slot]);
  }
  await page.locator('#role').selectOption('0');
  await expect(page.locator('#notesText')).toHaveValue('Найдена записка');
  await expect(page.locator('#gmPanel')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[data-tab="status"]').click();
  await page.screenshot({ path: 'test-results/local-360.png', fullPage: true });
  await page.reload(); await page.locator('#localMode').click();
  await expect(page.locator('#hpValue')).toHaveText('3 / 4');
  await page.locator('[data-tab="dossier"]').click();
  await expect(page.locator('#secret')).toHaveValue('Локальная тайна');
  await expect(page.locator('#name')).toHaveValue('Иванов Иван');
  page.once('dialog', dialog => dialog.accept()); await page.locator('#reset').click();
  await expect(page.locator('#name')).toHaveValue('');
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено в этом браузере');
});

test('room sync in independent browsers, server privacy and GM-only controls', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const [gm, player, other] = await Promise.all(contexts.map(c => c.newPage()));
  try {
    await login(gm, 'gm'); await login(player, '0'); await login(other, '1');
    await expect(gm.locator('#role option')).toHaveCount(4);
    await expect(player.locator('#role option')).toHaveCount(1);
    await expect(player.locator('#role')).toBeDisabled();
    await expect(gm.locator('#gmPanel')).toBeVisible(); await expect(player.locator('#gmPanel')).toBeHidden();
    await player.locator('[data-tab="dossier"]').click(); await player.locator('#secret').fill('SECRET_PLAYER_ZERO_UI');
    await expect(player.locator('#saveStatus')).toHaveText('Сохранено в комнате');
    await gm.locator('[data-tab="dossier"]').click(); await expect(gm.locator('#secret')).toHaveValue('SECRET_PLAYER_ZERO_UI', { timeout: 7000 });
    await other.locator('[data-tab="dossier"]').click(); await expect(other.locator('#secret')).toHaveValue('');
    await gm.locator('[data-tab="status"]').click(); await gm.locator('[data-change="infection:1"]').click(); await gm.locator('[data-change="hallucinations:1"]').click();
    await expect(gm.locator('#saveStatus')).toHaveText('Сохранено в комнате');
    const response = await player.waitForResponse(r => r.url().endsWith('/api/sheets') && r.request().method() === 'GET');
    const dto = await response.json(); expect(dto.sheets).toHaveLength(1); expect(dto.sheets[0]).not.toHaveProperty('hidden');
    await expect(player.locator('#infectionValue')).toHaveText(''); await expect(player.locator('#hallucinationsValue')).toHaveText('');
    await gm.locator('[data-change="health:-1"]').click(); await expect(gm.locator('#saveStatus')).toHaveText('Сохранено в комнате');
    await player.locator('[data-tab="status"]').click(); await expect(player.locator('#hpValue')).toHaveText('3 / 4', { timeout: 7000 });
    await player.reload(); await expect(player.locator('#sheet')).toBeVisible(); await expect(player.locator('#hpValue')).toHaveText('3 / 4');
    await player.locator('#logout').click(); await expect(player.locator('#loginForm')).toBeVisible();
    await player.reload(); await expect(player.locator('#sheet')).toBeHidden();
  } finally { await Promise.all(contexts.map(c => c.close())); }
});

test('stale edits preserve draft instead of overwriting the GM; network errors also preserve draft', async ({ page, request }) => {
  await login(page, '2');
  // Pause receiving remote updates, then simulate a concurrent GM write via the real API.
  await page.route('**/api/sheets', route => route.request().method() === 'GET' ? route.abort() : route.continue());
  const auth = await request.post('/api/login', { data: { code: 'test-only-gm', roomId: 'browser-test-room' } });
  const { token } = await auth.json();
  const headers = { Authorization: 'Bearer ' + token, 'X-OBR-Room': 'browser-test-room' };
  const remote = await request.get('/api/sheets', { headers });
  const snapshot = (await remote.json()).sheets[2];
  const saved = await request.patch('/api/sheets/2', { headers, data: { revision: snapshot.revision, character: { ...snapshot.character, notes: 'SERVER_GM_CHANGE' }, hidden: snapshot.hidden } });
  expect(saved.status()).toBe(200);
  await page.locator('[data-tab="notes"]').click(); await page.locator('#notesText').fill('MY_UNSAVED_DRAFT');
  await expect(page.locator('#conflictActions')).toBeVisible();
  await expect(page.locator('#notesText')).toHaveValue('MY_UNSAVED_DRAFT');
  const download = page.waitForEvent('download'); await page.locator('#exportDraft').click();
  expect((await download).suggestedFilename()).toBe('borey89-private-draft.json');
  await page.unroute('**/api/sheets');
  page.once('dialog', dialog => dialog.accept()); await page.locator('#reloadRemote').click();
  await expect(page.locator('#notesText')).toHaveValue('SERVER_GM_CHANGE');
  await page.route('**/api/sheets/2', route => route.abort());
  await page.locator('#notesText').fill('OFFLINE_DRAFT');
  await expect(page.locator('#conflictActions')).toBeVisible();
  await expect(page.locator('#notesText')).toHaveValue('OFFLINE_DRAFT');
});

test('official SDK handshake and modal request in an iframe harness (not a live Owlbear room)', async ({ page }) => {
  await page.route('**/sdk-harness', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><script>
    window.calls=[];
    addEventListener('message', e => {
      const m=e.data;
      if(m.id==='OBR_PLAYER_GET_ID') e.source.postMessage({id:m.id+'_RESPONSE'+m.nonce,data:{id:'sdk-test-user'}},location.origin);
      if(m.id==='OBR_MODAL_OPEN') { calls.push(m); e.source.postMessage({id:m.id+'_RESPONSE'+m.nonce,data:{}},location.origin); }
    });
    const frame=document.createElement('iframe'); frame.style='width:440px;height:800px';
    frame.src='/?obrref='+encodeURIComponent(btoa(location.origin+' browser-test-room'));
    frame.onload=()=>frame.contentWindow.postMessage({id:'OBR_READY',data:{ref:'test-ref',userId:'sdk-test-user'}},location.origin);
    document.body.append(frame);
  </script></body></html>` }));
  await page.goto('/sdk-harness');
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#roomId')).toHaveValue('browser-test-room');
  await expect(frame.locator('#roomId')).toHaveAttribute('readonly', '');
  await frame.locator('#accessCode').fill('test-only-3');
  await frame.getByRole('button', { name: 'Подключиться к комнате' }).click();
  await expect(frame.locator('#sheet')).toBeVisible();
  await frame.locator('#openWindow').click();
  await expect.poll(() => page.evaluate(() => window.calls.length)).toBe(1);
  const modal = await page.evaluate(() => window.calls[0].data);
  expect(modal.id).toBe('borey89.sheet'); expect(modal.url).toContain('/?window=1'); expect(modal.url).not.toContain('b89_');
});
