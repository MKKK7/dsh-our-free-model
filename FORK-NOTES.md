# Fork Notes — MKKK7/dsh-our-free-model

This fork (`https://github.com/MKKK7/dsh-our-free-model`) tracks
`Ebony-Vinyl/dsh-our-free-model` upstream and adds one feature branch:

- **`feat/trae-international`** — second TRAE account card using the
  `trae.ai` international product (Google sign-in, separate quota
  pool). Same TraeAuth/Adapter/Probe stack as the CN card, but a
  distinct TraeProduct.

## Branches

| branch | tracks | status |
|---|---|---|
| `main` | `upstream/main` | mirror |
| `feat/trae-international` | `upstream/main` | this fork's only feature |

## How to upgrade (rebase onto upstream)

```bash
cd dsh-our-free-model
git fetch upstream
git rebase upstream/main feat/trae-international
# resolve conflicts; the 9 source files and pack.js are the only
# touch points — see "Conflict surface" below.
git push --force-with-lease origin feat/trae-international
```

The commit is a single self-contained change, so a rebase typically
boils down to:

- if upstream touched `pack.js` → rebuild with
  `node scripts/build-channel-pack.mjs` (it requires `esbuild`,
  `jose`, `undici` at runtime — install them ad-hoc; they are NOT
  in the repo's devDependencies by design);
- if upstream touched any of the 8 source files listed below, run
  `npm run typecheck` and `node scripts/test-all.mjs --mode contributor`
  before pushing;
- if upstream touched `client.js` (account cards array), manually
  re-insert the trae_intl card after the trae card.

## Conflict surface (8 source files + 1 bundle + 1 ui + 1 test)

```
vendor/channel-pack/src/trae-product.ts        — TraeProduct.id widened + TRAE_INTL + *PathFor + traeProductById
vendor/channel-pack/src/trae-auth.ts           — path constants → *PathFor functions (3 sites)
vendor/channel-pack/src/trae-credits.ts        — path constants → *PathFor + postJson host fix
vendor/channel-pack/src/trae-oauth.ts          — path constants → *PathFor (2 sites)
vendor/channel-pack/src/trae-adapter.ts        — chat path → traeChatPathFor(this.product)
vendor/channel-pack/src/account-probe.ts       — TRAE_PROVIDER_ID → TRAE_PROVIDER_IDS Set + traeProductById
vendor/channel-pack/src/channel-pack-store.ts  — REF_PREFIX_TO_PROVIDER + TRAEINTL prefix
vendor/channel-pack/src/index.ts               — second TraeAuth instance + second registerTraeLlm + scheduler stop
vendor/channel-pack/src/channel-pack-rpc.ts    — isTraeFamily / requireTraeFamily (5 branches)
vendor/channel-pack/pack.js                    — bundle, rebuilt from above
client.js                                      — account card + CHANNEL_CREDITS
scripts/channel-pack-test.mjs                  — counts: 13 → 14
```

The remote CN/INTL endpoint paths differ at 6 places (ExchangeToken,
EntUsage, userInfo/checkin/chat/models are symmetric in path but
**differ in host**, which is dispatched via the `product` argument, not
hardcoded in any RPC branch). This is by design — see "Why two
products, not one" below.

## DSH upgrade caveat

The user's installed copy at
`C:\Users\carry\.dsh\profiles\desktop\node_modules\dsh-our-free-model`
is a **separate working copy** from this fork. After the user
rewires `~/.dsh/profiles/desktop/package.json` to point at
`github:MKKK7/dsh-our-free-model#feat/trae-international`, DSH's
`pnpm install` will *replace* the installed copy. To roll back:

1. Change `package.json` back to upstream.
2. `pnpm install` (this is destructive — DSH must be closed or the
   install will fight a running process).

A `dsh-our-free-model-old-ebonyvinyl` directory is kept locally as a
byte-for-byte copy of the original installed copy for emergency
fallback.

## Architecture notes (why a second TraeProduct, not a flag on the first)

The CN and INTL products of TRAE share 100% of the protocol
(ExchangeToken OAuth, UG-side checkin/balance, chat adapter, model
list). They differ only in:

| field | TRAE (CN) | TRAE_INTL |
|---|---|---|
| ugHost | `https://api.trae.cn` | `https://growsg-normal.trae.ai` |
| agentHost | `https://api.trae.cn` | `https://trae-api-sg.mchost.guru` |
| oauthHost | `https://api.trae.cn` | `https://growsg-normal.trae.ai` |
| consoleHost | `https://www.trae.cn` | `https://www.trae.ai` |
| clientId | `en1oxy7wnw8j9n` | `ono9krqynydwx5` |
| appId | (CN) | `677332` |
| ideVersion | (older) | `3.5.87` |
| packageType | `stable_cn` | `stable_i18n` |
| pluginVersion | (older) | `2.3.68993` |
| ExchangeToken path | `/cloudide/api/v3/trae/oauth/ExchangeToken` | `/trae/api/v3/oauth/ExchangeToken` |
| EntUsage path | `/trae/api/v2/pay/ide_user_ent_usage` | `/trae/api/v1/pay/ide_user_pay_status` |
| account pool | (CN phone-based) | Google + Apple + GitHub OAuth |

Modelling this as one product with a "region" flag would force every
caller to know about the region. Modelling as two products keeps the
callers host-agnostic — the 8 *PathFor functions plus
`product.ugHost` are the *only* places that need to know.

## Probe-driven endpoints (intl, current best guesses)

The INTL chat endpoint is **not** directly observed (it requires
holding a logged-in Google session in a real TRAE International
install, and packet-capture is out of scope per the user's stated
preference). The first request after login will be allowed to fail
and surface the actual chat URL in the error log; the 6 plausible
candidates (recorded in the upstream discovery) are:

- `https://trae-api-sg.mchost.guru/api/agent/v3/llm_utils_chat`
- `https://api-sg-central.trae.ai/api/agent/v3/llm_utils_chat`
- `https://growsg-normal.trae.ai/api/agent/v3/llm_utils_chat`
- `https://trae-api-sg.mchost.guru/cloudide/api/v3/trae/llm_utils_chat`
- `https://api-sg-central.trae.ai/cloudide/api/v3/trae/llm_utils_chat`
- `https://growsg-normal.trae.ai/cloudide/api/v3/trae/llm_utils_chat`

`traeChatPathFor(TRAE_INTL)` returns the same `/api/agent/v3/llm_utils_chat`
as CN; the only thing that flips is the host (driven by
`product.agentHost`).

If the wrong host is configured, the failure will be a 404 with the
candidates list logged at `error` level in
`~/.dsh/our-free-model/settings.json` trace. A single-line edit
updating `TRAE_INTL.agentHost` in `trae-product.ts`, followed by
`node scripts/build-channel-pack.mjs`, is enough to switch.

## Known unknowns

1. **Chat endpoint host**: see above. Best-effort guess is
   `trae-api-sg.mchost.guru` based on naming pattern
   (`*.mchost.guru` is the family used for IDE chat traffic in
   observed CN logs).
2. **Plugin version divergence**: TRAE International installed copy
   shows `plugin_version 2.3.68993`. Whether the upstream
   `TRAE_INTL_CHANNELS` map (with `2.3.68993` as the only key) is
   the right set is unverified — the channel map is read from a
   server endpoint after login and may evolve.
3. **Google OAuth flow**: TRAE International auth is browser-based
   via `https://www.trae.ai/authorization`. The plugin's existing
   OAuth machinery (trae-oauth.ts) is host-agnostic and only sets
   `product.oauthHost` differently — the OAuth dance itself
   (browser → redirect → code → POST ExchangeToken) is identical.
4. **Quota reporting**: CN uses `ide_user_ent_usage`, INTL uses
   `ide_user_pay_status` (different v1/v2 versions, different
   field names). Field mapping is best-effort and may need
   adjustment after the first successful login.

## Verification commands (run from `D:\Work\DSH\dsh-our-free-model`)

```bash
# typecheck (must pass with no esbuild/jose/undici needed)
npm run typecheck

# full contributor-mode test suite
node scripts/test-all.mjs --mode contributor

# build pack.js (needs ad-hoc install: esbuild, jose, undici)
node scripts/build-channel-pack.mjs

# unit-test the channel pack itself
node scripts/channel-pack-test.mjs
```

## User's installed copy rewiring (manual)

After pushing `feat/trae-international`, the user (in a separate
step) edits:

```
C:\Users\carry\.dsh\profiles\desktop\package.json
```

and replaces the `dsh-our-free-model` entry with
`github:MKKK7/dsh-our-free-model#feat/trae-international`, then runs
`pnpm install` (DSH must be closed) and restarts DSH. The new
"TRAE (国际版)" card appears next to the existing "TRAE" card.
Clicking it opens a browser to `https://www.trae.ai/authorization`
for Google sign-in.

This step is intentionally not automated — `pnpm install` against a
running DSH is a known footgun.

## Trae 国际版协议实测记录（2026-10-14）

抓包全部失败后（aiserver 目录 ACL 拒绝写、`NODE_OPTIONS=--require` 不被 Electron
采纳、Chromium `--log-net-log` 传不进 NetworkService 子进程、自建 MITM 只捞到 1 条
无关请求），改走**静态反混淆**：`D:\Tools\Trae\resources\app\extensions\ai-completion\
resource\aiserver\server.js`（15.5 MB，obfuscator.io 风格，解码器 `_0x45c0`）。
全表解码后协议逐项确定，全部有 deob 偏移可查。

### host / appId

| 项 | 值 | 来源 |
|---|---|---|
| agent host | ~~`https://coresg-normal.trae.ai`~~ → **`https://a0ai-api-sg.byteintlapi.com`** | **2026-10-15 推翻，见下节** |
| `X-App-Id` | `6eefa01c-1036-4c7e-9ca5-d891f63bfcd8` | `product.json` 的 `agent.appId`（与 CN 同值） |
| OAuth/UG host | `https://growsg-normal.trae.ai` | 日志 |
| login portal | `https://www.trae.ai/authorization` | 日志 |

**已排除的猜测**：`trae-api-sg.mchost.guru`（对 `/api/ide/v1/*` 全 404）、
`bytegate-sg.byteintlapi.com`（全 404 `page not found`）、
`api-sg-central.trae.ai` / `icube-normal.trae.ai`（全 404 TLB）。

### 模型目录

```
POST https://coresg-normal.trae.ai/api/ide/v1/model_list
headers: get-svc: 1 + SOLO 头
body:    {"type":"llm_raw_chat"}
→ 200 {"model_configs":[…9 条…]}
```

`type` 必须给，值扫描结果：`llm_raw_chat` / `chat` → 9 条，`builder` → 2 条
（`glm-5.3`、`MiniMax-M2.7`，带 `custom_model_id`/`ak`，需自带 key），
其余（`agent`/`agentic`/`cue`/`solo`/`code_completion`/`''` …）全部 `400 {"code":4001}`。

9 条：`gemini-2.5-pro-preview-03-25`、`gemini_2.5_flash`、`gpt-4.1-2025-04-14`、
`gpt-4o`、`deepseek-V3-0324`、`deepseek-V3`、`deepseek-R1`、`glm-5.3`、`MiniMax-M2.7`。
⚠️ 其中 `deepseek-R1` 在客户端 `tD` 里被**显式过滤掉**（`m.name !== 'deepseek-R1'`），
插件沿用该过滤。

另有 `POST /api/ide/v1/providers` → 27 家 BYOK provider（deepseek / anthropic /
openrouter / volcengine / aliyuncs / bigmodel / siliconflow …，各带 `base_url`
与 `model_detail`），是「自定义模型」的数据源。

### 聊天：信封与认证

`POST /api/ide/v1/llm_raw_chat`，body **只有两个字段**：

```json
{"model_name": "deepseek-V3", "message": "<base64 信封>"}
```

信封算法（`masticateVegetablesToPulp`，deob 偏移 9018804）：

1. `key = 6195f24ca4d430f8a4833de7db8dac37d148a084e7464a351ffa68585c16b955`（hex 硬编码）
2. `requestAt = floor(now/1000)`；`pin = randomBytes(8)`；`key[0..8] ^= pin[0..8]`
3. `aes-256-gcm`，`iv = randomBytes(12)`，**AAD = `String(requestAt)`**
4. `message = base64(iv ‖ ct ‖ authTag)`
5. `X-Request-Pin = pin.toString('hex')`（**hex**，不是 base64）

请求头 = SOLO 头 + `{get-svc: 1, X-Request-Pin, X-Requested-At}`，且
`Authorization` 换成临时 JWT（`POST {ugHost}/cloudide/api/v3/trae/GenerateTempToken`，
body `{IDEVersion}`，只带 `x-cloudide-token`），而 `X-Cloudide-Token` **保持**
OAuth `access_token`。

认证组合实测（6 种）：

| 头 | 结果 |
|---|---|
| 只给 `X-Cloudide-Token: access` | `event: error {"code":4120}` |
| 只给 `Authorization: Cloud-IDE-JWT <jwt>` | `code:1001` |
| `Authorization` 里放 access_token | `4120` |
| 两个头都放 JWT | `1001` |
| **`Authorization: Cloud-IDE-JWT <jwt>` + `X-Cloudide-Token: access`** | **`4120`** |

→ 认证已通过，失败在业务层。

### ⛔ 当时的阻塞：`4120` = 打错了端点（**已作废，见下节**）

> 上一节整段结论作废。「`4120` = 账号无 SOLO 权益」是**误判**：`4120` 只是
> `coresg-normal.trae.ai` 这台 SOLO 网关对 Pro 账号的拒绝，与权益无关。
> Pro 账号走的是完全不同的主机和端点（见下一节）。

`POST growsg-normal.trae.ai/trae/api/v1/pay/ide_user_pay_status` 的响应把话说死了：

```json
{"code":1001,
 "enable_solo_builder":false,"enable_solo_coder":false,
 "enable_solo_lite":false,"enable_solo_web":false,"enable_fission":false,
 "is_support_commercialization":false,
 "user_pay_identity":0,"user_pay_identity_str":"",
 "solo_fission_expire_time":0,"solo_fission_max_usage":0}
```

`user_pay_identity: 0` + 五个 `enable_solo_*` 全 `false` —— 该账号**没有任何 SOLO
套餐**（真账号是 **Pro $20**，权益走另一条基础通道）。

### 顺带修掉的两个既有缺陷

1. `trae-credits.ts` 的 `postJson` 形参表里 `host: string` 被注释吞掉了，
   函数体却还在用 `${host}` —— 调用方仍按 7 个实参传。已补回形参。
2. 国际版 `appId` 原先写的是 `677332`（那是 `app_id(tea)`，不是 `X-App-Id`）。
   用错值时 `/api/ide/v1/super_completion` 回
   `code:2001 super completion service not found: 677332`、`model_list` 回 500。
   这条报错就是判断 appId 对错的 oracle。已改为 UUID。

---

## 国际版重写：回到真实的 `inline_chat` 协议（2026-10-15）

上一节整套结论建立在「`aiserver/server.js` 里的 `llm_raw_chat` 就是 Trae 国际版
对话通道」这个假设上。**假设是错的。** 抓包为什么一直失败，现在有了解释：
`aiserver` 根本不在对话链路上 —— 对话是渲染进程 webview 的流量，走 TUN +
WinINET（系统代理），与 `--proxy-server` 无关。

社区插件 [`Wang-JQ77/dsh-trae-api`](https://github.com/Wang-JQ77/dsh-trae-api)
的 `src/trae-client.js` 才是真实的 Basic-usage 通道。本节所有条目都用本机真实
凭据（uid `7540914673709990928`，Pro $20）实测复核过。

### 三个被推翻的假设

| 假设 | 真相 | 怎么发现的 |
|---|---|---|
| host = `coresg-normal.trae.ai` | **`a0ai-api-sg.byteintlapi.com`** | 7 host × 端点矩阵：`coresg` 对 Pro 账号恒 `4023`/`4120`，`a0ai` 立刻 200 出字 |
| body 是 AES-256-GCM 信封 | **裸 JSON，无信封** | `trae-client.js` 里没有信封；实测裸 POST 直接 200 |
| 要 `GenerateTempToken` 换 JWT | **不需要** | `trae-client.js` 直接用 OAuth `access_token` |

### 真实契约

端点 `POST {agentHost}/api/agent/v3/llm_utils_chat`（host 有备胎
`https://trae-api-sg.mchost.guru`，同区域另一入口，实测对同一请求回相同
`session_id`）：

```jsonc
// 请求头（小写 x-uid / x-app-id 才是 SG 网关认的）
{
  "Authorization": "Cloud-IDE-JWT <oauth access_token>",
  "X-Cloudide-Token": "<同一个 access_token>",
  "x-uid": "<uid>",
  "x-app-id": "6eefa01c-1036-4c7e-9ca5-d891f63bfcd8",
  "x-device-id": "<sha256(machineId) 前 32 hex>",
  "x-machine-id": "<machineId>",
  "x-request-id": "<每次随机 UUID>",
  "x-ide-version": "3.3.67",
  "x-ide-version-code": "20260401",
  "x-device-type": "windows",
  "x-os-version": "Windows 10",
  "Content-Type": "application/json",
  "Accept": "text/event-stream"
}
// 请求体
{
  "messages": [{"role": "user", "content": [{"type": "text", "text": "…"}]}],
  "model": "<任意字符串>",
  "function": "inline_chat",
  "stream": true,
  "request_id": "<uuid>",
  "session_id": "<同一个 uuid>"
}
```

响应 SSE 事件序列：
`progress_notice` → `metadata` → `timing_cost`（含 `provider_model_name`）→
`output`×N（`{response, reasoning_content, tool_calls}`）→
`token_usage` → `done`（`{finish_reason}`）。

### ⚠️ 大写 `X-App-Id` 会让 `model_list` 回 500

`tmp/bisect-headers.mjs` 逐个头叠加实测（基线 200/9 条）：

| 叠加的头 | 结果 |
|---|---|
| `X-Ide-Token` / `X-Uid` / `X-App-Version` / `X-Ide-Version` | 200 |
| **`X-App-Id`（大写，SOLO 遗留）** | **500** |
| `X-App-Version-Code` / `X-Ide-Version-Type` | 200 |
| `X-Device-Type` / `X-Device-Brand` / `Request-Traffic-Type` / `X-Device-Id` | 200 |
| 全部一起 | 500 |

`X-App-Id` 是 SOLO 后端的头，SG 网关拿到它会走错配置分支。因此
`traeSOLOHeaders()` 对 `trae_intl` **整段早返回**，只发上表那组头 ——
而不是「先发 SOLO 头再删几个」，免得以后又长回来。

### ⚠️ `function` 只有一个合法值

18 个候选逐个试，只有 `inline_chat` 通过；其余全部
`2001 no function config found for appId=…, function=<f>`；
`chat` / `builder` 回 `4023 the model is unknown`。
CN 那 15 个 `solo_*` / `*_v3` 是 SOLO 权益专用，Pro 账号一律 2001。

### ⚠️ `model` 字段被服务端完全忽略

18 个别名（含 `zzz-nonexistent-model` 与空串 `model: ""`）全部 200 且
`provider_model_name` 恒为 **`ep-20250724133548-k5xl9`** —— 字节 Seed 单一模型池。
附加的 7 种选模参数（`model_id` / `selected_model` / `model_choice` / `model_list`
/ `target_model` / `llm_config` …）全部无效。自报身份：`glm-5.2` 与
`DeepSeek-V4-Pro` 都自称 Seed，`zzz-bogus` 自称 Doubao。

模型下拉里那 8-9 条是**标签**，不是不同模型。contextWindow 之类元数据仍照抄
`model_list` 的声明。

### ✅ 多轮上下文是真的

同一次请求内带多轮 `messages`，模型能引用前文（「记住 7421」→ 答「7421」；
「记住 9137」→ 下一轮答「9137」）。DSH 每轮重放完整历史的模型是对的。

### 端到端自测

`D:\Work\DSH\tmp\e2e-trae-intl.mjs` —— esbuild 把**真实生产代码**
（`trae-adapter.ts` / `trae.ts` / `trae-product.ts`）打成一个 ESM shim，
然后跑 `TraeAdapter.stream()` 完整路径（resolveModel → prepareIntlRequest
→ send → SSE 解析 → StreamChunk）：

```
model_list → 200 …/api/ide/v1/model_list
远端目录 9 条：gemini-2.5-pro-preview-03-25(30000), …, MiniMax-M2.7(112000)
适配器目录返回 8 个模型：…（glm-5.3 被 isTraeModelCallable 正确滤掉：它带
  client_connect/custom_model_id/ak，是要自带 key 的 BYOK 项）

=== 真实对话：model=gemini-2.5-pro-preview-03-25 ===
[chunk] {"type":"block-start","index":0,"blockType":"text"}
[chunk] {"type":"text-delta","index":0,"text":"2"}
[chunk] {"type":"usage","usage":{"inputTokens":59,"outputTokens":1}}
[chunk] {"type":"block-end",…}   {"type":"finish","reason":{"kind":"stop"}}
text  = "2"      ✅
```

> 这份输出是**改目录之前**的（脚本仍带 `fetchRemoteModels`，且那是测试夹具不是
> 生产装配）。生产路径的目录见下文「模型目录」一节 —— 现在是 18 条，
> `tmp\e2e-trae-intl-static.mjs` 才是对应的那份自测。

自测抓出的两个真 bug（esbuild 不做类型检查，`npm test` 也抓不到）：

1. `trae.ts` 用了 `randomUUID()` 但没加进 `import { … } from 'node:crypto'`
   → 运行期 `ReferenceError`，**聊天完全不可用**。
2. `traeSOLOHeaders` 给 INTL 发大写 `X-App-Id` → `model_list` 500。

跑法（必须先 `cd` 到仓库根，否则 external 的 `@deepseek-ai/*` 解析不到）：

```powershell
node D:\Work\DSH\tmp\e2e-trae-intl.mjs                   # 单轮 + 多轮
$env:DUMP='1'; node D:\Work\DSH\tmp\e2e-trae-intl.mjs   # 打印每个 StreamChunk
node D:\Work\DSH\tmp\bisect-headers.mjs                  # 头叠加矩阵
node D:\Work\DSH\tmp\e2e-multiturn.mjs                   # 多轮上下文 + 模型身份
```

### 余额

a0ai 上 12 个余额/配额候选路径全 404 —— 国际版的额度只能从
`growsg-normal.trae.ai/trae/api/v1/pay/ide_user_ent_usage` 读（返回
`billing_version:3`、`is_dollar_usage_billing:true`、`Pro plan`）。
`trae-credits.ts` 尚未接这个端点，余额显示会走 fallback。

---

## 模型目录：从 9 条老通道换成 18 条真目录（2026-10-15）

用户在 Trae 界面看到「模型更新了一批，Seed 排在第一个」，但插件里下拉出来的
还是 `Gemini-2.5-Pro / GPT-4o / DeepSeek-V3 / GLM-5.3` 那 9 条。原因有二，
都查清了。

### 真目录不在 REST 层，在渲染进程的 Rust RPC 里

`POST /api/ide/v1/model_list {"type":"llm_raw_chat"}` 在 a0ai / trae-api-sg /
coresg 三个 host 上都返回**同一份 9 条**。扫了 24 个 `type` 值，只有
`llm_raw_chat` 与 `chat` 给 200（同一名单），`builder` 给 2 条 BYOK 项，其余全
`4001`。把 `chat_v3` / `solo_agent` / `code_reviewer` / `refactor` 等当 `type`
再打一遍 → 全 400：**它们是 label 名，不是 `model_list` 的 type**。

客户端日志给出了真答案（`%APPDATA%\Trae\logs\<ts>\window1\renderer.log`）：

```
[TransportManager] executeRequest, model model_list, 7ce385b7-…, cost: 0
[TransportManager] executeRequest, model model_list_by_function, 1769d8f3-…
[TransportManager] executeRequest, model get_model_selection_modes, 903d0848-…
[ai-chat/v2][AiChatV2SelectionFlow][core][model-store] model list refreshed
  {"labelCount":7,"modelCountByLabel":{"agent":17,"solo_agent":15,"refactor":6,
   "code_reviewer":5,"code_review_summary":3,"solo_coder":1,"solo_builder":1}}
"legacyModelKey":"1_-_minimax-m2.7"
```

RPC 方法名可从 `@byted-icube\ai-modules-chat\dist\index.mjs:5006` 直接读到
（`SERVER_NAME = "model"`，METHODS 含 `model_list` / `model_list_by_function` /
`get_model_selection_modes` …）。**但 URL 复现不了**：传输层是 Rust 实现的
（bundle 里只有 `[ai-chat/v2][rust] invoke cost=… ${service}.${method}` 这行日志，
没有任何 URL 字符串常量）。在 `bytegate-sg.byteintlapi.com` 上试了 13 条路径 ×
4 种 body，全部 404。

于是目录只能从日志里的 `model-select` 事件逐条还原 —— `tmp\extract-models3.mjs`
按行同时抓 `model_name` / `model_display_name` / `modelName` / `displayName` 再
配对（**两个重叠正则会把匹配互相吃掉**，只抓到 4 条），落盘
`tmp\trae-intl-model-names.json`，得 18 条：

| id | 显示名 |
|---|---|
| `Dola-Seed-2.0-Code` | Seed-2.1-Turbo |
| `gpt-6-luna` | GPT-6-Luna |
| `gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna` | GPT-5.6-Sol / Terra / Luna |
| `gpt-5.5` / `gpt-5.4` / `gpt-5.2` | GPT-5.5 / 5.4 / 5.2 |
| `kimi-k3` / `kimi-k2.7-code` / `kimi-k2.5` | Kimi-K3 / K2.7-Code / K2.5 |
| `gemini-3.1-pro` | Gemini-3.1-Pro-Preview |
| `gemini-3-flash-solo` | Gemini-3-Flash-Preview |
| `deepseek-v4.1-flash` | DeepSeek-V4.1-Flash |
| `deepseek-v4-pro-0813` | DeepSeek-V4-Pro |
| `deepseek-v4-flash-0731` | DeepSeek-V4-Flash |
| `glm-5.2` | GLM-5.2 |
| `minimax-m2.7` | MiniMax-M2.7 |

`Dola-Seed-2.0-Code` 就是用户说的「seed 排第一个」。日志只记名字，RPC 响应体
没落盘，所以 **`contextWindow` 统一填 64_000**（保守估计值，不是上游真值）。

### 让静态目录真的生效

`index.ts:912` 原来传了 `fetchRemoteModels: () => traeIntl.fetchModels(pool)`，
会让那 9 条老通道目录**盖掉**静态表。已删掉，改为一段注释 —— 这正是 gemini
通道「模型表是静态的，故这里不传 `fetchRemoteModels`」的既有约定
（`index.ts:1365`）。没有为此新增产品开关：`index.ts` 只有这一处调
`traeIntl.fetchModels`，删掉 option 即让 `ensureRemoteModels` 提前返回，
`remoteModels` 恒 `undefined`，目录自然落到 `fallbackModels`。

代价：`remoteMeta` 拿不到，逐模型的 `multimodal` / `maxOutputTokens` 判定退回
保守默认。由于国际版选模根本不生效（见上一节），这个代价可接受。

### 静态装配路径的自测

`tmp\e2e-trae-intl-static.mjs`（**不传** `fetchRemoteModels`，与生产装配一致）：

```
目录 18 条：
   Dola-Seed-2.0-Code       Seed-2.1-Turbo
   gpt-6-luna               GPT-6-Luna
   …
   glm-5.2                  GLM-5.2
   minimax-m2.7             MiniMax-M2.7

=== 真实对话：model=Dola-Seed-2.0-Code ===
2
text="2" usage={"inputTokens":59,"outputTokens":1}
✅ 静态目录 + 真实对话成功
```

注意打印里 `ctx= ?` 不是 bug：`listModels()` 返回的是归一化模型，`contextWindow`
挂在 `resolveModel()` 的 `context` 字段里（`trae-adapter.ts:889`）。

## 余额修复：国际版美元计费此前恒为 null（2026-10-15）

用户报「余额不显示」。查下来是**三个独立缺陷叠在一起**，每一个都足以让
`fetchTraeCreditBalance` 返回 `null`。

### 缺陷 1：端点指错（`trae-product.ts` `traeEntUsagePathFor`）

国际版指向 `/trae/api/v1/pay/ide_user_pay_status`。该端点**确实 200**，但响应里
只有 `enable_solo_*` / `user_pay_identity` / `trial_status`，**没有任何额度字段**。
真正带 `user_entitlement_pack_list` 的是同前缀下的 `ide_user_ent_usage`（两个都 200，
启动日志里只出现过前者，误导了早前的实现）。已改指 `ent_usage`。

### 缺陷 2：认证头形态错（`trae.ts` `traeCheckinHeaders` 的国际版分支）

国际版分支发的是小写 `x-cloudide-token` 且**完全没有 `Authorization`**。
逐头实测（`tmp\probe-ent-headers.mjs`）：

| 头集合 | 结果 |
|---|---|
| 全量（含 `Authorization: Cloud-IDE-JWT <token>`） | 200 带额度 |
| 去掉 `X-Cloudide-Token` | 200 带额度（可省） |
| **去掉 `Authorization`** | **401 `{"code":1001}`** |
| 只留小写 `x-cloudide-token` + `x-uid` | **401** |
| 插件改前的整套 `stable_i18n` 头 | **401** |

即：**唯一必需的是 `Authorization: Cloud-IDE-JWT <access_token>`**。
`X-Cloudide-Token` 冗余无害，小写 `x-cloudide-token` 单独用无效。已补 `Authorization`
并保留原头，同时把那句「真身用小写 x-cloudide-token」的注释改成实测结论。

### 缺陷 3：额度不在 `credits_limit` 上（`trae-credits.ts`）

国际版是**美元计费**（`is_dollar_usage_billing: true`，`billing_version: 3`），
而原判据是 `if (creditsLimit <= 0) continue` —— 国际版 `credits_limit` **恒为 0**，
于是每个包都被滤掉，`packages` 恒空。

字段对照（Pro $20 账号实测）：

| 语义 | 国内版（积分） | 国际版（美元） |
|---|---|---|
| 套餐额度 | `quota.credits_limit` | `quota.basic_usage_limit`（20 USD/月） |
| 已用 | `usage.credits_amount` | `usage.basic_usage_amount` |
| 赠送 | —— | `quota.bonus_usage_limit` / `usage.bonus_usage_amount` |
| 快速请求数 | —— | `quota.premium_model_fast_request_limit`（600 次） |

改动：按 `is_dollar_usage_billing` 分流；美元形态下基础额度 / 赠送额度各占一个包，
「快速请求次数」单列一个 `unit: '次'` 的包且**不并入 `total`**（并进去会让美元余额虚高）。
另外条目级 `expire_time` 在国际版**恒为 0**，到期时间只能取 `base.end_time`
（Pro 实测 1793583752 = 2026-10-31），已加兜底 —— 不加就永远显示「永久」。

### 自测（`tmp\e2e-trae-credits.mjs`，真实凭据打真实端点）

```json
{
  "total": 19.97892,
  "packages": [
    { "name": "Pro plan · 基础额度", "unit": "USD",
      "remaining": 19.97892, "total": 20, "used": 0.02108,
      "deductionEndTime": 1793583752000 },
    { "name": "Pro plan · 快速请求次数", "unit": "次",
      "remaining": 600, "total": 600, "used": 0 }
  ],
  "expiredTotal": 0
}
```

> ⚠️ `TraeCredential` 的字段名是**下划线**（`access_token` / `refresh_token` /
> `machine_id` / `device_id`），不是驼峰。测试脚本一开始按驼峰写，表现为 401
> —— 排查这个 401 花了比写功能本身更长的时间。

## access_token 会被上游作废（不是过期）

某天所有原本 200 的脚本突然全 `401 {"code":1001,"message":"...not able to
authenticate you..."}`，而 `expires_at` 显示还有 13 天。原因不是过期，是**正在运行的
Trae 客户端轮换 refresh_token 时把旧的 access_token 连带吊销了**。

手搓续期（只带 `ClientID` / `RefreshToken`）会失败：

```
POST https://growsg-normal.trae.ai/trae/api/v3/oauth/ExchangeToken
→ 401 {"Code":"20403","Message":"Token device not match."}
```

国际版**必须带 `DeviceInfo` + `DeviceProof`**（ECDSA P-256 签名），所以正确做法是
直接调插件自己的 `exchangeTraeCallback(...)`（`tmp\refresh-intl-via-plugin.mjs`
用 esbuild 打包 `trae-oauth.ts` 调用）。写回 yaml 时踩到的三个坑：

1. 整份 `.credentials.yaml` 结构上是「单引号标量 + 真实换行」，**不能按行切**，
   要用 `indexOf(KEY + ':')` 定位后配对扫描引号（`''` 是转义）。
2. 标量里的 JSON 含**真实换行**（PEM），整段**不是合法 JSON** ——
   `JSON.parse` 报 `Bad control character in string literal`。只能用正则抠单个字段、
   原位字符串替换写回。
3. YAML 折行把 PEM 切成 `-----BEGIN PRIVATE` + 真换行 + 4 空格缩进 + `KEY-----`，
   且该写入器把折行还原成**零宽**（`-----BEGIN PRIVATEKEY-----`）。还原公式：
   `s.replace(/\r?\n[ \t]*/g,' ').replace(/\\n/g,'\n')` —— 前者补回词边界空格，
   后者把 JSON 的 `\n` 还原成真换行；少了后者，base64 里混进反斜杠和字母 n，
   DER 解出来报 `ERR_OSSL_ASN1_TOO_LONG`。

> ⚠️ `exchangeTraeCallback` 的返回里**没有** `expiresAt` 字段。按直觉写回会把
> `"expires_at":"undefined"` 落进 yaml。已用 JWT 的 `exp * 1000` 修正
> （`tmp\fix-expires-at.mjs`，实测 1793239909000 = 2026-10-29）。

## 选模实测：国际版 HTTP 层无法选模（决定性结论，11×4 组合）

`tmp\probe-selection.mjs`（44 条，落盘 `tmp\mitm\real\selection-matrix.json`）：

| function | `provider_model_name` | 模型自述 |
|---|---|---|
| `inline_chat` | `ep-20250724133548-k5xl9` | 恒为 Seed / ByteDance |
| `chat_v3` | `ep-20260907150747-7hcmj` | 恒为 Seed / Doubao |
| `builder_v3` | `ep-20260907150747-7hcmj` | 同上 |
| `agent_v3` | — | `2001 no function config found` |

11 个 `model` 取值（空串 / 8 个裸模型名 / `agent_1__…_null` / `solo_agent_1__…_null`
两类 key）在每个 function 下**全部落到同一个池**。SSE 的 `metadata` 事件回显
`"model":""` —— 服务端压根没从我们发的字段里读到模型。

即 `function` 只在两个池之间切换、`model` 完全被忽略，而两个池都是字节自家模型。
真实选模走渲染进程 → Rust TransportManager 的 RPC（URL 构造在 Rust 二进制里），
HTTP 层复现不了。**这是上游行为，不是适配器的 bug。**

官方套餐表（[fast.io](https://fast.io/resources/trae-ai-limits/)，2026-10-11 更新）
里 Lite 及以上确实是 "Auto mode + Manual selection"，所以界面里能切是事实 ——
只是那条路径不在我们能碰的 HTTP 层。


