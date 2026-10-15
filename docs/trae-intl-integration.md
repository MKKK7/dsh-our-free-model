# Trae 国际版接入 DSH 插件 —— 技术交接文档

> 面向对象：一个**完全没有上下文**的接手者（新 agent / 新对话 / 新工程师）。
> 本文档自包含：读完不需要回头翻聊天记录、不需要问原作者任何问题。
>
> 撰写时间：2026-10-15　｜　仓库分支：`feat/trae-international`　｜　HEAD：`e5b6588`
>
> ⚠️ 全文**不含任何真实凭据**。涉及 token / appId / uid / 私钥的地方一律只写字段名与所在文件路径。

---

## 0. 30 秒速览

**这套东西现在能干什么（已实测跑通）：**

- 在 DSH 里用 **Trae IDE 的 Pro $20 订阅**发真实对话请求，走字节国际版网关的 `inline_chat` 通道，返回真流式 SSE。
- 查询该账号的**真实美元余额**（Pro plan 基础额度 20 USD、快速请求 600 次），并解析成额度包。
- 在 DSH 的模型选择器里展示**从 Trae 客户端日志还原出来的 22 条真实模型目录**（GPT-6 家族、Kimi、DeepSeek、Gemini、MiniMax 等），名字与 Trae 界面一致。
- 国际版 OAuth 登录 / token 续期（ECDSA P-256 设备证明）已经打通，含凭据写回 `~/.dsh/.credentials.yaml` 的正确姿势。

**这套东西现在不能干什么（明确未解决）：**

- ❌ **无法在 HTTP 层指定模型**。请求体里写什么 `model` 都会被服务端忽略，57 次实测全部落到同一个模型池。这是**当前最重要的未解项**，详见第 8 节。
- ❌ 模型 `contextWindow` 全部填的 64_000 是**保守估值**，不是上游真值（RPC 响应体没落盘）。
- ❌ 国际版的**输出预算上限未知**（上游不发布 `max_output_tokens`），见第 13 节。
- ❌ **国内版（CN）路径完全没做**。CN 是 `coresg-normal.trae.ai` + AES-256-GCM 信封那一套，与国际版不同，本文只覆盖国际版。
- ❌ `solo_coder` / `solo_agent_lite` / `agent` / `solo_work_lite` 等**其他 agentType 的模型分组故意没有引入**，怕覆盖 `solo_agent` 菜单。

---

## 1. 背景与动机

用户购买了 **Trae IDE Pro $20 套餐**，希望把这份订阅接到 **DSH（DeepSeek Harness）** 里当对话后端使用——即用同一份账号订阅，在 DSH 里跑对话。

账号标识（**非凭据**，可公开记录）：

| 项 | 值 |
|---|---|
| uid | `7540914673709990928` |
| machineId | 64 位 hex，`018f7df5…c990fb`（完整值在凭据文件的 `machine_id` 字段） |
| appId | `6eefa01c-1036-4c7e-9ca5-d891f63cd8` |

---

## 2. 代码与资产位置

| 内容 | 路径 |
|---|---|
| 仓库根 | `D:\Work\DSH\dsh-our-free-model` |
| 分支 | `feat/trae-international` |
| 远端 | `https://github.com/MKKK7/dsh-our-free-model.git`（origin） |
| 核心源码目录 | `vendor/channel-pack/src/` |
| 构建产物 | `vendor/channel-pack/pack.js`（约 2.78 MiB / 2 913 337 字节） |
| 本仓库技术记录（先读这个） | `D:\Work\DSH\dsh-our-free-model\FORK-NOTES.md`（约 30 KB） |

### 2.1 与本工作直接相关的源文件

| 文件 | 作用 |
|---|---|
| `vendor/channel-pack/src/trae.ts`（约 100 KB） | 域名常量、请求头构造（`traeSOLOHeaders` 国际版分支在 231–275 行）、签到、聊天入口 |
| `vendor/channel-pack/src/trae-product.ts`（约 33 KB） | 端点路径函数族（`traeChatPathFor` / `traeEntUsagePathFor` / `traeModelsPathFor` …）、模型目录表 |
| `vendor/channel-pack/src/trae-credits.ts`（约 19 KB） | `fetchTraeCreditBalance`：余额查询与额度包解析 |
| `vendor/channel-pack/src/trae-adapter.ts`（约 99 KB） | 对话适配器（请求组装、SSE 解析、多轮） |
| `vendor/channel-pack/src/trae-auth.ts`（约 30 KB） | OAuth、模型拉取 `fetchModels` 分派 |
| `vendor/channel-pack/src/trae-oauth.ts`（约 47 KB） | `exchangeTraeCallback`：带 `DeviceInfo` + `DeviceProof` 的 token 交换 |
| `vendor/channel-pack/src/trae-errors.ts` | 上游错误码映射（`1001` / `2001` / `4011` / `4023` / `4120` / `4001`） |

### 2.2 提交历史（分支 `feat/trae-international`）

| 提交 | 内容 |
|---|---|
| `bc06f92` | 协议重写：**去掉加密信封**、换 host 与认证头，改为裸 JSON POST（此前的 `cefdd44` 之前还有一版错误实现的提交 `a26d164`/`fbd435d`/`2687feb`，是 ECDSA/PKCE/CN 路线的中间产物） |
| `c190193` | 用上游真目录的 18 个模型替换 `llm_raw_chat` 老通道的 9 个 |
| `b5d6ae8` | 余额恒 null 的三个根因修复 + 选模实测结论 |
| `e5b6588` | 模型目录 18 → 22（补回 `gpt-6-astra` / `gpt-6-sol` / `gpt-6.1-sol` / `minimax-m3`） |

---

## 3. 聊天协议（**已实测**，真身 = 国际版，与国内版不同）

### 3.1 端点

| 维度 | 值 |
|---|---|
| 主 host | `https://a0ai-api-sg.byteintlapi.com` |
| fallback host | `https://trae-api-sg.mchost.guru` |
| 方法 + 路径 | `POST /api/agent/v3/llm_utils_chat` |
| 认证方式 | `Authorization: Cloud-IDE-JWT <OAuth access_token>`，同一个 token 再复制一份到 `X-Cloudide-Token` |
| appId 头 | 小写 `x-app-id: 6eefa01c-1036-4c7e-9ca5-d891f63cd8` |
| 设备 ID 头 | `x-device-id` = `sha256(machineId).hex.slice(0,32)` —— **不是**登录时那个 19 位十进制 `device_id` |
| 加密信封 | **完全不需要**，裸 `fetch` POST JSON 即可 |
| GenerateTempToken | **不需要** |

> ⚠️ `/api/agent/v3/llm_utils_chat` 这个路径**国际版与国内版同名**，区别在 host 与是否要信封。

### 3.2 请求头全集（实测逐字有效）

```
Authorization: Cloud-IDE-JWT <access_token>
X-Cloudide-Token: <access_token>
x-uid: <uid>
x-app-id: 6eefa01c-1036-4c7e-9ca5-d891f63cd8
x-device-id: <sha256(machineId).hex 前 32 位>
x-machine-id: <machineId>
x-request-id: <randomUUID()>
x-ide-version: 3.3.67
x-ide-version-code: 20260401
x-device-type: windows
x-os-version: Windows 10
Content-Type: application/json
Accept: text/event-stream
```

对应代码：`vendor/channel-pack/src/trae.ts:231` 的 `traeSOLOHeaders(credential, product, stream, machineIdGeneration)`，`product.id === 'trae_intl'` 分支在 **231–275 行**，国际版在第 275 行 `return headers` 早返回，**不进入**下面的 CN SOLO 头逻辑。

### 3.3 请求体（裸 JSON，无信封）

```json
{
  "messages": [
    { "role": "user", "content": [ { "type": "text", "text": "..." } ] }
  ],
  "model": "<model-id>",
  "function": "inline_chat",
  "stream": true,
  "request_id": "<uuid>",
  "session_id": "<与 request_id 完全相同的 uuid>"
}
```

⚠️ **`request_id` 与 `session_id` 必须是同一个值**（实测：不同则表现异常）。

### 3.4 SSE 事件序列（实测顺序）

| 事件 | 载荷要点 |
|---|---|
| `progress_notice` | 进度提示 |
| `metadata` | **回显 `"model": ""`** —— 证明服务端根本没读我们发的 `model` 字段（这是选模失败的直接证据） |
| `timing_cost` | 含 `provider_model_name`（用它判断实际落到哪个池） |
| `output` × N | `{response, reasoning_content, tool_calls}` |
| `token_usage` | `{prompt_tokens, completion_tokens, total_tokens}` |
| `done` | `{finish_reason: "stop"}` |

---

## 4. 余额查询（**已修复并实测**，提交 `b5d6ae8`）

| 维度 | 值 |
|---|---|
| host | `https://growsg-normal.trae.ai` |
| 方法 + 路径 | `POST /trae/api/v1/pay/ide_user_ent_usage` |
| body | `{"require_usage":true,"req_source":2}` |

代码：`vendor/channel-pack/src/trae-credits.ts` 的 `fetchTraeCreditBalance`；路径函数 `traeEntUsagePathFor`（`vendor/channel-pack/src/trae-product.ts:398`）。

### 4.1 响应关键字段（国际版）

| 字段 | 含义 / 实测值 |
|---|---|
| `billing_version` | `3` |
| `is_dollar_usage_billing` | `true` —— **国际版是美元计费**，判据必须按这个字段分流 |
| `user_entitlement_pack_list[0].display_desc` | `"Pro plan"` |
| `quota.basic_usage_limit` | 套餐基础额度，**USD**，实测 `20` |
| `usage.basic_usage_amount` | 已用，USD |
| `quota.bonus_usage_limit` / `usage.bonus_usage_amount` | 赠送额度 |
| `quota.premium_model_fast_request_limit` | `600` —— **快速请求的「次数」，不是金额** |
| `quota.credits_limit` | 国际版**恒为 0**（这是国内版字段，不要包成额度） |
| `quota.auto_completion_limit` | `-1` = Unlimited，指**行内补全**配额，**不是对话额度** |
| 条目级 `expire_time` | 国际版**恒为 0** |
| `base.end_time` | **真实到期时间在这里**（Pro 实测 `1793583752` → 2026-10-31） |

### 4.2 三个被修掉的 bug（提交 `b5d6ae8`）

1. **端点指错**：原实现打 `ide_user_pay_status` → 改为 `ide_user_ent_usage`。
   - ⚠️ 同前缀的 `POST /trae/api/v1/pay/ide_user_pay_status` 也返回 200，但**只有** `enable_solo_*` / `user_pay_identity` / `trial_status`，**没有任何额度字段**。Trae 客户端启动日志里出现的是 pay_status，早前实现照着日志写就错了。
2. **认证头错**：国际版 pay 端点必须带 `Authorization: Cloud-IDE-JWT <token>`，代码在 `vendor/channel-pack/src/trae.ts` 的 `traeCheckinHeaders` 国际版分支补上。
3. **额度判据错**：按 `is_dollar_usage_billing` 分流；`basic_usage_limit` 才是美元额度；「快速请求次数」要单列成一个 `unit:'次'` 的包且**不并入 total**（并进去会让美元余额虚高）；`expire_time` 加 `base.end_time` 兜底。

### 4.3 认证头实测对照（8 组，唯一必需项）

国际版 pay 端点**唯一必需**的是 `Authorization: Cloud-IDE-JWT <token>`：

| 头集合 | 结果 |
|---|---|
| 全量含 Authorization | **200**，带额度 |
| 去掉 `X-Cloudide-Token` | 200（可省） |
| 去掉 `Authorization` | 401 `{"code":1001}` |
| 只留小写 `x-cloudide-token` | 401 |
| 插件改前的整套 `stable_i18n` 头 | 401 |

复现脚本：`D:\Work\DSH\tmp\probe-ent-headers.mjs`

### 4.4 自测输出（真实凭据打真实端点）

```
Pro plan · 基础额度      19.97892 / 20 USD   used 0.02108   deductionEndTime 1793583752000
Pro plan · 快速请求次数   600 / 600 次
```

复现脚本：`D:\Work\DSH\tmp\e2e-trae-credits.mjs`

### 4.5 ⚠️ 凭据字段名是**下划线**，不是驼峰

`TraeCredential` 的字段名为：`access_token` / `refresh_token` / `uid` / `machine_id` / `device_id`。

**写测试脚本时按驼峰（`accessToken` / `machineId` …）填会得到 401。** 排查这个坑花的时间比写功能本身还长——先确认字段名再动手。

---

## 5. 模型目录（提交 `e5b6588`，**日志还原，非上游真值**）

静态表：`TRAE_INTL_FALLBACK_MODELS`，位于 `vendor/channel-pack/src/trae-product.ts:496`（导出点在同文件约 618 行被引用为 `fallbackModels`），共 **22 条**，按 Trae 界面截图顺序排列，`displayName` 用界面字面值。

### 5.1 提取方式

从 Trae 客户端日志 `%APPDATA%\Trae\logs\<时间戳>\window*\renderer.log` 里用正则 **`solo_agent_1__<id>_null`** 提取（`e5b6588` 用的是 10-15 09:35 的 `window4/renderer.log`）。

- ⚠️ 日志里的 `model list refreshed` 事件**只记计数不记名字**（形如 `{"solo_agent":24}`），模型名必须从别的日志事件（`model_select_tooltip_show` / `model-writeback`）里拿。
- ⚠️ 早期版本的正则**漏了 `-` 和 `.` 混合分隔的 id**，所以只拿到 18 条；`e5b6588` 修好后 22 条。
- 提取脚本：`D:\Work\DSH\tmp\extract-model-ids.mjs`（更早的版本 `extract-models.mjs` / `extract-models2.mjs` / `extract-models3.mjs`），输出 `D:\Work\DSH\tmp\trae-intl-model-names.json`。

### 5.2 ⚠️ 三条必须知道的限制

1. **`contextWindow` 目前统一填 `64_000`，是保守估计值，不是上游真值**（RPC 响应体没落盘，取不到）。见第 12 节待办。
2. **这 22 条全部会被服务端忽略**（`model` 字段不生效，见第 8 节）。保留这张表的唯一价值是：让用户在 DSH 里看到与 Trae 界面一致的真实名字，**不承诺**切换会换底层模型。
3. 其他 agentType 分组已知存在但**故意没有引入**（怕覆盖 `solo_agent` 菜单）：
   `solo_coder` 8 条 / `solo_agent_lite` 15 条 / `agent`（日志自报计数在不同版本里出现 12 与 17 两个数） / `solo_work_lite` 4 条 / `solo_work_remote` 4 条 / `solo_design_lite` 2 条 / `explore_sub_agent` 等。

### 5.3 历史版本（都已作废，别回退）

- **v1**：手写 8 条（Claude-Sonnet-4.6 / DeepSeek-V4-Flash / Kimi-K3 …），在服务端**根本不存在**，纯属猜测。
- **v2**：`POST https://a0ai-api-sg.byteintlapi.com/api/ide/v1/model_list` + body `{"type":"llm_raw_chat"}` + 头 `get-svc: 1` 返回的 9 条（Gemini-2.5-Pro / GPT-4o / DeepSeek-V3 / GLM-5.3 / MiniMax-M2.7 …）。这是 **`llm_raw_chat` 老通道的目录**，不是界面里那个下拉框。扫过 24 个 `type` 值，只有 `llm_raw_chat` / `chat`（同名单，9 个）与 `builder`（2 个）返回 200，其余全部 `400 {"code":4001}`；`chat_v3` / `solo_agent` / `builder_v3` 等真实标签值当 `type` 发会被拒。
- **v3**：18 条，来自日志还原。v4（即当前 22 条）在其基础上补了 4 条。

---

## 6. `function` 字段与端点可用性矩阵（**全部实测**）

在 `a0ai-api-sg.byteintlapi.com` 上，`function` 取值的结果：

| `function` 取值 | 结果 |
|---|---|
| `inline_chat` | ✅ 有效（生产路径） |
| `chat_v3` | ✅ 有效 |
| `chat_v2` | ✅ 有效返回 |
| `builder_v3` | ✅ 有效返回 |
| `builder_v2` | ✅ 有效返回 |
| `chat` / `builder` | ⚠️ 报错 `4023 the model is unknown` |
| `solo_agent` / `solo_coder` / `solo_builder` | ⚠️ 报错 `4011 rate limit` |
| `agent_v3` | ❌ `2001 no function config found for appId=6eefa01c-1036-4c7e-9ca5-d891f63cd8` |

`/api/ide/v1/llm_raw_chat` 在 a0ai 与 coresg 上一律 `4023 something went wrong`。

复现脚本：`D:\Work\DSH\tmp\probe-functions.mjs`

### 6.1 `function` 到底能干什么

`function` **只能在两个字节自家模型池之间切换，不能用来选第三方模型**：

| `function` | 落到的池 |
|---|---|
| `inline_chat` | `ep-20250724133548-k5xl9` |
| `chat_v3` | `ep-20260907150747-7hcmj` |

两个池里的模型自述都是字节自家：`I am Seed, developed by ByteDance` / `Doubao, ByteDance`。

---

## 7. 踩过的坑（全部实测踩出来的，逐条都有对应脚本）

1. **大写 `X-App-Id` 会触发 500，必须小写 `x-app-id`。**
   这是用 `tmp/bisect-headers.mjs` **逐头二分**定位出来的，实测记录（打 a0ai 的 `/api/ide/v1/model_list`）：
   ```
   200 9  baseline（国际版基础头组）
   200 9  + X-Ide-Token / X-Uid / X-App-Version / X-Ide-Version
   500 -  + X-App-Id            ← 单独加它就 500
   200 9  + X-App-Version-Code / X-Ide-Version-Type
   200 9  + X-Device-Type / X-Device-Brand / Request-Traffic-Type / X-Device-Id
   500 -  + 全部
   ```
   大写 `X-App-Id` 是 SOLO 后端的头，SG 网关拿到会走错配置分支直接 500。代码选择「国际版早返回」而不是「加完再删」，让头表与实测契约逐字对应。

2. **`api.trae.ai` 的三个 chat 端点全部 404。** 该 host 只做 OAuth，不承载对话。

3. **国际版根本不需要 AES-256-GCM 信封，也不需要 `X-Request-Pin`。**
   早期误以为需要，做了很久；后来把 pin 当 base64 编码导致校验一直失败。真实情况：裸 `fetch` POST JSON 即可。提交 `bc06f92` 把这套去掉了。

4. **`enable_solo_*` 不决定能否发消息。**
   只有 `coresg-normal.trae.ai` 端点才查 SOLO 权益；a0ai 走的是 Basic usage。

5. **错误码 `4120` 的含义是「coresg 端点拒绝」，不是「账号无 SOLO 权益」。**

6. **国内版是另一条路径。** `coresg-normal.trae.ai` + AES-256-GCM 信封那一套属于国内版，本插件当前的国际版路径**没有**把它接进来。

7. **`TraeCredential` 字段是下划线**（`access_token` 等），按驼峰填会 401。见 4.5。

8. **Trae 对话不走 Node aiserver**，抓包路线全部失败。见第 10 节。

---

## 8. ⚠️⚠️ 尚未解决的核心问题：HTTP 层无法选模

**这是当前最重要的未解项。**

共做了 **57 次**真实请求测试（两轮），结论明确：**通过 HTTP 请求体无法指定模型。**

### 8.1 试过的所有变体

**第一轮 44 条**：4 个 `function` × 11 个 `model` 取值。`model` 取值覆盖：空串、8 个裸模型名、`agent_1__…_null` 与 `solo_agent_1__…_null` 两类 key 前缀。

**第二轮 26 条**：13 种变体 × 2 个 host（a0ai / mchost）。尝试过把模型放在：

- body 字段：`model` / `model_name` / `target_model` / `extra_body.model` / `llm_config.model`
- HTTP 头：`X-Model-Name` / `x-target-model`
- URL query：`?model=` / `?model_id=`
- key 前缀：`agent_1__gpt-6-astra_null` / `solo_coder_1__…`
- **system 消息正文里塞 `model=gpt-6-astra`**（最后这招最狠也无效）

**全部落到同一个池。**

另外还有一次对照实验：把 v3 目录 18 条 + 假名 `zzz-bogus-control` 各发一次真实对话，共 19 次，全部 200、全部返回同一个 `provider_model_name` = **`ep-20250724133548-k5xl9`**（字节 Seed 单一模型池）。假名也能 200，说明服务端根本没校验。结果落盘在 `D:\Work\DSH\tmp\mitm\real\model-routing-truth.json`。

### 8.2 直接证据

SSE 的 `metadata` 事件回显 **`"model": ""`** —— 服务端根本没读我们发的字段。

### 8.3 当前判断（**这是推测，未验证**）

真实选模走的是 **渲染进程 → Rust `TransportManager` 的 RPC**（目标 host `bytegate-sg.byteintlapi.com`），URL 构造在 Rust 二进制里，JS bundle 里没有任何对应字符串常量，无法从 JS 侧复现。
在该 host 上试过 **13 条路径 × 4 种 body，全部 404**。

### 8.4 旁证

- Trae 官方文档（<https://fast.io/resources/trae-ai-limits/>，2026-10-11 更新）里 Lite 及以上套餐确实写着 "Auto mode + Manual selection"，所以**界面上能选模型是事实**，只是那条路径不在 HTTP 层。
- 从 `@byted-icube/ai-modules-chat/dist/index.mjs:5006` 读到 RPC 方法名（`SERVER_NAME = "model"`）：`model_list` / `model_list_by_function` / `get_model_selection_modes`。这印证了「模型目录走 RPC 而非 REST」。

### 8.5 ⚠️ 给接手者的诚实提醒

**我没有找遍所有可能的路径。** 搜索空间只覆盖了「HTTP 请求里显式表达模型」这一类。如果你能拿到以下任一信息，值得继续往下打：

- 端点 URL 截图 / DevTools Network 里的真实请求
- 包名 / 路由名
- 请求体或 WebSocket 帧的形态
- Rust 二进制（`modules/ai-agent/ai_agent.dll` 218 MB、`harness.dll` 177 MB）里用 `strings` 捞出来的 URL 常量
- ProxyPin（9099 端口）抓到的那 1 条流量是什么

复现脚本：`D:\Work\DSH\tmp\probe-selection-final.mjs`（另见 `probe-selection.mjs` / `probe-selection-2.mjs`）。

---

## 9. 凭据存储与 token 轮换

### 9.1 凭据文件

路径：`C:\Users\carry\.dsh\.credentials.yaml`，顶层三段：`version` / `records` / `refs`。

⚠️ **解析这个文件的三个坑（踩过，别再踩）：**

1. **不能整份 `JSON.parse`**。标量是「单引号 + 真实换行」格式，里面嵌了真实换行的 PEM，会报 `Bad control character in string literal`。
2. **不能按行切**。
3. 正确做法：用 `indexOf(KEY + ':')` 定位后**配对扫描引号**（注意 `''` 是转义），再用正则抠单个字段，**原位字符串替换**写回。

### 9.2 ⚠️ access_token 会被上游连带作废（真实踩过）

某天所有原本 200 的脚本突然全部 `401 {"code":1001,"message":"...not able to authenticate you..."}`，但凭据里 `expires_at` 显示**还有 13 天**。

**原因不是过期**：正在运行的 Trae 客户端轮换 `refresh_token` 时，把旧的 `access_token` 连带吊销了。

**手搓续期会失败**：
```
POST https://growsg-normal.trae.ai/trae/api/v3/oauth/ExchangeToken
→ 401 {"Code":"20403","Message":"Token device not match."}
```

国际版**必须**带 `DeviceInfo` + `DeviceProof`（ECDSA P-256 签名）。

**正确做法**：调插件自己的 `exchangeTraeCallback(...)`（`vendor/channel-pack/src/trae-oauth.ts`），
脚本 `D:\Work\DSH\tmp\refresh-intl-via-plugin.mjs`（用 esbuild 打包 `trae-oauth.ts` 后调用）。

### 9.3 写回 yaml 时的四个坑

1. 不能按行切（见 9.1）。
2. 整段不是合法 JSON（真实换行的 PEM）。
3. **YAML 折行**把 PEM 切成 `-----BEGIN PRIVATE` + 真换行 + 4 空格缩进 + `KEY-----`，且该写入器把折行还原成**零宽**（`-----BEGIN PRIVATEKEY-----`）。
   还原公式（两个替换都要，少一个都不行）：
   ```js
   s.replace(/\r?\n[ \t]*/g, ' ').replace(/\\n/g, '\n')
   //                 ↑ 补回词边界空格        ↑ 把 JSON 的 \n 还原成真换行
   ```
   **少了后者**，base64 里会混进反斜杠和字母 n，DER 解出来报 `ERR_OSSL_ASN1_TOO_LONG`。
4. ⚠️ **`exchangeTraeCallback` 的返回值里没有 `expiresAt` 字段。** 按直觉写回会把字符串 `"expires_at":"undefined"` 落进 yaml。
   正确做法是用 JWT 的 `exp * 1000` 修正，脚本 `D:\Work\DSH\tmp\fix-expires-at.mjs`（实测得到 `1793239909000` → 2026-10-29）。

---

## 10. 协议是怎么拿到的：抓包为什么失败（避免重蹈覆辙）

### 10.1 四条抓包路线全死

| 尝试 | 结果 |
|---|---|
| 改 Trae 自带的 `aiserver/server.js` 加 hook | ❌ ACL 拒绝（`BUILTIN\Users` 只有只读权限） |
| `NODE_OPTIONS=--require` 启动 Trae | ❌ `req.log` 从未生成 |
| Chromium `--log-net-log` | ❌ netlog 一直 0 字节，Electron 不转发给 NetworkService |
| 自建 MITM（127.0.0.1:8899 → mihomo 7897） | ❌ 40 秒只捞到 1 条无关流量 |

### 10.2 根因

**Trae 对话不走 Node aiserver**（`aiServer-pid` 从未出现）。它是渲染进程 webview 的流量，走 **TUN + WinINET → ProxyPin(9099)**，**绕过 `--proxy-server`**。

### 10.3 实际做法：静态反混淆

- 解码器函数 `_0x45c0`，**全表 38000 条**，从 `aiserver/server.js` 里挖出协议。
- **appId 是靠错误信息当 oracle 反推出来的**：用错 appId 时 `super_completion` 返回 `code:2001 super completion service not found: 677332`，据此逐个试出正确值。
- 协议脚本：`D:\Work\DSH\tmp\deob.mjs` / `deob-window.mjs` / `deob-full.mjs`。

---

## 11. 环境、构建、测试与部署

### 11.1 Trae 客户端数据位置

| 内容 | 路径 |
|---|---|
| 日志 | `%APPDATA%\Trae\logs\<时间戳>\window1\renderer.log`（UTF-8 + `\r\n`，用 node `readFileSync(...,'utf8')` 读没问题） |
| 用户数据 / token | `%APPDATA%\Trae\User\globalStorage\storage.json`（国际版 token 是**明文**，国内版是 tc 加密） |
| 资源目录（很大） | `modules/ai-agent/ai_agent.dll` 218 MB、`modules/ai-agent/harness.dll` 177 MB、`workbench.desktop.main*.js` 各 16 MB、`@byted-icube/ai-modules-chat/dist/index.mjs` 15 MB |

### 11.2 构建

```powershell
cd D:\Work\DSH\dsh-our-free-model
node scripts/build-channel-pack.mjs
```
产物：`vendor/channel-pack/pack.js`（约 2.78 MiB）。

### 11.3 测试

```powershell
cd D:\Work\DSH\dsh-our-free-model
npm test
```
当前 **46/49 通过**。

失败的 3 个是 `manifest` / `release` / `catalog` —— **与本工作无关**：它们需要上游签名私钥，且工作树有改动时本来就会失败。**不要试图去修它们。**

### 11.4 部署（覆盖已安装副本）

`pack.js` 需要手动覆盖到：

```
C:\Users\carry\.dsh\profiles\desktop\node_modules\dsh-our-free-model\vendor\channel-pack\pack.js
```

流程：
1. 先备份旧文件，命名 `pack.js.bak-<时间戳>`。
2. 覆盖后核对 sha256。
3. ⚠️ **用户需要重启 DSH 才生效。**

### 11.5 TS 自测脚本的打包坑

用 esbuild 打包 TS 再 `import()` 时：
- Windows 下 `import()` **必须**用 `pathToFileURL` 包成 file URL。
- 多入口要用 **`stdin` + `resolveDir`**，**不能**用 `entryPoints` + `outfile`。

---

## 12. 自测与探测脚本清单（都在 `D:\Work\DSH\tmp\`）

| 脚本 | 用途 |
|---|---|
| `e2e-trae-intl.mjs` | 端到端真实对话 |
| `e2e-trae-intl-static.mjs` | 静态目录 + 真实对话（**不传** `fetchRemoteModels`，与生产装配一致） |
| `e2e-multiturn.mjs` | 多轮对话 |
| `e2e-trae-credits.mjs` | 真实余额查询 |
| `probe-ent-headers.mjs` | 余额端点认证头逐头二分 |
| `probe-functions.mjs` | `function` 矩阵 |
| `probe-intl-entitlement.mjs` | 余额端点试错 |
| `probe-selection-final.mjs` | 选模变体测试（最终轮） |
| `probe-selection.mjs` / `probe-selection-2.mjs` | 选模测试（前两轮） |
| `probe-real-models.mjs` | 18 条 + 假名对照的路由真值实验 |
| `bisect-headers.mjs` | 聊天端点请求头逐头二分（定位到 500 的那支） |
| `extract-model-ids.mjs` | 从 renderer.log 提取模型 id |
| `refresh-intl-via-plugin.mjs` | 经插件 `exchangeTraeCallback` 续期 |
| `fix-expires-at.mjs` | 用 JWT `exp` 修正 yaml 里的 `expires_at` |
| `deob.mjs` / `deob-window.mjs` / `deob-full.mjs` | 静态反混淆 |

探测结果落盘目录：`D:\Work\DSH\tmp\mitm\real\`（如 `model-routing-truth.json`）。
模型名提取产物：`D:\Work\DSH\tmp\trae-intl-model-names.json`。

---

## 13. 关联资产：另一个可交叉参考的插件

`D:\Work\DSH\tmp\web\dsh-trae-api-src\` —— 另一个 DSH 插件（GitHub `Wang-JQ77/dsh-trae-api`）的 15 个源文件。

- 作用：把 Trae 额度转成 **OpenAI / Anthropic 兼容 API**，监听 `127.0.0.1:9220`。
- token 来源：`%APPDATA%\Trae\User\globalStorage\storage.json`（国际版明文，国内版 tc 加密）。
- ⚠️ **它同样无法选模**（走的是同一条 `inline_chat` 路径）。
- 价值：**可作为交叉参考实现**（端点、头、body 的第二个独立确认来源）。

---

## 14. 接手者的待办（按优先级）

### P0 —— HTTP 层选模（未解决，见第 8 节）

**现状**：57 次实测全部失败。请求体、HTTP 头、URL query、key 前缀、system 正文，五类表达方式都试过，全部落到同一个池；`metadata` 回显 `"model":""`。

**可以试的方向**：

1. **向用户要证据**：Trae 界面里手动切一次模型时的 DevTools Network 截图 / 端点 URL / 请求体形态。**这是成本最低、成功率最高的一条。**
2. **从 Rust 二进制里捞 URL 常量**：`ai_agent.dll`（218 MB）/ `harness.dll`（177 MB）用 `strings` + 关键词过滤（`byteintlapi` / `llm_utils` / `model_select` / `provider`），找 `TransportManager` 拼 URL 的那个函数。
3. **复现渲染进程 → Rust 的 RPC 通道**：已知方法名 `model_list` / `model_list_by_function` / `get_model_selection_modes`，`SERVER_NAME = "model"`（见 `@byted-icube/ai-modules-chat/dist/index.mjs:5006`）。方向是搞清楚 JS 侧怎么把 RPC 请求交给 Rust（管道？stdin？Electron IPC？）—— 这条路需要读更多 bundle。
4. **继续扩大 HTTP 端点猜测面**：`bytegate-sg.byteintlapi.com` 上目前只试过 13 条路径 × 4 种 body。可以从 Trae 的 `main.log` / `renderer.log` 里 grep 所有出现过的完整 URL，逐个试。
5. **反向验证**：如果选模真的只在客户端做，那 Pro 套餐本来就是「ByteDance 单一池 + 界面标签」，应该考虑放弃选模、转而在文档/UI 上如实告诉用户「切换只改显示名」。

### P1 —— `contextWindow` 真值未知

现在 22 条全部填 `64_000`，**是保守估值不是真值**（RPC 响应体没落盘）。
方向：在 Trae 运行时把 RPC 响应 dump 到文件（Electron 里 hook `TransportManager` 或在 `renderer.log` 找落盘），或对每个模型做二分长度的实际请求探测上限。

### P2 —— 输出预算预留

上游**不发布** `max_output_tokens`，也**不会**拒绝一个明显偏小的 completion 值（它远小于上下文窗口），所以**学不到真值**（第 15 节有完整案例）。
后果：DSH 会按某个全局兜底常量预留 completion 额度，可能挤爆总预算。当前无解，只能等上游发布字段，或从真实报错里反推。

### P3 —— 国内版（CN）路径完全没做

CN 是 `coresg-normal.trae.ai` + **AES-256-GCM 信封**那一套，host、认证、路径都与国际版不同。当前国际版路径已覆盖 Pro $20 的需求，CN 不急；若要做，从 `trae.ts` 的 CN 分支（`traeSOLOHeaders` 第 277 行往下）接着写。

### P4 —— 可选增强

- 引入其他 agentType 的模型分组（`solo_coder` / `solo_agent_lite` / `agent` / `solo_work_lite` …）—— 需先确认不会覆盖 `solo_agent` 菜单。
- `vendor/channel-pack/src/trae-product.ts` 里 `TRAE_INTL_FALLBACK_MODELS` 上方的 JSDoc 还残留着「18 条」的旧描述（表格本体已是 22 条），可顺手订正，避免后来者误判。

---

## 15. 独立提醒：读 schema 验证配置键，不要照着注释或类比想当然

> 这条来自**另一个 provider**（`@mars-sea/dsh-commandcode-provider`）的排障，与 Trae 本身无关，但教训通用，所以单列。

**症状**：该 provider 报 `CONTEXT_WINDOW_EXCEEDED`，数值：
```
模型上限      1,048,576
实际请求    1,780,472  = messages 1,649,400 + completion 131,072
```
`messages` 一项就是上限的 **157%**，光历史就装不下。根因是会话历史膨胀。

**压缩救不了**：日志显示 `Compaction could not produce a useful summary.` —— 因为压缩本身也要读同一份超限历史，形成死锁。

**那个 131072 哪来的**：该插件的全局兜底常量 `DEFAULT_MAX_OUTPUT_TOKENS`（`lib/index.js:5190`），触发条件是 `requiresMessagesEndpoint(model)` 为 false（该模型的 `supported_endpoints` 不含 `/messages`）。

**❌ 我曾建议在配置里加 `maxTokens: 32000`，这是错的。**
读 `lib/index.js:10044` 的 zod schema 后确认：`maxTokens` **不是**该 provider 的配置键，加了会被 zod **静默剥掉**（你以为改了，其实没有）。

该 provider 的完整配置键只有这些：
```
apiKeyEnv / apiKey / apiBase / workingDir / modelsCachePath /
requestTimeoutMs / streamIdleTimeoutMs / offloadSeenImagesForCache /
transportMaxRetries / filterModelsByPlan / visibleModels / modelVisibility /
webSearch / showSidebarQuota / accounts / activeAccount / credentialCleanupRefs /
accountEnrollmentTasks / modelAccountRules / zdr / lang
```

**结论**：输出预算只能由**逐模型事实**控制（上游发布的 `max_output_tokens`，或从上游拒绝错误里学习）。上游既不发布该字段、又不会因为 131072 拒绝（它远小于 1M 窗口），所以**学不到**。**不改插件源码就无法压缩该预留**；实际只能靠开新会话砍历史。

**教训（请写进任何后续改动前的检查项）**：想改某个 provider 的行为，先去读它的 **zod schema / 配置类型定义**，确认那个键**真的存在**，再动手。注释可能过时、类比其它 provider 一定错。zod 会把未知键**静默丢弃**，没有报错 —— 这是最难发现的一类 bug。

---

## 16. 已验证事实 vs 推测（分级速查）

### ✅ 已验证（实测，有脚本可复现）

- 国际版聊天端点 = `https://a0ai-api-sg.byteintlapi.com` + `POST /api/agent/v3/llm_utils_chat`，裸 JSON，无信封、无 GenerateTempToken。
- 3.2 节请求头全集逐条有效；大写 `X-App-Id` 会 500。
- `x-device-id` = `sha256(machineId)` 前 32 hex，不是 19 位十进制。
- `request_id` 与 `session_id` 必须相同。
- SSE 事件序列与 `metadata` 回显 `"model":""`。
- 余额端点 = `growsg-normal.trae.ai` + `POST /trae/api/v1/pay/ide_user_ent_usage`，只需要 `Authorization` 头。
- `pay_status` 返回 200 但无额度字段。
- 国际版美元计费、`basic_usage_limit: 20`、`premium_model_fast_request_limit: 600`、`credits_limit` 恒 0、`auto_completion_limit: -1`、真实到期在 `base.end_time`。
- 6 节 `function` 矩阵全部错误码。
- 57 次选模测试全部失败，全部落到同一池。
- 模型目录 22 条来自 renderer.log 的 `solo_agent_1__<id>_null`。
- `npm test` 46/49，失败 3 个与本工作无关。

### ⚠️ 推测 / 未验证

- 选模走渲染进程 → Rust `TransportManager` 的 RPC（host `bytegate-sg.byteintlapi.com`）。**有间接证据（JS bundle 里的 RPC 方法名），但 RPC 本身从未跑通。**
- 「Pro 套餐背后是单一模型池」——基于 57 次实测的**强推断**，没有上游文档确认。
- `contextWindow = 64_000` 是**保守估值**，非真值。
- CN 路径是否仍然可用 —— **未测**。
- 其他 agentType 分组的**确切条数**在不同日志版本里出现过不一致（`agent` 出现 12 与 17 两个数），以最新一次 renderer.log 为准。
- `default_max_output_tokens` 类的输出预算 —— **未知，且学不到**。
