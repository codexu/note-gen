# P5 代理人

在 V3 的「設定 → 一般 → 代理人」新增、編輯或停用代理人。整理員、排程員、研究員、回顧員提供新建時的工具預選，自訂角色從空工具集合開始。已存設定可逐項增減授權。

## 開工卡接點

呼叫 `enqueueAgentTask({ agentId, prompt, title? })`。它回傳已排隊的 `AgentTask`。任務種類為 `agent:<uuid>`，每個 ID 都有自己的 runner。重啟時會替資料庫中既有的代理人任務重新註冊 runner，續跑前重新讀取設定。P5 使用任務中心的並行設定。開工卡的相依排程、定時觸發、對話串專案資料夾限制由後續階段接入。

允許的工具取自 P5 安全工具清單與該代理人授權的交集。每次呼叫在處理參數或預覽前都會讀取最新授權。移除授權或停用後，後續的呼叫會遭拒。新增的授權從下一次執行起會出現在模型工具清單。唯讀行事曆使用裝置既有的權限。新增和修改只會建立 Markdown 草稿，成功、失敗或取消時已存草稿都能進既有 Agent 任務中心的審核佇列。收下時沿用衝突與工作區檢查。停用後，先前已提交的草稿仍由使用者決定。

用 `listAgentToolRefusals(taskId)` 查詢拒絕紀錄。每筆包含 agent ID、task ID、工具名稱、原因和時間，沒有工具參數或提示詞。

## SQLite 遷移與回退

與既有 `agent_tasks` 相同，在首次使用代理人資料時執行冪等的 `CREATE … IF NOT EXISTS`，由 TypeScript 經 Tauri SQL 存取本機 `sqlite:note.db`。原 `agent_tasks` 欄位與既有任務格式保留。

| 表 | 欄位 |
| --- | --- |
| `agent_settings` | `id`（UUID）、`name`、`role`、`enabled`（0/1）、`allowed_tools`（工具 ID 的 JSON 陣列）、`created_at`、`updated_at` |
| `agent_tool_refusals` | `id`、`agent_id`、`task_id`、`tool_name`、`reason`、`created_at`，以 `(task_id, id)` 索引 |
| `agent_tasks` | P5 任務沿用 `kind`、`drafts`、`status` 等欄位 |

回退時先關閉全部 NoteGen 視窗，完整備份目前版本的 `note.db`（若有 WAL，使用 SQLite 的 `.backup`），並處理或匯出仍需保留的 P5 草稿。若已用過 P5，對資料庫執行下列單一交易，再啟動舊版。舊版不認得 `agent:*` 種類，需先移除這些任務，避免它們被接成一般背景任務。已審核的 vault 修改依原有筆記流程處理。

```sql
BEGIN;
DELETE FROM agent_tasks WHERE kind LIKE 'agent:%';
DROP TABLE IF EXISTS agent_tool_refusals;
DROP TABLE IF EXISTS agent_settings;
COMMIT;
```

資料表尚未建立時，可直接切回舊版。再次升級會重新建立空的 P5 表。需要保留 P5 資料時，使用備份及相容版本。
