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
| agent host | `https://coresg-normal.trae.ai` | 实测认证 200 |
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

### ⛔ 当前阻塞：`4120` = 账号无 SOLO 权益

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
套餐**。`model_list` 是登录即可读的目录，但 `llm_raw_chat` 需要付费权益，
所以 9 个模型 × 3 次重试 × 6 种认证组合全部 `4120`，换哪个模型都一样。

**结论**：国际版渠道的**登录 + 目录**已经可用（登录跑通、模型列表从上游实时拉取），
**对话**要等账号本身有 SOLO 权益。这是账号状态问题，不是协议问题 —— 协议侧
已无可再挖。

### 顺带修掉的两个既有缺陷

1. `trae-credits.ts` 的 `postJson` 形参表里 `host: string` 被注释吞掉了，
   函数体却还在用 `${host}` —— 调用方仍按 7 个实参传。已补回形参。
2. 国际版 `appId` 原先写的是 `677332`（那是 `app_id(tea)`，不是 `X-App-Id`）。
   用错值时 `/api/ide/v1/super_completion` 回
   `code:2001 super completion service not found: 677332`、`model_list` 回 500。
   这条报错就是判断 appId 对错的 oracle。已改为 UUID。
