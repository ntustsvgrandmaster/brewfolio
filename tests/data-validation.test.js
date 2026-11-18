const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { validateBrew, validateBean, validateDripper } = require('../backend/validation');

test('沖煮資料保留個人刻度、未評分及冰量零值，不混合冰與水', () => {
  for (const grind of [0, 4.5, 1000]) {
    const result = validateBrew({ brew: { H_I: 'I', grind, water_vol: 150, ice_vol: 0, aroma: null } });
    assert.equal(result.error, undefined);
    assert.equal(result.brew.grind, grind);
    assert.equal(result.brew.ice_vol, 0);
    assert.equal(result.brew.water_vol, 150);
    assert.equal(result.brew.aroma, null);
    assert.equal(result.brew.bean_weight, null);
    assert.equal(result.brew.dripper_id, null);
  }
});

test('拒絕錯誤型別、非法分數和數值，不讓無效內容進入資料庫', () => {
  for (const patch of [
    { H_I: 'cold' }, { bean_id: '3' }, { bean_id: 0 }, { dripper_id: '3' }, { dripper_id: 0 },
    { bean_weight: 0 }, { bean_weight: -1 }, { grind: -1 }, { grind: Infinity },
    { grind: '4' }, { grind: NaN }, { grind: 1e40 },
    { water_vol: -1 }, { water_vol: 0 }, { water_vol: 1.5 },
    { water_vol: 2147483648 }, { ice_vol: -1 }, { water_temp: 101 },
    { aroma: 0 }, { sour: 6 }, { sweet: 2.5 }, { bitter: '3' },
    { notes: {} }, { notes: '豆'.repeat(21846) },
  ]) assert.ok(validateBrew({ brew: { H_I: 'H', ...patch } }).error, JSON.stringify(patch));
  for (const body of [null, [], {}, { brew: [] }, { brew: { H_I: 'H' }, pours: null }]) {
    assert.ok(validateBrew(body).error);
  }
});

test('注水段落驗證順序與數值，總量不一致僅提醒且允許部分記錄', () => {
  const brew = { H_I: 'H', water_vol: 200 };
  for (const pours of [
    {}, [null], [{ pour_order: -1 }], [{ pour_order: 128 }],
    [{ pour_order: 0 }, { pour_order: 0 }],
    [{ pour_order: 0, volume_ml: -1 }], [{ pour_order: 0, duration_s: 1.5 }],
  ]) assert.ok(validateBrew({ brew, pours }).error);
  const partial = validateBrew({ brew, pours: [{ pour_order: 0, volume_ml: 40, wait_s: 0 }] });
  assert.equal(partial.error, undefined);
  assert.equal(partial.warnings.length, 1);
  assert.equal(partial.pours[0].wait_s, 0);
  assert.equal(partial.pours[0].duration_s, null);
  assert.equal(validateBrew({ brew, pours: [{ pour_order: 0, volume_ml: 200 }] }).warnings.length, 0);
  assert.equal(validateBrew({ brew, pours: [{ pour_order: 0 }] }).warnings.length, 0);
});

test('豆款欄位驗證字數與型別，保留中文並整理空白', () => {
  assert.deepEqual(validateBean({ beans_name: ' 衣索比亞 ', process: ' ', roast_level: null }).bean,
    { beans_name: '衣索比亞', process: null, roast_level: null });
  for (const body of [null, [], { beans_name: 3 }, { beans_name: ' ' },
    { beans_name: '豆'.repeat(101) }, { beans_name: '豆', process: {} },
    { beans_name: '豆', roast_level: '淺'.repeat(51) }]) assert.ok(validateBean(body).error);
});

// Execute the registered route handlers with a database double. No live DB is modified.
function api({ beanExists = true, beanUsed = false, connectionFails = false, dripperExists = true, dripperUsed = false } = {}) {
  const routes = {}, queries = [];
  let committed = false, rolledBack = false;
  const query = async (sql, params) => {
    queries.push({ sql, params });
    if (!dripperExists && (
      (sql.includes('INSERT INTO brews') && params.at(-2) !== null) ||
      (sql.startsWith('UPDATE brews SET dripper_id') && params[0] !== null)
    )) {
      throw Object.assign(new Error('fk_brews_dripper'), { code: 'ER_NO_REFERENCED_ROW_2' });
    }
    if (dripperUsed && sql.startsWith('DELETE FROM drippers')) {
      throw Object.assign(new Error('fk_brews_dripper'), { code: 'ER_ROW_IS_REFERENCED_2' });
    }
    if (sql.startsWith('SELECT id FROM myBeans')) return [beanExists ? [{ id: 3 }] : []];
    if (sql.includes('FROM myBeans WHERE id')) return [beanExists ? [{ beans_name: '豆', process: null, roast_level: null, is_finished: 1 }] : []];
    if (sql.startsWith('SELECT id FROM brews WHERE bean_id')) return [beanUsed ? [{ id: 42 }] : []];
    return [{ insertId: 100, affectedRows: beanExists ? 1 : 0 }];
  };
  const conn = { query, beginTransaction: async () => {}, release() {},
    rollback: async () => { rolledBack = true; }, commit: async () => { committed = true; } };
  const app = { use() {}, listen() {} };
  for (const method of ['get', 'post', 'patch', 'put', 'delete']) {
    app[method] = (route, handler) => { routes[`${method.toUpperCase()} ${route}`] = handler; };
  }
  const express = Object.assign(() => app, { json() {}, static() {} });
  const mocks = {
    express, cors: () => {},
    'mysql2/promise': { createPool: () => ({ query, getConnection: async () => {
      if (connectionFails) throw new Error('offline');
      return conn;
    } }) },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../backend/server.js'), 'utf8'), {
    require: name => mocks[name] ?? (name.startsWith('.') ? require(path.join(__dirname, '../backend', name)) : require(name)),
    process: { env: {} }, __dirname: path.join(__dirname, '../backend'), console,
  });
  return {
    queries, committed: () => committed, rolledBack: () => rolledBack,
    async call(route, body, id = '3') {
      const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
      await routes[route]({ body, params: { id } }, res);
      return res;
    },
  };
}

test('所有 ID 路由與寫入內容在查詢前驗證', async () => {
  for (const route of ['GET /api/brews/:id', 'PATCH /api/brews/:id/notes',
    'PATCH /api/brews/:id/starred', 'PATCH /api/brews/:id/dripper', 'DELETE /api/brews/:id',
    'PUT /api/drippers/:id', 'DELETE /api/drippers/:id',
    'PUT /api/beans/:id', 'PATCH /api/beans/:id/finished', 'DELETE /api/beans/:id']) {
    for (const id of ['0', '-1', '1.5', '3x', '2147483648']) {
      const a = api();
      assert.equal((await a.call(route, {}, id)).code, 400, route);
      assert.equal(a.queries.length, 0);
    }
  }
  for (const [route, body] of [
    ['POST /api/brews', { brew: { H_I: 'H', aroma: 0 } }],
    ['POST /api/beans', { beans_name: {} }],
    ['PUT /api/beans/:id', null],
    ['PATCH /api/brews/:id/notes', {}],
    ['PATCH /api/brews/:id/notes', { notes: [] }],
    ['PATCH /api/brews/:id/starred', { starred: 'false' }],
    ['PATCH /api/brews/:id/dripper', {}],
    ['PATCH /api/brews/:id/dripper', { dripper_id: '3' }],
    ['PATCH /api/beans/:id/finished', { is_finished: 'false' }],
  ]) {
    const a = api();
    assert.equal((await a.call(route, body)).code, 400);
    assert.equal(a.queries.length, 0);
  }
});

test('濾杯可新增、補記與清除，已被沖煮引用時拒絕刪除', async () => {
  assert.ok(validateDripper({ name: '　' }).error);
  assert.ok(validateDripper({ name: 'Switch', material: {} }).error);
  const a = api();
  const created = await a.call('POST /api/drippers', { name: ' Hario Switch ', material: ' 陶瓷 ' });
  assert.equal(created.code, 201);
  assert.equal(created.data.name, 'Hario Switch');
  assert.equal(created.data.material, '陶瓷');
  for (const id of [created.data.id, null]) {
    const result = await a.call('PATCH /api/brews/:id/dripper', { dripper_id: id }, '42');
    assert.equal(result.code, 200);
    assert.match(a.queries.at(-1).sql, /^UPDATE brews SET dripper_id = \? WHERE id = \?$/);
    assert.equal(a.queries.at(-1).params[0], id);
  }
  assert.equal((await api({ dripperUsed: true }).call('DELETE /api/drippers/:id')).code, 409);
  assert.equal((await a.call('DELETE /api/drippers/:id')).code, 200);
});

test('濾杯不存在時拒絕寫入，並回滾新增沖煮的交易', async () => {
  const a = api({ dripperExists: false });
  assert.equal((await a.call('PATCH /api/brews/:id/dripper', { dripper_id: 100 })).code, 400);
  const result = await a.call('POST /api/brews', {
    brew: { H_I: 'H', dripper_id: 100 },
    pours: [{ pour_order: 0, volume_ml: 40 }],
  });
  assert.equal(result.code, 400);
  assert.ok(a.rolledBack());
  assert.ok(!a.committed());
  assert.ok(!a.queries.some(q => q.sql.includes('INSERT INTO pours')));
});

test('新增沖煮拒絕不存在的豆款，交易回滾且不寫入', async () => {
  const a = api({ beanExists: false });
  const res = await a.call('POST /api/brews', { brew: { H_I: 'I', bean_id: 3 } });
  assert.equal(res.code, 400);
  assert.ok(a.rolledBack());
  assert.ok(!a.queries.some(q => /INSERT/.test(q.sql)));
});

test('完成狀態可來回切換，不刪除歷史；不存在豆款回傳 404', async () => {
  for (const is_finished of [true, false, 1, 0]) {
    const a = api();
    const res = await a.call('PATCH /api/beans/:id/finished', { is_finished });
    assert.equal(res.code, 200);
    assert.equal(a.queries[0].params[0], is_finished ? 1 : 0);
    assert.ok(a.queries.every(q => !/DELETE/.test(q.sql)));
  }
  const a = api({ beanExists: false });
  assert.equal((await a.call('PATCH /api/beans/:id/finished', { is_finished: true })).code, 404);
});

test('豆款已有沖煮紀錄時拒絕刪除，未使用時才允許刪除', async () => {
  const used = api({ beanUsed: true });
  assert.equal((await used.call('DELETE /api/beans/:id')).code, 409);
  assert.ok(used.rolledBack());
  assert.ok(!used.queries.some(q => /DELETE/.test(q.sql)));
  const unused = api();
  assert.equal((await unused.call('DELETE /api/beans/:id')).code, 200);
  assert.ok(unused.committed());
  const missing = api({ beanExists: false });
  assert.equal((await missing.call('DELETE /api/beans/:id')).code, 404);
});

test('已用完豆款仍可補記沖煮；注水總量不同仍成功儲存並回傳提醒', async () => {
  const a = api();
  const res = await a.call('POST /api/brews', {
    brew: { H_I: 'I', bean_id: 3, water_vol: 150, ice_vol: 75, grind: 1000 },
    pours: [{ pour_order: 0, volume_ml: 40 }],
  });
  assert.equal(res.code, 200);
  assert.equal(res.data.warnings.length, 1);
  assert.ok(a.committed());
  const insert = a.queries.find(q => /INSERT INTO brews/.test(q.sql));
  const columns = insert.sql.match(/INSERT INTO brews\s*\(([^)]+)\)/)[1].split(',').map(s => s.trim());
  const stored = Object.fromEntries(columns.map((column, i) => [column, insert.params[i]]));
  assert.equal(stored.water_vol, 150);
  assert.equal(stored.ice_vol, 75);
});

test('刪除時資料庫無法連線也會回傳錯誤，不拋出未處理例外', async () => {
  for (const route of ['DELETE /api/beans/:id', 'DELETE /api/brews/:id']) {
    assert.equal((await api({ connectionFails: true }).call(route)).code, 500);
  }
});
