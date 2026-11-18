const mysql = require('mysql2/promise');
const fixtures = require('./demo-data');
const { sqlFilters, beanMatches, baseMatches, refinementMatches } = require('./search');

function createDemoRepository() {
  const attach = brew => {
    const bean = fixtures.beans.find(bean => bean.id === brew.bean_id);
    return { ...brew, master_id: bean?.id ?? null, master_name: bean?.beans_name ?? null,
      master_process: bean?.process ?? null, master_roast: bean?.roast_level ?? null,
      master_finished: bean?.is_finished ?? null };
  };
  return {
    mode: 'demo',
    async search(filters) {
      const beans = fixtures.beans.filter(bean => beanMatches(bean, filters));
      const scope = fixtures.brews.filter(brew => beanMatches(fixtures.beans.find(bean => bean.id === brew.bean_id), filters) && baseMatches(brew, filters));
      const matches = scope.filter(brew => refinementMatches(brew, filters));
      const summaries = beans.map(bean => {
        const rows = scope.filter(brew => brew.bean_id === bean.id);
        const rated = rows.filter(brew => brew.aroma !== null);
        return { ...bean, brew_count: rows.length, aroma_rated_count: rated.length,
          aroma_average: rated.length ? rated.reduce((sum, brew) => sum + brew.aroma, 0) / rated.length : null,
          aroma_at_least_4_count: rated.filter(brew => brew.aroma >= 4).length,
          starred_count: rows.filter(brew => brew.starred === 1).length,
          matching_count: rows.filter(brew => refinementMatches(brew, filters)).length };
      });
      matches.sort((a, b) => (b.brewed_at || '').localeCompare(a.brewed_at || '') || b.id - a.id);
      return { total: matches.length, rows: matches.slice(filters.offset, filters.offset + filters.limit).map(attach), beans: summaries.slice(0, 100), beansTruncated: summaries.length > 100 };
    },
    async get(id) {
      const brew = fixtures.brews.find(brew => brew.id === id);
      return brew ? { ...attach(brew), pours: fixtures.pours.filter(pour => pour.brew_id === id).map(pour => ({ ...pour })) } : null;
    },
    async close() {},
  };
}

function createMysqlRepository(env = process.env, injectedPool) {
  const pool = injectedPool || mysql.createPool({
    host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT || 3306),
    user: env.MCP_DB_USER || env.DB_USER || 'root', password: env.MCP_DB_PASSWORD ?? env.DB_PASSWORD ?? '',
    database: env.DB_NAME || 'coffee', connectionLimit: 4, connectTimeout: 5000,
    waitForConnections: true, queueLimit: 20, dateStrings: true,
  });
  const select = `b.*, mb.id AS master_id, mb.beans_name AS master_name,
    mb.process AS master_process, mb.roast_level AS master_roast, mb.is_finished AS master_finished`;
  // Each operation uses a consistent read-only snapshot. No INSERT/UPDATE/DELETE is exposed.
  async function read(callback) {
    const conn = await pool.getConnection();
    try {
      await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
      const query = async (sql, params = []) => (await conn.query({ sql, timeout: 10000 }, params))[0];
      const result = await callback(query);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback().catch(() => {});
      throw error;
    } finally { conn.release(); }
  }
  return {
    mode: 'mysql',
    async search(filters) {
      return read(async query => {
        const f = sqlFilters(filters);
        const conditions = [...f.bean, ...f.base, ...f.match];
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const params = [...f.beanParams, ...f.baseParams, ...f.matchParams];
        const from = 'FROM brews b LEFT JOIN myBeans mb ON mb.id = b.bean_id';
        const [count] = await query(`SELECT COUNT(*) AS total ${from} ${where}`, params);
        const rows = await query(`SELECT ${select} ${from} ${where}
          ORDER BY b.brewed_at DESC, b.id DESC LIMIT ? OFFSET ?`, [...params, filters.limit, filters.offset]);
        const matching = ['b.id IS NOT NULL', ...f.match].join(' AND ');
        const summaries = await query(`SELECT mb.id, mb.beans_name, mb.process, mb.roast_level, mb.is_finished,
          COUNT(b.id) AS brew_count, COUNT(b.aroma) AS aroma_rated_count, AVG(b.aroma) AS aroma_average,
          COALESCE(SUM(b.aroma >= 4), 0) AS aroma_at_least_4_count,
          COALESCE(SUM(b.starred = 1), 0) AS starred_count,
          SUM(CASE WHEN ${matching} THEN 1 ELSE 0 END) AS matching_count
          FROM myBeans mb LEFT JOIN brews b ON b.bean_id = mb.id ${f.base.length ? `AND ${f.base.join(' AND ')}` : ''}
          ${f.bean.length ? `WHERE ${f.bean.join(' AND ')}` : ''}
          GROUP BY mb.id, mb.beans_name, mb.process, mb.roast_level, mb.is_finished
          ORDER BY mb.id LIMIT 101`, [...f.matchParams, ...f.baseParams, ...f.beanParams]);
        return { total: Number(count.total), rows, beans: summaries.slice(0, 100), beansTruncated: summaries.length > 100 };
      });
    },
    async get(id) {
      return read(async query => {
        const [brew] = await query(`SELECT ${select} FROM brews b LEFT JOIN myBeans mb ON mb.id = b.bean_id WHERE b.id = ?`, [id]);
        if (!brew) return null;
        const pours = await query('SELECT id, brew_id, pour_order, volume_ml, duration_s, wait_s FROM pours WHERE brew_id = ? ORDER BY pour_order, id', [id]);
        return { ...brew, pours };
      });
    },
    async close() { await pool.end(); },
  };
}
function createRepository({ mode = process.env.MCP_DATA_MODE || 'mysql', env = process.env } = {}) {
  if (mode === 'demo') return createDemoRepository();
  if (mode === 'mysql') return createMysqlRepository(env);
  throw new Error('MCP_DATA_MODE must be demo or mysql');
}
module.exports = { createRepository, createDemoRepository, createMysqlRepository };
