const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function frontend() {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, {
        value: '', hidden: false, textContent: '', disabled: false, isConnected: true, focus() {},
        classList: {
          remove(name) { classes.delete(name); },
          add(name) { classes.add(name); },
          contains(name) { return classes.has(name); },
          toggle(name, active = !classes.has(name)) {
            if (active) classes.add(name);
            else classes.delete(name);
            return active;
          },
        },
        set innerHTML(html) {
          this.html = html;
          for (const match of html.matchAll(/id="([^"]+)"/g)) get(match[1]).value = '';
        }, get innerHTML() { return this.html || ''; }, appendChild() {},
      });
    }
    return nodes.get(id);
  };
  const context = vm.createContext({ console, window: { location: { hostname: 'localhost' } },
    document: { getElementById: get, querySelectorAll: () => [], createElement: () => get(`node-${nodes.size}`) },
    cancelAnimationFrame() {}, setTimeout() {},
    fetch: async url => ({
      ok: true,
      json: async () => url.endsWith('/drippers')
        ? [{ id: 8, name: 'Hario Switch', material: '陶瓷' }, { id: 9, name: 'V60', material: '樹脂' }]
        : [{ id: 3, beans_name: 'Test bean' }],
    }),
  });
  const html = fs.readFileSync(path.join(__dirname, '../frontend/index.html'), 'utf8');
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/loadList\(\);\s*$/, ''), context);
  return { context, get, run: code => vm.runInContext(code, context) };
}

test('再煮一杯複製參數與注水量，重置結果，儲存來源且一般新增不沿用來源', async () => {
  const f = frontend();
  f.run(`currentBrew = { id: 42, bean_id: 3, dripper_id: 8, bean_weight: 15, grind: 2, H_I: 'I', water_vol: 200, water_temp: 90, ice_vol: 0, sour: 5, notes: 'old', pours: [{pour_order:0,volume_ml:40,duration_s:10,wait_s:30},{pour_order:1,volume_ml:160,duration_s:40,wait_s:20}] }; tRunning=true; tLaps=[{}];`);
  await f.run('brewAgain()');
  assert.equal(f.get('f-bean-weight').value, 15);
  assert.equal(f.get('f-beans').value, '3');
  assert.equal(f.get('f-dripper').value, '8');
  assert.match(f.get('f-dripper').innerHTML, /Hario Switch（陶瓷）/);
  assert.equal(f.get('f-ice-vol').value, 0);
  assert.equal(f.get('pour-1-vol').value, 160);
  assert.equal(f.get('pour-0-dur').value, '');
  assert.equal(f.get('pour-1-wait').value, '');
  assert.equal(f.get('f-notes').value, '');
  assert.equal(f.run('scoreValues.sour'), 0);
  assert.equal(f.run('tRunning'), false);
  assert.equal(f.run('tLaps.length'), 0);
  let payload;
  const loadOptions = f.context.fetch;
  f.context.fetch = async (_, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, json: async () => ({ id: 100 }) };
  };
  f.run('showList = () => {};');
  await f.run('submitBrew()');
  assert.equal(payload.brew.source_brew_id, 42);
  assert.equal(payload.brew.dripper_id, 8);
  assert.equal(payload.brew.sour, null);
  assert.equal(payload.pours[0].duration_s, null);
  f.context.fetch = loadOptions;
  await f.run('showAdd()');
  assert.equal(f.get('f-dripper').value, '');
  assert.equal(f.run('sourceBrewId'), null);
  assert.equal(f.get('brew-source').hidden, true);
});

test('移除來源不清除配方，載入失敗不允許儲存', async () => {
  const f = frontend();
  f.run('sourceBrewId = 42');
  f.get('f-bean-weight').value = 15;
  f.run('clearBrewSource()');
  assert.equal(f.run('sourceBrewId'), null);
  assert.equal(f.get('f-bean-weight').value, 15);
  f.context.fetch = async () => { throw new Error('offline'); };
  await f.run('loadBeansIntoSelect()');
  await f.run('submitBrew()');
  assert.match(f.get('form-error').textContent, /豆款尚未載入/);
});

test('舊紀錄可以補記或清除濾杯，詳情與再煮一杯使用更新後的值', async () => {
  const f = frontend();
  const form = f.get('detail-dripper-form');
  f.run("currentBrew = { id: 42, bean_id: 3, H_I: 'H' }; renderDetail(currentBrew);");
  assert.match(f.get('detail-content').innerHTML, /補記濾杯/);
  await f.run("openBrewDripperEditor(document.getElementById('detail-dripper-edit'))");
  assert.equal(form.hidden, false);
  const loadOptions = f.context.fetch;
  const select = f.get('detail-dripper-select');
  const saved = [];
  f.context.fetch = async (url, options) => {
    assert.equal(url, 'http://localhost:3001/api/brews/42/dripper');
    assert.equal(options.method, 'PATCH');
    saved.push(JSON.parse(options.body).dripper_id);
    return { ok: true, json: async () => ({ ok: true }) };
  };
  select.value = '8';
  select.selectedOptions = [{ dataset: { name: 'Hario Switch', material: '陶瓷' } }];
  await f.run("saveBrewDripper({ preventDefault() {}, currentTarget: document.getElementById('detail-dripper-form') })");
  assert.equal(form.hidden, true);
  assert.equal(f.get('detail-dripper-label').textContent, 'Hario Switch（陶瓷）');
  f.context.fetch = loadOptions;
  await f.run('brewAgain()');
  assert.equal(f.get('f-dripper').value, '8');
  await f.run("openBrewDripperEditor(document.getElementById('detail-dripper-edit'))");
  assert.equal(select.value, '8');
  f.context.fetch = async (url, options) => {
    saved.push(JSON.parse(options.body).dripper_id);
    return { ok: true, json: async () => ({ ok: true }) };
  };
  select.value = '';
  select.selectedOptions = [{ dataset: {} }];
  await f.run("saveBrewDripper({ preventDefault() {}, currentTarget: document.getElementById('detail-dripper-form') })");
  assert.equal(f.get('detail-dripper-label').textContent, '未記錄');
  assert.deepEqual(saved, [8, null]);
});

test('從詳情列出同豆款的全部沖煮與筆數，清除後回到全部豆款', async () => {
  const f = frontend();
  const brews = [
    { id: 42, beans_display: '豆款 "A"', H_I: 'I', starred: 1, dripper_name: 'Hario Switch' },
    { id: 43, beans_display: '豆款 "A"', H_I: 'H', starred: 0, dripper_name: 'Hario Switch' },
    { id: 44, beans_display: '豆款 B', H_I: 'I', starred: 0 },
  ];
  f.context.fetch = async url => ({
    ok: true,
    json: async () => url.endsWith('/brews') ? brews : [{ roast_level: '淺焙' }],
  });
  await f.run('loadList()');
  f.run(`currentBrew = ${JSON.stringify(brews[0])}; renderDetail(currentBrew);`);
  assert.match(f.get('detail-content').innerHTML, />查看全部紀錄 \(2\)<\/button>/);
  f.get('filter-hi').value = 'I';
  f.get('filter-roast').value = '淺焙';
  f.get('filter-notes').value = '不符的備註';
  f.get('filter-starred-btn').classList.add('on');
  await f.run('showBeanBrews()');
  assert.ok(f.get('view-list').classList.contains('active'));
  assert.equal(f.get('filter-bean').value, '豆款 "A"');
  assert.match(f.get('filter-bean').innerHTML, /value="豆款 &quot;A&quot;"/);
  assert.equal(f.get('clear-bean-filter').hidden, false);
  const list = f.get('list-content');
  assert.match(list.innerHTML, /loadDetail\(42\)/);
  assert.match(list.innerHTML, /loadDetail\(43\)/);
  assert.doesNotMatch(list.innerHTML, /loadDetail\(44\)|Hario Switch/);

  f.run('clearBeanFilter()');
  assert.equal(f.get('filter-bean').value, '');
  assert.equal(f.get('clear-bean-filter').hidden, true);
  assert.match(list.innerHTML, /loadDetail\(42\)/);
  assert.match(list.innerHTML, /loadDetail\(44\)/);

  f.get('filter-bean').value = '豆款 "A"';
  f.get('filter-hi').value = 'I';
  f.run('applyFilters(); clearBeanFilter()');
  assert.equal(f.get('filter-hi').value, 'I');
  assert.doesNotMatch(list.innerHTML, /loadDetail\(43\)/);

  f.run(`currentBrew = ${JSON.stringify(brews[2])}; renderDetail(currentBrew);`);
  assert.match(f.get('detail-content').innerHTML, />查看全部紀錄 \(1\)<\/button>/);
  await f.run('showBeanBrews()');
  assert.equal(f.get('filter-bean').value, '豆款 B');
  assert.match(list.innerHTML, /loadDetail\(44\)/);
  assert.doesNotMatch(list.innerHTML, /loadDetail\((42|43)\)/);
});

test('點擊咖啡日誌會回到無篩選、日期由新到舊的首頁', async () => {
  const f = frontend();
  f.context.fetch = async url => ({
    ok: true,
    json: async () => url.endsWith('/brews') ? [
      { id: 42, beans_display: '豆款 A', H_I: 'I', starred: 1, brewed_at: '2026-11-16' },
      { id: 43, beans_display: '豆款 B', H_I: 'H', starred: 0, brewed_at: '2026-11-17' },
    ] : [{ roast_level: '淺焙' }],
  });
  const filters = { 'filter-bean': '豆款 A', 'filter-hi': 'I', 'filter-roast': '淺焙', 'filter-notes': '花香' };
  for (const [id, value] of Object.entries(filters)) f.get(id).value = value;
  f.get('filter-starred-btn').classList.add('on');
  f.run("setSort('date-asc'); showDetail()");
  assert.equal(f.get('clear-bean-filter').hidden, false);

  await f.run('showHome()');
  assert.ok(f.get('view-list').classList.contains('active'));
  for (const id of Object.keys(filters)) assert.equal(f.get(id).value, '');
  assert.ok(!f.get('filter-starred-btn').classList.contains('on'));
  assert.equal(f.get('clear-bean-filter').hidden, true);
  assert.ok(f.get('sort-date-desc').classList.contains('active'));
  assert.ok(!f.get('sort-date-asc').classList.contains('active'));
  assert.match(f.get('list-content').innerHTML, /loadDetail\(43\)[\s\S]*loadDetail\(42\)/);
});

function api(sourceExists = true) {
  const routes = {}, queries = [];
  let committed = false;
  const conn = { beginTransaction: async()=>{}, rollback: async()=>{}, release(){},
    commit: async()=>{committed=true;}, query: async(sql,params)=>{
      queries.push({sql,params});
      if (sql.startsWith('SELECT id FROM brews')) return [sourceExists ? [{id:42}] : []];
      if (sql.includes('FROM myBeans')) return [[{beans_name:'Test bean',process:'Washed',roast_level:'Light'}]];
      return [{insertId:100}];
    }};
  const app = { use(){}, listen(){}, get(p,h){routes['GET '+p]=h;}, post(p,h){routes['POST '+p]=h;}, patch(){}, put(){}, delete(){} };
  const express = Object.assign(()=>app, {json(){}, static(){}});
  const context = vm.createContext({require: name => ({express, path, 'mysql2/promise':{createPool:()=>({getConnection:async()=>conn,query:async(sql,params)=>{queries.push({sql,params});return [[{id:42,source_brew_id:9}]];}})}, cors:()=>{}, 'bonjour-service':{}})[name] ?? require(path.join(__dirname, '../backend', name)), process:{env:{}}, __dirname:path.join(__dirname,'../backend'), console});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../backend/server.js'),'utf8'), context);
  return {queries, routes, committed:()=>committed, res:()=>({code:200,status(n){this.code=n;return this;},json(data){this.data=data;return this;}})};
}

test('新增 API 接受 nullable 來源、拒絕無效或不存在的來源', async () => {
  for (const source of [null, 42, '42', -1, 0, 2147483648]) {
    const a=api(), res=a.res();
    await a.routes['POST /api/brews']({body:{brew:{source_brew_id:source,H_I:'H'}}},res);
    if (source===null || source===42) {
      assert.equal(res.code,200);
      const insert=a.queries.find(q=>q.sql.includes('INSERT INTO brews'));
      assert.equal(insert.params.at(-1),source);
      assert.equal((insert.sql.match(/\?/g)||[]).length,insert.params.length);
      assert.equal(a.committed(),true);
    } else { assert.equal(res.code,400); assert.equal(a.queries.length,0); }
  }
  const a=api(false),res=a.res();
  await a.routes['POST /api/brews']({body:{brew:{source_brew_id:42,H_I:'H'}}},res);
  assert.equal(res.code,400);
  assert.equal(a.committed(),false);
  assert.ok(!a.queries.some(q=>q.sql.includes('INSERT')));
});

test('詳情 API 回傳 source_brew_id',async()=>{
  const a=api(),res=a.res();
  await a.routes['GET /api/brews/:id']({params:{id:'42'}},res);
  assert.equal(res.data.source_brew_id,9);
  assert.match(a.queries[0].sql,/b\.source_brew_id/);
});

test('再煮一杯後修改參數：API 寫入修改後的新紀錄與注水資料，不修改原紀錄', async () => {
  const f = frontend();
  const original = {
    id: 42, bean_id: 3, dripper_id: 8, bean_weight: 15, grind: 2, H_I: 'I',
    water_vol: 200, water_temp: 90, ice_vol: 45,
    sour: 5, notes: '原始心得',
    pours: [{pour_order:0,volume_ml:40,duration_s:10,wait_s:30},
      {pour_order:1,volume_ml:160,duration_s:40,wait_s:20}],
  };
  f.run(`currentBrew = ${JSON.stringify(original)}`);
  await f.run('brewAgain()');

  // 模擬使用者修改表單，而非直接替換提交 payload。
  const edits = {
    'f-beans':'7', 'f-dripper':'9', 'f-bean-weight':'18', 'f-grind':'2.5', 'f-hi':'H',
    'f-water-vol':'250', 'f-water-temp':'94', 'f-ice-vol':'0',
    'f-notes':'調整後比較甜',
    'pour-0-vol':'50', 'pour-0-dur':'12', 'pour-0-wait':'25',
    'pour-1-vol':'200', 'pour-1-dur':'45', 'pour-1-wait':'15',
  };
  for (const [id,value] of Object.entries(edits)) f.get(id).value = value;
  f.run("setScore('sour', 2); setScore('sweet', 4);");

  const a = api();
  let savedResponse;
  f.context.fetch = async (url, options) => {
    assert.equal(url, 'http://localhost:3001/api/brews');
    assert.equal(options.method, 'POST');
    const res = a.res();
    await a.routes['POST /api/brews']({body:JSON.parse(options.body)},res);
    savedResponse = res;
    return {ok:res.code===200,json:async()=>res.data};
  };
  f.run('showList = () => {};');
  await f.run('submitBrew()');

  assert.equal(savedResponse.code,200);
  assert.equal(savedResponse.data.id,100);
  assert.notEqual(savedResponse.data.id,original.id);
  const insert = a.queries.find(q=>q.sql.includes('INSERT INTO brews'));
  const columns = insert.sql.match(/INSERT INTO brews\s*\(([^)]+)\)/)[1].split(',').map(s=>s.trim());
  const stored = Object.fromEntries(columns.map((column,i)=>[column,insert.params[i]]));
  for (const [key,value] of Object.entries({bean_id:7,dripper_id:9,bean_weight:18,grind:2.5,H_I:'H',water_vol:250,
    water_temp:94,ice_vol:0,notes:'調整後比較甜',sour:2,sweet:4,source_brew_id:42})) {
    assert.equal(stored[key],value,`新紀錄應保存修改後的 ${key}`);
  }
  const pourInserts = a.queries.filter(q=>q.sql.includes('INSERT INTO pours'));
  assert.deepEqual(pourInserts.map(q=>Array.from(q.params)),[
    [100,0,50,12,25], [100,1,200,45,15],
  ]);
  assert.equal(a.committed(),true);
  // 新增流程只查詢來源並 INSERT，新參數不會 UPDATE／DELETE 原沖煮或注水資料。
  assert.ok(a.queries.every(q=>/^\s*(SELECT|INSERT)\b/i.test(q.sql)));
  assert.deepEqual(JSON.parse(f.run('JSON.stringify(currentBrew)')),original);
});


test('豆款介面標示用完狀態，保留補記選項，狀態切換送出 boolean', async () => {
  const f = frontend();
  const beans = [{ id: 3, beans_name: '花香豆', is_finished: 1 }, { id: 7, beans_name: '新豆', is_finished: 0 }];
  f.context.fetch = async () => ({ ok: true, json: async () => beans });
  await f.run('loadBeansList()');
  assert.match(f.get('beans-list').innerHTML, /花香豆（已用完）/);
  assert.match(f.get('beans-list').innerHTML, /標示仍有豆子/);
  assert.match(f.get('beans-list').innerHTML, /標示已用完/);
  await f.run('loadBeansIntoSelect(3)');
  assert.match(f.get('f-beans').innerHTML, /花香豆（已用完）/);
  assert.equal(f.get('f-beans').value, '3');
  const requests = [];
  f.context.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => options ? {} : beans };
  };
  await f.run('toggleBeanFinished(3, false)');
  assert.equal(requests[0].url, 'http://localhost:3001/api/beans/3/finished');
  assert.equal(requests[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(requests[0].options.body), { is_finished: false });
});
