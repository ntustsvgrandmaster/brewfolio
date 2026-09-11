const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function frontend() {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', hidden: false, textContent: '', disabled: false,
      classList: { remove() {}, add() {}, toggle() {} },
      set innerHTML(html) {
        this.html = html;
        for (const match of html.matchAll(/id="([^"]+)"/g)) get(match[1]).value = '';
      }, get innerHTML() { return this.html || ''; }, appendChild() {},
    });
    return nodes.get(id);
  };
  const context = vm.createContext({ console, window: { location: { hostname: 'localhost' } },
    document: { getElementById: get, querySelectorAll: () => [], createElement: () => get(`node-${nodes.size}`) },
    cancelAnimationFrame() {}, setTimeout() {},
    fetch: async () => ({ ok: true, json: async () => [{ id: 3, beans_name: 'Test bean' }] }),
  });
  const html = fs.readFileSync(path.join(__dirname, '../frontend/index.html'), 'utf8');
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/loadList\(\);\s*$/, ''), context);
  return { context, get, run: code => vm.runInContext(code, context) };
}

test('再煮一杯複製參數與注水量，重置結果，儲存來源且一般新增不沿用來源', async () => {
  const f = frontend();
  f.run(`currentBrew = { id: 42, bean_id: 3, bean_weight: 15, grind: 2, H_I: 'I', water_vol: 200, water_temp: 90, ice_vol: 0, sour: 5, notes: 'old', pours: [{pour_order:0,volume_ml:40,duration_s:10,wait_s:30},{pour_order:1,volume_ml:160,duration_s:40,wait_s:20}] }; tRunning=true; tLaps=[{}];`);
  await f.run('brewAgain()');
  assert.equal(f.get('f-bean-weight').value, 15);
  assert.equal(f.get('f-beans').value, '3');
  assert.equal(f.get('f-ice-vol').value, 0);
  assert.equal(f.get('pour-1-vol').value, 160);
  assert.equal(f.get('pour-0-dur').value, '');
  assert.equal(f.get('pour-1-wait').value, '');
  assert.equal(f.get('f-notes').value, '');
  assert.equal(f.run('scoreValues.sour'), 0);
  assert.equal(f.run('tRunning'), false);
  assert.equal(f.run('tLaps.length'), 0);
  let payload;
  f.context.fetch = async (_, options) => { payload = JSON.parse(options.body); return {ok:true}; };
  f.run('showList = () => {};');
  await f.run('submitBrew()');
  assert.equal(payload.brew.source_brew_id, 42);
  assert.equal(payload.brew.sour, null);
  assert.equal(payload.pours[0].duration_s, null);
  f.run('initForm()');
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
  const context = vm.createContext({require: name => ({express, path, 'mysql2/promise':{createPool:()=>({getConnection:async()=>conn,query:async(sql,params)=>{queries.push({sql,params});return [[{id:42,source_brew_id:9}]];}})}, cors:()=>{}, 'bonjour-service':{}})[name], process:{env:{}}, __dirname:path.join(__dirname,'../backend'), console});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../backend/server.js'),'utf8'), context);
  return {queries, routes, committed:()=>committed, res:()=>({code:200,status(n){this.code=n;return this;},json(data){this.data=data;return this;}})};
}

test('新增 API 接受 nullable 來源、拒絕無效或不存在的來源', async () => {
  for (const source of [null, 42, '42', -1, 0, 2147483648]) {
    const a=api(), res=a.res();
    await a.routes['POST /api/brews']({body:{brew:{source_brew_id:source}}},res);
    if (source===null || source===42) {
      assert.equal(res.code,200);
      const insert=a.queries.find(q=>q.sql.includes('INSERT INTO brews'));
      assert.equal(insert.params.at(-1),source);
      assert.equal((insert.sql.match(/\?/g)||[]).length,insert.params.length);
      assert.equal(a.committed(),true);
    } else { assert.equal(res.code,400); assert.equal(a.queries.length,0); }
  }
  const a=api(false),res=a.res();
  await a.routes['POST /api/brews']({body:{brew:{source_brew_id:42}}},res);
  assert.equal(res.code,400);
  assert.equal(a.committed(),false);
  assert.ok(!a.queries.some(q=>q.sql.includes('INSERT')));
});

test('詳情 API 回傳 source_brew_id',async()=>{
  const a=api(),res=a.res();
  await a.routes['GET /api/brews/:id']({params:{id:42}},res);
  assert.equal(res.data.source_brew_id,9);
  assert.match(a.queries[0].sql,/b\.source_brew_id/);
});

test('再煮一杯後修改參數：API 寫入修改後的新紀錄與注水資料，不修改原紀錄', async () => {
  const f = frontend();
  const original = {
    id: 42, bean_id: 3, bean_weight: 15, grind: 2, H_I: 'I',
    water_vol: 200, water_temp: 90, ice_vol: 45,
    sour: 5, notes: '原始心得',
    pours: [{pour_order:0,volume_ml:40,duration_s:10,wait_s:30},
      {pour_order:1,volume_ml:160,duration_s:40,wait_s:20}],
  };
  f.run(`currentBrew = ${JSON.stringify(original)}`);
  await f.run('brewAgain()');

  // 模擬使用者修改表單，而非直接替換提交 payload。
  const edits = {
    'f-beans':'7', 'f-bean-weight':'18', 'f-grind':'2.5', 'f-hi':'H',
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
  for (const [key,value] of Object.entries({bean_id:7,bean_weight:18,grind:2.5,H_I:'H',water_vol:250,
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
