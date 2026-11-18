const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

async function main() {
  const args = process.argv.slice(2);
  const useMysql = args.includes('--mysql');
  const urlIndex = args.indexOf('--url');
  const client = new Client({ name: 'brewfolio-demo-check', version: '0.1.0' });
  const transport = urlIndex >= 0
    ? new StreamableHTTPClientTransport(new URL(args[urlIndex + 1]), {
      requestInit: process.env.MCP_HTTP_TOKEN ? { headers: { Authorization: `Bearer ${process.env.MCP_HTTP_TOKEN}` } } : undefined,
    })
    : new StdioClientTransport({
      command: process.execPath,
      args: [`--env-file-if-exists=${path.join(__dirname, '../.env')}`, path.join(__dirname, '../mcp/start.js'), ...(useMysql ? [] : ['--demo'])],
      env: { ...process.env, MCP_DATA_MODE: useMysql ? 'mysql' : 'demo' },
      stderr: 'inherit',
    });
  const timer = setTimeout(() => { console.error('MCP 檢查逾時'); process.exit(1); }, 20000).unref();
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    console.log(`已透過 MCP 連線，發現工具：${tools.tools.map(tool => tool.name).join(', ')}`);
    async function call(name, args) {
      const result = await client.callTool({ name, arguments: args });
      if (result.isError) throw new Error(result.content?.find(item => item.type === 'text')?.text || 'Tool failed');
      return result.structuredContent;
    }
    const search = await call('search_brews', { available_only: true, drink_type: 'I', limit: 10 });
    console.log(`\n資料來源：${search.data_source}${search.fictional_demo_data ? '（虛構示範資料）' : ''}`);
    console.log('可用豆款的冰飲證據：');
    console.table(search.beans.map(bean => ({
      豆款: bean.name, 冰飲紀錄: bean.evidence.brew_count,
      已評香氣: bean.evidence.aroma_rated_count, 香氣平均: bean.evidence.aroma_average, 星標: bean.evidence.starred_count,
    })));
    if (search.has_more || search.beans_truncated) console.log('結果有截斷，完整資料需分頁或縮小條件。');
    const first = search.brews.find(brew => brew.starred) || search.brews[0];
    if (!first) { console.log('沒有符合條件的冰飲紀錄；MCP 連線正常。'); return; }
    const detail = await call('get_brew', { brew_id: first.id });
    console.log(`\nget_brew #${first.id}：${detail.brew.bean.name}`);
    console.log(JSON.stringify({ parameters: detail.brew.parameters, sensory: detail.brew.sensory, starred: detail.brew.starred, notes: detail.brew.notes, pours: detail.brew.pours }, null, 2));
    // The stable demo fixtures deliberately contain a source/child pair.
    const child = search.brews.find(brew => brew.source_brew_id && search.brews.some(source => source.id === brew.source_brew_id));
    const second = search.brews.find(brew => brew.id !== first.id);
    if (child || second) {
      const left = child ? child.source_brew_id : first.id;
      const right = child ? child.id : second.id;
      const comparison = await call('compare_brews', { left_brew_id: left, right_brew_id: right });
      console.log(`\ncompare_brews #${left} → #${right}：`);
      console.table(comparison.comparison.parameters);
      console.log(comparison.comparison.caveat);
    }
    console.log('\nMCP 檢查完成。這是工具通訊示範，不是模型產生的推薦。');
  } finally { clearTimeout(timer); await client.close(); }
}
main().catch(error => { console.error(`MCP 檢查失敗：${error.message}`); process.exitCode = 1; });
