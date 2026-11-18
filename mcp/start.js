const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { createRepository } = require('../backend/coffee/repository');
const { createMcpServer } = require('./server');
const { createHttpApp } = require('./http');

async function main() {
  const args = process.argv.slice(2);
  const allowed = new Set(['--demo', '--http']);
  if (args.some(arg => !allowed.has(arg))) throw new Error('支援的參數：--demo、--http');
  const repository = createRepository({ mode: args.includes('--demo') ? 'demo' : process.env.MCP_DATA_MODE || 'mysql' });
  let stopTransport = async () => {};
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    const timer = setTimeout(() => process.exit(1), 5000).unref();
    await stopTransport();
    await repository.close();
    clearTimeout(timer);
  };
  process.once('SIGINT', () => shutdown().then(() => process.exit(0)));
  process.once('SIGTERM', () => shutdown().then(() => process.exit(0)));
  if (args.includes('--http')) {
    const port = Number(process.env.MCP_PORT || 3002);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MCP_PORT 必須是 1～65535');
    const app = createHttpApp(repository, {
      allowedHosts: (process.env.MCP_ALLOWED_HOSTS || '').split(',').map(value => value.trim()).filter(Boolean),
      allowedOrigins: (process.env.MCP_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean),
      token: process.env.MCP_HTTP_TOKEN || '',
    });
    const listener = app.listen(port, '127.0.0.1', error => {
      if (error) { console.error(`[brewfolio] listener: ${error.code}`); shutdown().then(() => process.exit(1)); return; }
      console.error(`[brewfolio] MCP http://127.0.0.1:${port}/mcp (${repository.mode}${repository.mode === 'demo' ? ': 虛構示範資料' : ''})`);
    });
    listener.on('error', error => { console.error(`[brewfolio] listener: ${error.code}`); shutdown().then(() => process.exit(1)); });
    stopTransport = () => new Promise(resolve => { listener.close(resolve); listener.closeAllConnections(); });
  } else {
    const server = createMcpServer(repository);
    await server.connect(new StdioServerTransport());
    stopTransport = () => server.close();
    process.stdin.once('end', () => shutdown());
    console.error(`[brewfolio] MCP stdio (${repository.mode}${repository.mode === 'demo' ? ': 虛構示範資料' : ''})`);
  }
}
main().catch(error => { console.error(`[brewfolio] 啟動失敗：${error.message}`); process.exit(1); });
