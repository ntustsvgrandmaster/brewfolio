const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');
const cors = require('cors');
const { Bonjour } = require('bonjour-service');

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
              TRIM(CONCAT_WS(' ',
                IF(b.bean_id IS NOT NULL AND mb.id IS NOT NULL, mb.beans_name, b.beans_name),
                IF(b.bean_id IS NOT NULL AND mb.id IS NOT NULL, mb.process,    b.process),
                IF(b.bean_id IS NOT NULL AND mb.id IS NOT NULL, mb.roast_level,b.roast_level)
              )) AS beans_display
       FROM brews b
       LEFT JOIN myBeans mb ON b.bean_id = mb.id
       ORDER BY b.brewed_at DESC`
    );
    res.json(rows.map(r => ({ ...r, beans_display: r.beans_display || '未知豆款' })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET 單筆：優先從 myBeans 取豆款資料，找不到才 fallback 到 brews 快照
app.get('/api/brews/:id', async (req, res) => {
  try {
    const [[brew]] = await pool.query(
      `SELECT b.id, b.brewed_at,
              b.bean_id,
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
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { brew, pours = [] } = req.body;

    // 快照：從 myBeans 撈當下的豆款資料
    let beans_name = null, process = null, roast_level = null;
    if (brew.bean_id) {
      const [[bean]] = await conn.query(
        'SELECT beans_name, process, roast_level FROM myBeans WHERE id = ?',
        [brew.bean_id]
      );
      if (bean) ({ beans_name, process, roast_level } = bean);
    }

    const [result] = await conn.query(
      `INSERT INTO brews
         (bean_id, beans_name, process, roast_level,
          grind, H_I, bean_weight, water_vol, water_temp, ice_vol,
          sour, sweet, bitter, richness, aroma, notes)
       VALUES (?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?)`,
      [
        brew.bean_id, beans_name, process, roast_level,
        brew.grind, brew.H_I, brew.bean_weight,
        brew.water_vol, brew.water_temp, brew.ice_vol,
        brew.sour, brew.sweet, brew.bitter, brew.richness, brew.aroma,
        brew.notes || null,
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
    res.json({ id: brewId });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// PATCH 更新 notes
app.patch('/api/brews/:id/notes', async (req, res) => {
  try {
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
  try {
    const { starred } = req.body;
    if (typeof starred !== 'boolean' && starred !== 0 && starred !== 1)
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
  const conn = await pool.getConnection();
  try {
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
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ── Beans ────────────────────────────────────────────────

// GET 所有豆款
app.get('/api/beans', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, beans_name, process, roast_level FROM myBeans ORDER BY beans_name ASC'
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST 新增豆款
app.post('/api/beans', async (req, res) => {
  try {
    const { beans_name, process, roast_level } = req.body;
    if (!beans_name || !beans_name.trim())
      return res.status(400).json({ error: '豆款名稱不得為空' });
    const [result] = await pool.query(
      'INSERT INTO myBeans (beans_name, process, roast_level) VALUES (?, ?, ?)',
      [beans_name.trim(), process?.trim() || null, roast_level?.trim() || null]
    );
    res.json({ id: result.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT 編輯豆款
app.put('/api/beans/:id', async (req, res) => {
  try {
    const { beans_name, process, roast_level } = req.body;
    if (!beans_name || !beans_name.trim())
      return res.status(400).json({ error: '豆款名稱不得為空' });
    const [result] = await pool.query(
      'UPDATE myBeans SET beans_name = ?, process = ?, roast_level = ? WHERE id = ?',
      [beans_name.trim(), process?.trim() || null, roast_level?.trim() || null, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE 刪除豆款
app.delete('/api/beans/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM myBeans WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = 3001;
// app.listen(PORT, '0.0.0.0', () => console.log(`✅ Coffee API running at http://localhost:${PORT}`));
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Coffee API running at http://localhost:${PORT}`);
});
