# Brewfolio MCP：面試 Demo 與 ChatGPT 連接

目前提供三個唯讀 MCP 工具，使用官方 `@modelcontextprotocol/sdk`，支援本機 stdio 與 stateless Streamable HTTP。MCP 回傳資料與計算結果；自然語言理解、工具選擇及推薦由連接的模型負責。本專案沒有內建付費模型呼叫。

## 最快驗證：不需要 MySQL 或模型金鑰

在專案目錄執行：

```sh
npm install
npm run mcp:check
```

`mcp:check` 會啟動獨立的 stdio MCP 子程序，由官方 MCP client 真正執行初始化、列出工具，再依序呼叫三個工具；完成後關閉子程序。這是可重複的工具展示，不是 AI 自動推薦。

資料來自 `backend/coffee/demo-data.js` 的虛構樣本，對應 [驗收情境](agent-acceptance-prompts.md)。不會讀寫 MySQL，也不會覆寫你的真實紀錄；回傳會明確帶 `data_source: "demo"` 與 `fictional_demo_data: true`。

預期可看到：

- `search_brews`、`get_brew`、`compare_brews` 三個工具。
- 可用豆款的冰飲統計：A 有 3 杯、2 杯已評香氣，平均 4.5；C 有 2 杯，平均 2.5；D 沒有紀錄，平均為 null。
- B 已用完，因此不在「目前可用」清單；孤立快照 401 不會併入 A。
- 101 的配方：粉 15 g、注水 150 ml、水溫 92°C、冰塊 75 g、原始研磨刻度 4，以及分段注水與原始心得。
- 101 → 102 的水溫差 +2°C、刻度差 +1。這不代表「磨粗」或已證明香氣變化的原因。

## 啟動 HTTP 服務與 Inspector

第一個終端機：

```sh
npm run mcp:demo
```

服務只綁定本機 `127.0.0.1:3002`：

- MCP：`http://127.0.0.1:3002/mcp`
- 健康檢查：`http://127.0.0.1:3002/health`

第二個終端機可以先驗證 HTTP：

```sh
npm run mcp:check -- --url http://127.0.0.1:3002/mcp
```

若需要視覺化展示工具清單與輸入／輸出：

```sh
npx @modelcontextprotocol/inspector@latest
```

依 Inspector 顯示的網址開啟介面，選擇 **Streamable HTTP**，輸入上述 `/mcp` 網址。保留 Inspector 預設的 proxy 模式，依其畫面提示連線。`GET /mcp` 回傳 405 是預期行為；請使用 MCP client，不能用一般網頁載入測試協定是否正常。

依序呼叫：

### 1. 搜尋目前可用豆款的冰飲紀錄

工具：`search_brews`

```json
{
  "available_only": true,
  "drink_type": "I",
  "limit": 10
}
```

### 2. 查看可重現的配方

工具：`get_brew`

```json
{
  "brew_id": 101
}
```

### 3. 比較沿用配方後的差異

工具：`compare_brews`

```json
{
  "left_brew_id": 101,
  "right_brew_id": 102
}
```

展示重點是「取得證據 → 閱讀完整紀錄 → 用程式比較」。備註指出 102 有乾澀問題，不能只因為香氣分數較高就斷定它更值得重現。

完成後在 HTTP 服務及 Inspector 終端機按 Ctrl+C 關閉。

## 三個工具的介面

| 工具 | 輸入 | 回傳 |
| --- | --- | --- |
| search_brews | 豆款 ID／名稱、冰熱、是否只看可用豆、星標、最低香氣、備註文字、日期、分頁 | 主檔豆款與證據統計、符合條件的沖煮摘要、分頁資訊、解讀規則 |
| get_brew | brew_id | 一杯實際配方、感官分數、星標、完整原文備註、分段注水與來源 ID |
| compare_brews | left_brew_id、right_brew_id | 兩筆完整紀錄、參數與分數及分段差異、沿用關係與解讀限制 |

搜尋的補充約定：

- `available_only` 預設 **false**，以便查詢已用完豆款的歷史。問「目前有的豆子」時必須傳 true。
- `bean_name` 搜尋主檔名稱，不以同名快照猜測關聯。名稱可能匹配多款，精確選擇請用 bean_id。
- `notes_query` 是文字包含搜尋，不是向量、語意或網路搜尋。MySQL 的大小寫／字元比對依既有 collation；demo 使用一般字串比對。
- 每頁最多 50 筆沖煮，預設 10 筆；offset 上限 10000。讀取 has_more、next_offset，不能把一頁當成完整歷史；到分頁上限需用豆款或日期縮小範圍。
- 豆款摘要最多 100 款，超過時 beans_truncated 為 true，需縮小豆款條件。沒有沖煮紀錄的豆款也會出現在摘要中。
- 摘要中的 brew_count、aroma_rated_count、aroma_average、aroma_at_least_4_count 與 starred_count 套用豆款／可用狀態、冰熱與日期條件；只有 matching_count 再套用最低香氣、星標與備註條件。每次結果的 bean_summary_scope 都會說明這個差異；香氣平均最多保留四位小數，demo 與 MySQL 一致。
- `aroma_at_least_4_count` 只是固定強度區間的筆數，不是「好喝」或自動設定的推薦門檻。
- 搜尋備註最多預覽 2000 字；notes_truncated 為 true 時，使用 get_brew 讀完整原文。
- 日期採既有資料庫日曆日期，date_from／date_to 均含當日。現有歷史 DATETIME 未校正時區，不偷偷當成 UTC。
- 未連主檔的歷史紀錄只有在沒有豆款／可用條件的歷史搜尋中可能出現，會標示 legacy_snapshot_only，不列入主檔統計。

## ChatGPT 怎麼使用

截至 2026-11-06 查核的 [OpenAI 官方連接文件](https://developers.openai.com/plugins/deploy/connect-chatgpt)，ChatGPT 可透過可達的 HTTPS MCP endpoint 或 Secure MCP Tunnel 連接；不是把 localhost 網址貼進一般對話就會連上。新增及使用自訂 MCP 也取決於帳號與工作區權限，畫面名稱可能因版本不同。

### 路徑 A：Secure MCP Tunnel

官方提供 [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)，可把私有 stdio／HTTP MCP 接給 ChatGPT，不用公開本機服務。需要 Platform tunnel、相關權限和供 tunnel-client 使用的 runtime API key；本機 demo 本身不需要金鑰。

1. 在官方 tunnel 設定建立或重用 tunnel，確認關聯到打算展示的 ChatGPT 工作區。
2. 從官方頁面取得 tunnel-client，依其目前的 `help quickstart` 設定。把 MCP 目標指向本專案的 stdio 命令或本機 HTTP `/mcp`；展示時持續運行 tunnel-client。
3. 在 ChatGPT Plugins 的新增入口選 **Add custom MCP server**，連接方式選 **Tunnel**，指定同一個 tunnel；依畫面完成驗證與安裝。
4. 開新對話，以 `@` 選取已安裝的項目，再輸入下方展示 Prompt。

stdio 命令範例（請依本機 Node 路徑調整）：

```sh
node /Users/panchin/Downloads/coffee/mcp/start.js --demo
```

若連真實 MySQL，移除 `--demo`，並明確提供設定檔路徑：

```sh
node --env-file=/Users/panchin/Downloads/coffee/.env /Users/panchin/Downloads/coffee/mcp/start.js
```

tunnel 的金鑰只在本機安全輸入；不要放進聊天、命令列參數、提交的設定檔或 demo 畫面。

### 路徑 B：HTTPS 開發網址

若已有 HTTPS 部署或開發轉送服務，可將它指向本機 demo 的 3002 port。HTTP 服務會檢查 Host；啟動時須明確允許轉送服務送到本機的 hostname，例如：

```sh
MCP_ALLOWED_HOSTS=your-demo-host.example npm run mcp:demo
```

在 ChatGPT 新增自訂 MCP 時輸入完整 `https://your-demo-host.example/mcp`。本範例 hostname 是占位符，不是已部署網址。無驗證的公開 demo 只使用虛構資料；真實資料 HTTP 模式另要求 bearer token，本版沒有 OAuth discovery，不能假設可直接以 ChatGPT 的 OAuth 選項登入。真實資料連接優先採上方私有 stdio tunnel。

本次只完成服務端與連接步驟，**尚未建立公開網址、tunnel 或在你的 ChatGPT 帳號實測工具呼叫**。只有 ChatGPT 實際成功呼叫後，才能算端到端連接完成。

## 連好 ChatGPT 後的三段展示 Prompt

### 第一段：找到符合目標的實際配方

> 請使用 Brewfolio 的工具。在目前未標示用完的豆子中，找出有冰咖啡紀錄、香氣至少 4 分的豆款。請同時閱讀備註與星標，選一筆適合重現的實際紀錄，列出配方、分段注水及來源 ID。請說明這是示範資料，並保留缺值與研磨設備未知的限制。

期望模型先搜尋，再取得 101 的完整紀錄；選 101 的依據包含香氣、星標與口感描述，不能只憑最高香氣選 102。

### 第二段：比較與說明不確定性

> 比較 101 和 102，列出參數及香氣的改變。能不能確定是磨粗讓香氣變強？

期望使用 compare_brews，指出刻度 +1、水溫 +2°C、香氣 +1，但不知道數字方向，也同時改了兩個變因；不能斷定因果。

### 第三段：證明沒有把缺資料判成差

> 新豆 D 沒有紀錄，是不是代表它不適合冰咖啡？另外請回顧已用完的莓果豆 B，是否有值得回購的經驗？

期望區分 D 的未知與 B 的歷史正面證據。B 必須另以 available_only=false 查詢，不能宣稱它現在仍有庫存或已有性價比資料。

模型是否遵守這些解讀邊界仍須人工驗收，不能因為工具通訊測試通過就聲稱自然語言驗收已全數通過。

## 改接自己的 MySQL

1. 複製 `.env.example` 為本機 `.env` 並設定連線，勿提交密碼。
2. 依現有流程執行 `npm run db:migrate`，確認 V003 的 is_finished 已存在；MCP 不會自動修改 schema。
3. 建議給 MCP 一個只具 SELECT 權限的帳號，在 `.env` 設定 MCP_DB_USER、MCP_DB_PASSWORD；未提供時沿用網站的 DB_USER、DB_PASSWORD。
4. 執行 stdio：`npm run mcp:start`；或執行檢查：`npm run mcp:check -- --mysql`。

### 使用 nodemon 啟動 HTTP MCP

在專案根目錄（不是 backend 子目錄）執行：

```sh
cd /Users/panchin/Downloads/coffee
nodemon --exec "node --env-file=.env" mcp/start.js --http
```

仍需先設定下方 HTTP 模式要求的 MCP_HTTP_TOKEN。專案的 nodemon.json 只監看 backend、mcp 的程式檔，不會掃描 baddy_work 的 Python 虛擬環境，避免出現 EMFILE（開啟／監看的檔案過多）。修改 .env 後，在 nodemon 輸入 rs 再按 Enter 重新載入。

如果只需要穩定展示，不需要修改程式後自動重啟，也可以直接執行：

```sh
node --env-file=.env mcp/start.js --http
```

這兩個命令的 .env 和 mcp/start.js 都以目前工作目錄解析。切到 backend 後沿用同一命令，會找不到根目錄的設定檔及程式。

MySQL repository 每次查詢以唯讀、一致性快照交易執行，只有固定 SELECT，SQL 條件全部使用參數，不提供任意 SQL 工具。連線失敗會明確回傳錯誤，不自動改用 demo 冒充真實紀錄。

若確實要用真實資料的 HTTP 模式，在本機環境設定 MCP_HTTP_TOKEN 後執行 `npm run mcp:http`；client 需傳 `Authorization: Bearer ...`。這只是本機／受控整合的共用 token，不是多使用者權限系統或 OAuth。避免把 token 放到網址或提交到 repo。

## 面試時可以說明的架構與限制

```text
ChatGPT／其他 MCP client
       ↓ stdio 或 Streamable HTTP
MCP server：三個唯讀工具、輸入 schema、工具描述與解讀指引
       ↓
Coffee service：單位轉換、資料來源標示、缺值處理、配方差異計算
       ↓
Repository：虛構固定資料，或 MySQL 參數化 SELECT＋唯讀交易
```

既有網站尚未改用這個 service，這一版先讓 MCP 獨立運作。後續可逐步共用服務層。

目前沒有多使用者／多租戶隔離、磨豆機管理、向量檢索、外部知識或寫入工具。這些是明確範圍，不應在 demo 宣稱已經完成。

## 本次驗證範圍

- `npm test`：涵蓋既有網站行為與 MCP 工具、資料解讀、SQL 參數化、錯誤處理、HTTP 初始化／發現／呼叫、Host／Origin 與 token 檢查。
- `npm run mcp:check`：已實際經 stdio 呼叫三個工具。
- HTTP client 與三個工具可用同一支檢查程式驗證。
- 已在獨立暫存 MySQL 9.6 套用 V001～V003，驗證 11 組 demo／MySQL 搜尋結果一致、完整配方比較及唯讀交易拒絕寫入。暫存服務與資料已關閉清除；未接觸使用者現有資料庫。一般 npm test 的 SQL 測試仍使用資料庫替身。
- 尚未連接使用者的實際 MySQL 或確認其連線、資料與部署版本。
- 尚未完成 ChatGPT 帳號端的連接與自然語言評估。
