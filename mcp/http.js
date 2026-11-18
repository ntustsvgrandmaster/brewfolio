const { createMcpExpressApp } = require('@modelcontextprotocol/sdk/server/express.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { timingSafeEqual } = require('node:crypto');
const { createMcpServer } = require('./server');

function createHttpApp(repository, { allowedHosts = [], allowedOrigins = [], token = '', logger = console.error } = {}) {
  if (repository.mode === 'mysql' && !token) throw new Error('MySQL HTTP 模式需設定 MCP_HTTP_TOKEN；本機 stdio 不需要此 token。');
  const app = createMcpExpressApp({ host: '127.0.0.1', ...(allowedHosts.length ? { allowedHosts: ['localhost', '127.0.0.1', '[::1]', ...allowedHosts] } : {}) });
  const origins = new Set(['http://localhost:6274', 'http://127.0.0.1:6274', ...allowedOrigins]);
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && !origins.has(origin)) return res.status(403).json({ error: 'Origin not allowed' });
    next();
  });
  app.get('/health', (req, res) => res.json({ ok: true, service: 'brewfolio-mcp', data_source: repository.mode, fictional_demo_data: repository.mode === 'demo' }));
  app.use('/mcp', (req, res, next) => {
    if (token) {
      const expected = Buffer.from(`Bearer ${token}`);
      const supplied = Buffer.from(req.get('authorization') || '');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    next();
  });
  app.post('/mcp', async (req, res) => {
    const server = createMcpServer(repository, { logger });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger(`[brewfolio] HTTP failed: ${error.code || error.name || 'Error'}`);
      await server.close().catch(() => {});
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  });
  app.all('/mcp', (req, res) => res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Stateless MCP endpoint accepts POST only.' }, id: null }));
  return app;
}
module.exports = { createHttpApp };
