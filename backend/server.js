const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');
const cors = require('cors');
const { isObject, isId, isFlag, isNotes, validPathId, validateBrew, validateBean, validateDripper } = require('./validation');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'coffee',
  waitForConnections: true,
  connectionLimit: 10,
});

// ── Brews ────────────────────────────────────────────────

// GET 列表：優先從 myBeans 取豆款資料，找不到才 fallback 到 brews 快照
app.get('/api/brews', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.id, b.brewed_at, b.H_I, b.starred, b.notes,
              b.dripper_id, d.name AS dripper_name, d.material AS dripper_material,
              TRIM(CONCAT_WS(' ',
                IF(b.bean_id IS NOT NULL AND mb.id IS NOT NULL, mb.beans_name, b.beans_name),
                IF(b.bean_id IS NOT NULL AND mb.id IS NOT NULL, mb.process,    b.process),
                IF(b.bean_id IS NOT NULL AND mb.id IS NOT NULL, mb.roast_level,b.roast_level)
              )) AS beans_display
       FROM brews b
       LEFT JOIN myBeans mb ON b.bean_id = mb.id
       LEFT JOIN drippers d ON b.dripper_id = d.id
       ORDER BY b.brewed_at DESC`
    );
    res.json(rows.map(r => ({ ...r, beans_display: r.beans_display || '未知豆款' })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET 單筆：優先從 myBeans 取豆款資料，找不到才 fallback 到 brews 快照
app.get('/api/brews/:id', async (req, res) => {
  if (!validPathId(req.params.id)) return res.status(400).json({ error: 'ID 必須是正整數' });
  try {
    const [[brew]] = await pool.query(
      `SELECT b.id, b.brewed_at,
              b.bean_id, b.source_brew_id, b.dripper_id,
              d.name AS dripper_name, d.material AS dripper_material,
              IF(b.bean_id IS NOT NULL AND mb.id IS NOT NULL, mb.beans_name, b.beans_name) AS beans_name,
              IF(b.bean_id IS NOT NULL AND mb.id IS NOT NULL, mb.process,    b.process)    AS process,
              IF(b.bean_id IS NOT NULL AND mb.id IS NOT NULL, mb.roast_level,b.roast_level) AS roast_level,
              TRIM(CONCAT_WS(' ',
                IF(b.bean_id IS NOT NULL AND mb.id IS NOT NULL, mb.beans_name, b.beans_name),
                IF(b.bean_id IS NOT NULL AND mb.id IS NOT NULL, mb.process,    b.process),
                IF(b.bean_id IS NOT NULL AND mb.id IS NOT NULL, mb.roast_level,b.roast_level)
              )) AS beans_display,
              b.grind, b.H_I AS H_I, b.bean_weight,
              b.water_vol, b.water_temp, b.ice_vol,
              b.sour, b.sweet, b.bitter, b.richness, b.aroma, b.notes, b.starred
       FROM brews b
       LEFT JOIN myBeans mb ON b.bean_id = mb.id
       LEFT JOIN drippers d ON b.dripper_id = d.id
       WHERE b.id = ?`,
      [req.params.id]
    );
    if (!brew) return res.status(404).json({ error: 'Not found' });
    const [pours] = await pool.query(
      'SELECT * FROM pours WHERE brew_id = ? ORDER BY pour_order ASC',
      [req.params.id]
    );
    res.json({ ...brew, pours });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST 新增沖煮：收 bean_id，自動快照豆款資訊
app.post('/api/brews', async (req, res) => {
  const validated = validateBrew(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error });
  const { brew, pours, warnings } = validated;
  const sourceId = brew.source_brew_id;
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    if (sourceId !== null) {
      const [[source]] = await conn.query('SELECT id FROM brews WHERE id = ? FOR SHARE', [sourceId]);
      if (!source) {
        await conn.rollback();
        return res.status(400).json({ error: '來源紀錄已不存在，請移除來源連結後再儲存' });
      }
    }

    // 快照：從 myBeans 撈當下的豆款資料
    let beans_name = null, process = null, roast_level = null;
    if (brew.bean_id) {
      const [[bean]] = await conn.query(
        'SELECT beans_name, process, roast_level FROM myBeans WHERE id = ? FOR SHARE',
        [brew.bean_id]
      );
      if (!bean) {
        await conn.rollback();
        return res.status(400).json({ error: '豆款已不存在，請重新選擇豆款' });
      }
      ({ beans_name, process, roast_level } = bean);
    }

    const [result] = await conn.query(
      `INSERT INTO brews
         (bean_id, beans_name, process, roast_level,
          grind, H_I, bean_weight, water_vol, water_temp, ice_vol,
          sour, sweet, bitter, richness, aroma, notes, dripper_id, source_brew_id)
       VALUES (?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        brew.bean_id, beans_name, process, roast_level,
        brew.grind, brew.H_I, brew.bean_weight,
        brew.water_vol, brew.water_temp, brew.ice_vol,
        brew.sour, brew.sweet, brew.bitter, brew.richness, brew.aroma,
        brew.notes || null, brew.dripper_id, sourceId,
      ]
    );
    const brewId = result.insertId;

    for (const p of pours) {
      await conn.query(
        'INSERT INTO pours (brew_id, pour_order, volume_ml, duration_s, wait_s) VALUES (?, ?, ?, ?, ?)',
        [brewId, p.pour_order, p.volume_ml, p.duration_s, p.wait_s]
      );
    }

    await conn.commit();
    res.json({ id: brewId, warnings });
  } catch (err) {
    if (conn) await conn.rollback();
    if (err.code === 'ER_NO_REFERENCED_ROW_2' && err.message.includes('fk_brews_dripper')) {
      return res.status(400).json({ error: '濾杯已不存在，請重新選擇' });
    }
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

app.patch('/api/brews/:id/dripper', async (req, res) => {
  if (!validPathId(req.params.id)) return res.status(400).json({ error: 'ID 必須是正整數' });
  const id = isObject(req.body) ? req.body.dripper_id : undefined;
  if (id !== null && !isId(id)) return res.status(400).json({ error: '濾杯 ID 不正確' });
  try {
    const [result] = await pool.query('UPDATE brews SET dripper_id = ? WHERE id = ?', [id, req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: '找不到沖煮紀錄' });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ error: '濾杯已不存在，請重新選擇' });
    res.status(500).json({ error: err.message });
  }
});

// PATCH 更新 notes
app.patch('/api/brews/:id/notes', async (req, res) => {
  if (!validPathId(req.params.id)) return res.status(400).json({ error: 'ID 必須是正整數' });
  try {
    if (!isObject(req.body) || !Object.hasOwn(req.body, 'notes') || !isNotes(req.body.notes))
      return res.status(400).json({ error: '備註必須是文字或 null，且不可超過 65535 UTF-8 bytes' });
    const { notes } = req.body;
    const [result] = await pool.query(
      'UPDATE brews SET notes = ? WHERE id = ?',
      [notes ?? null, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH 更新 starred 狀態
app.patch('/api/brews/:id/starred', async (req, res) => {
  if (!validPathId(req.params.id)) return res.status(400).json({ error: 'ID 必須是正整數' });
  try {
    const starred = isObject(req.body) ? req.body.starred : undefined;
    if (!isFlag(starred))
      return res.status(400).json({ error: 'starred must be boolean' });
    const [result] = await pool.query(
      'UPDATE brews SET starred = ? WHERE id = ?',
      [starred ? 1 : 0, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, starred: starred ? 1 : 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE 刪除沖煮
app.delete('/api/brews/:id', async (req, res) => {
  if (!validPathId(req.params.id)) return res.status(400).json({ error: 'ID 必須是正整數' });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    await conn.query('DELETE FROM pours WHERE brew_id = ?', [req.params.id]);
    const [result] = await conn.query('DELETE FROM brews WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Not found' });
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    if (conn) await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// ── Beans ────────────────────────────────────────────────

// GET 所有豆款
app.get('/api/beans', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, beans_name, process, roast_level, is_finished FROM myBeans ORDER BY is_finished ASC, beans_name ASC'
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST 新增豆款
app.post('/api/beans', async (req, res) => {
  const validated = validateBean(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error });
  const { beans_name, process, roast_level } = validated.bean;
  try {
    const [result] = await pool.query(
      'INSERT INTO myBeans (beans_name, process, roast_level) VALUES (?, ?, ?)',
      [beans_name, process, roast_level]
    );
    res.json({ id: result.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT 編輯豆款
app.put('/api/beans/:id', async (req, res) => {
  if (!validPathId(req.params.id)) return res.status(400).json({ error: 'ID 必須是正整數' });
  const validated = validateBean(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error });
  const { beans_name, process, roast_level } = validated.bean;
  try {
    const [result] = await pool.query(
      'UPDATE myBeans SET beans_name = ?, process = ?, roast_level = ? WHERE id = ?',
      [beans_name, process, roast_level, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH 用完狀態：保留豆款及所有歷史關聯
app.patch('/api/beans/:id/finished', async (req, res) => {
  if (!validPathId(req.params.id)) return res.status(400).json({ error: 'ID 必須是正整數' });
  const finished = isObject(req.body) ? req.body.is_finished : undefined;
  if (!isFlag(finished)) return res.status(400).json({ error: 'is_finished 必須是 boolean 或 0/1' });
  try {
    const [result] = await pool.query('UPDATE myBeans SET is_finished = ? WHERE id = ?', [finished ? 1 : 0, req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, is_finished: finished ? 1 : 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE 只刪除未被沖煮紀錄使用的豆款，避免切斷歷史關聯
app.delete('/api/beans/:id', async (req, res) => {
  if (!validPathId(req.params.id)) return res.status(400).json({ error: 'ID 必須是正整數' });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[bean]] = await conn.query('SELECT id FROM myBeans WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!bean) {
      await conn.rollback();
      return res.status(404).json({ error: 'Not found' });
    }
    const [[used]] = await conn.query('SELECT id FROM brews WHERE bean_id = ? LIMIT 1 FOR SHARE', [req.params.id]);
    if (used) {
      await conn.rollback();
      return res.status(409).json({ error: '此豆款已有沖煮紀錄，請改為標示已用完，以保留歷史關聯' });
    }
    await conn.query('DELETE FROM myBeans WHERE id = ?', [req.params.id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    if (conn) await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// ── Drippers ─────────────────────────────────────────────

app.get('/api/drippers', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, material FROM drippers ORDER BY name, material, id');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/drippers', async (req, res) => {
  const { name, material, error } = validateDripper(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const [result] = await pool.query('INSERT INTO drippers (name, material) VALUES (?, ?)', [name, material]);
    res.status(201).json({ id: result.insertId, name, material });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/drippers/:id', async (req, res) => {
  if (!validPathId(req.params.id)) return res.status(400).json({ error: 'ID 必須是正整數' });
  const { name, material, error } = validateDripper(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const [result] = await pool.query('UPDATE drippers SET name = ?, material = ? WHERE id = ?', [name, material, req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: '找不到濾杯' });
    res.json({ id: Number(req.params.id), name, material });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/drippers/:id', async (req, res) => {
  if (!validPathId(req.params.id)) return res.status(400).json({ error: 'ID 必須是正整數' });
  try {
    const [result] = await pool.query('DELETE FROM drippers WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: '找不到濾杯' });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ error: '已有沖煮紀錄使用此濾杯，無法刪除' });
    res.status(500).json({ error: err.message });
  }
});

const PORT = 3001;
// app.listen(PORT, '0.0.0.0', () => console.log(`✅ Coffee API running at http://localhost:${PORT}`));
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Coffee API running at http://localhost:${PORT}`);
});
