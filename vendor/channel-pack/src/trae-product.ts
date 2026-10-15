/**
 * TRAE（字节跳动 TRAE IDE）产品配置。
 *
 * ## 数据来源
 *
 * 基于对 `E:\Workplace\APP\Golang\trae2api` 的逆向分析（2026-08），
 * 以及上游项目 `Sliverkiss/traework2api` 的实测结果。
 *
 * - API 端点：`trae2api/internal/upstream/constants.go`（实测可用的 SOLO 免费通道）；
 * - 客户端常量：同一文件，版本号 `0.1.52` / `20260811` 为实测可获取 glm-5.3 的最低版本；
 * - 兜底模型表：`trae2api/internal/server/handler.go:247-280` 的 staticModels；
 * - 登录 URL 格式：`trae2api/internal/server/login.go` 的 `BuildLoginURL`。
 *
 * ## 为什么是独立接口而非复用 BuddyProduct/LobsteraiProduct
 *
 * TRAE 与二者都不同源：
 * - 与 BuddyProduct 差异：认证用 ExchangeToken（轮换 refreshToken）而非 external-link 轮询；
 *   请求头用 `Cloud-IDE-JWT` 而非 `Bearer`；chat 端点需要 payload 格式转换；
 *   SSE 格式自定（非 OpenAI 标准），需独立解析。
 * - 与 LobsteraiProduct 差异：chat 端点使用 POST + JSON body + 自定义 SSE；
 *   认证协议不同（OAuth code + ExchangeToken，non-localhost 可回调）；
 *   凭据中需持久化 machine_id/device_id 等设备指纹。
 *
 * 因此这里定义**平行**的 `TraeProduct`：共用的是架构模式（产品差异收敛到单一真相源），
 * 不是那个类型。
 */

/**
 * 兜底模型目录中的一个条目（对齐 Go 端 staticModels 格式）。
 *
 * 数据来源：`handler.go:247-280`（2026-08 实测快照）。
 * 远端 `batch_get_detail_param` 拉取失败时用此表回退。
 *
 * ⚠️ **数值是估值**（采信实测主流值 `contextWindow=200000`），远端可用时
 * **完全采信远端**的 `context_window_tokens` 与 `max_tokens`。旧的 `131072` /
 * `maxOutputTokens: 128000` 是 2026-08 的估值，已被实测推翻（见 `AGENTS.md`）。
 */
export interface TraeFallbackModel {
  id: string
  name: string
  contextWindow: number
  /** 已知的上游内部/隐藏条目（远端不可用时也不该出现在目录里）。 */
  isHidden?: boolean
}

/**
 * TRAE 产品配置。
 *
 * 与 `LobsteraiProduct` / `BuddyProduct` 平行，字段全部为 TRAE 实际需要的。
 */
export interface TraeProduct {
  /** provider 标识：注册到 `ctx.llm` 的路由名，也是账号列表的 provider 字段值。 */
  id: 'trae' | 'trae_intl'
  /** 设置页 / 模型选择器展示名。 */
  displayName: string
  /** 上游 API 基址（Agent 服务：对话 + 模型列表）。 */
  agentHost: string
  /**
   * Agent 服务的**备用基址**，按顺序在主基址不可用时回退。
   *
   * 国际版实测 `a0ai-api-sg.byteintlapi.com` 与 `trae-api-sg.mchost.guru`
   * 对同一 `function: inline_chat` 请求都回 200，且 `session_id` 一致 ——
   * 说明是同一后端的两个入口，不是两个不同服务。CN 无备用（单入口）。
   */
  agentHostFallbacks?: readonly string[]
  /** 签到/积分/Ug 基址。 */
  ugHost: string
  /** OAuth/认证基址（ExchangeToken / GetUserInfo）。 */
  oauthHost: string
  /** 登录门户基址。 */
  consoleHost: string
  /** 客户端 ID（OAuth2 的 client_id）。 */
  clientId: string
  /** App ID（请求头 X-App-Id）。 */
  appId: string
  /**
   * IDE 版本号（控制模型可用性：0.1.52 才能用 glm-5.3）。
   *
   * 版本号是「模型可用的准入条件」—— 上游按 `X-Ide-Version` / `X-App-Version-Code`
   * 决定哪些模型可以返回，版本过低时 glm-5.3 等新模型会报 `4001 param is invalid`。
   */
  ideVersion: string
  /** IDE 版本号代码（日期式，如 `20260811`）。 */
  ideVersionCode: string
  /** 设备品牌（请求头 X-Device-Brand）。 */
  deviceBrand: string
  /** 操作系统版本（请求头 X-OS-Version）。 */
  osVersion: string
  /**
   * **默认**对话通道（`function`），模型未标明所属通道时使用。
   *
   * ⚠️ 它不是「唯一的通道」——各通道模型集不同，真正的通道归属由远端目录
   * 的每条 `function` 决定（见 {@link channels}）。
   */
  function: string
  /**
   * **可调用通道白名单**，**顺序即优先级**。
   *
   * 真实 CN IDE 用 `batch_get_detail_param` 一次查 22 个 function，每个
   * function 各自一套模型目录；同一条目在不同通道的可用性（`is_custom_model`
   * / `is_invisible_to_user` / `config_switch`）**可以不同**，而且
   * **模型只在列出它的通道里可调用**（发错通道 → 流内错误码）。
   *
   * ⚠️ **本表是白名单，不只是排序表**（Issue IKJOZ7）：上游下发的 22 个
   * function 里，**只有一部分**在本插件的推理端点
   * （`/api/agent/v3/llm_utils_chat`）下真正可调用。此前实现让 `parseTraeBatchModelList`
   * 「目录声明了什么通道就照着发什么通道」，于是 38 条目录里有 **19 条（50%）**
   * 带着不可调用的 `function`（`chat` / `builder` / `inline_chat` / `git_ai` …），
   * 用户一选中就稳定失败 —— 而报错文案（`the model is unknown` /
   * `param is invalid`）指向**模型**，极易误判成「这个模型坏了」。
   *
   * 逐通道实测（2026-10-04，真实凭据，每个 function 各发一次最小请求；
   * 脚本 `scripts/probe-trae-channel-callable.mjs`）：
   *
   * | 结果 | function |
   * |---|---|
   * | ✅ 可调用（**本表内容，15 个**） | `solo_agent` / `solo_work_lite` / `solo_agent_remote` / `solo_work_remote` / `solo_agent_lite` / `solo_design_lite` / `solo_design_remote` / `solo_coder` / `chat_v3` / `builder_v3` / `git_ai` / `code_reviewer` / `code_review_summary` / `multimodal` / `system_diagnosis` |
   * | ❌ 稳定被拒 | `chat`（`code=4023 the model is unknown`）/ `builder`（`4001 param is invalid`）/ `inline_chat`（`3003 model service is unavailable`） |
   * | ⚪️ 目录恒空 | `ui_builder_v2` / `solo_builder` / `custom_agent_generation` / `utils` |
   *
   * ⚠️ 与 issue 原文的两处差异（都以上表实测为准，别照抄 issue 的推测）：
   * - **`chat_v3` 是可调用的**，不要与 `chat` 混为一谈（issue 把二者并列怀疑）；
   * - **`solo_coder` 首测超时、复测 4/4 成功** ⇒ 归为可调用；其独有模型
   *   （`minimax-m2.7` 等）因此得以保留。
   *
   * ⚠️ **顺序即优先级**：同一模型被多个白名单通道列出时，取更靠前者
   * （见 `parseTraeBatchModelList` 的规则 2）。`solo_agent` 排首位是对齐官方
   * Auto Mode 选择器；`solo_work_lite` 紧随其后以保既有模型的通道尽量不变。
   * 专用通道（`multimodal` / `git_ai` / `code_reviewer` …）排末尾：只有当某个
   * 模型**不在**任何通用通道里时，才会落到它们上面（如
   * `multimodal_image_kimi-k2.5`）。
   *
   * 可用 `DSH_TRAE_CHANNELS`（逗号分隔）覆盖以试验其它通道 —— ⚠️ 覆盖的是
   * **整张白名单**，写错即过滤掉全部模型（这是有意的：宁可空目录，也不要
   * 再让不可调用的通道流出去）。
   */
  channels: readonly string[]
  /**
   * 远端不可用时的兜底输出上限（`max_tokens`）。
   *
   * 实测主流模型在远端声明的即为此值；远端可用时**以远端为准**。
   * 不放进 `fallbackModels` 逐条声明是因为各模型真实值并不一致
   * （4000 ~ 384000），逐条填只会编造出更细的假数据。
   */
  fallbackMaxOutputTokens?: number
  /**
   * 是否启用 **Max 模式**（1M 上下文）。**默认开启**，显式设 `DSH_TRAE_MAX_MODE=0` 关闭。
   *
   * 默认开的原因（用户要求）：上下文应当用**最大的那一档**。开启后只有远端
   * `display_config.max_mode === true` 的模型才会走 1M —— 未标记的模型即便
   * 开关为开也仍走常规 `dev`(200K)，见 `TraeAdapter.maxModeFor`，所以开启
   * 不会让任何模型失败。
   *
   * ⚠️ Max 会话向 1M 窗口里塞入远超常规的上下文，**计费倍率与常规会话不同**
   * （远端按 `strategy=max` 单独计价）。需要省额度时设 `DSH_TRAE_MAX_MODE=0`。
   *
   * 与 `Trae2api-cn` 的 `TRAE_REMOTE_MAX_MODE` 同名（但那边默认 `0`，本插件
   * 按用户要求改为默认开）。
   */
  maxMode?: boolean
  /**
   * Max 模式白名单（逗号分隔，`DSH_TRAE_MAX_MODELS`）。留空 = 所有
   * `max_mode=true` 的模型都生效；含 `*` 亦表示全部。
   *
   * 对齐 `Trae2api-cn` 的 `TRAE_REMOTE_MAX_MODELS`。
   */
  maxModeModels?: readonly string[]
  /**
   * @deprecated **不再生效**。`is_invisible_to_user` 过滤已移至
   * `parseTraeBatchModelList` 作为硬性过滤执行，不再由本开关控制。保留字段
   * 仅为避免破坏现有 profile 配置中显式设置了该值的用户。
   */
  hideInternalModels?: boolean
  /**
   * 登录 URL 的 `plugin_version` 参数（**不是** IDE 版本号）。
   *
   * 实测值 `2.3.62834`（`login.sh:54`）—— 与 `ideVersion` 是两个独立字段：
   * 前者是登录门户认的插件版本，后者是 chat 端点的模型准入版本。
   */
  pluginVersion: string
  /** 默认凭据 ref（无账号池时的单凭据回退）。 */
  defaultCredentialRef: string
  /** User-Agent。 */
  userAgent: string
  /** 远端模型列表不可用时的兜底模型目录。 */
  fallbackModels: readonly TraeFallbackModel[]
  /**
   * 是否走 **PKCE** 流程（`code_challenge` + `code_verifier`）。
   *
   * 设为 `true` 时 `buildTraeLoginURL` 会附加 `code_challenge=<base64url(SHA-256(verifier))>`
   * + `code_challenge_method=S256`；回调拿到 `authCodeInfo` 后 `exchangeTraeCallback`
   * 走 AuthCode 路径（带 `CodeVerifier`）。**必须**用 `generateTraeCodeVerifier` /
   * `buildTraeCodeChallenge` 在登入前生成对。
   *
   * CN 不需要（默认 `false`）；TRAE 国际版实测（`main.log:218`）必走 PKCE。
   */
  pkceEnabled?: boolean
  /**
   * 是否走 **新协议 DeviceProof**（ECDSA P-256 签名 + DeviceInfo）。
   *
   * 设为 `true` 时 `exchangeTraeCallback` 在 refresh-token 路径
   * 必须给 ExchangeToken body 加：
   *   - `DeviceInfo`（13 字段，含 `DeviceID` / `MachineID` / `DevicePublicKey` …）
   *   - `DeviceProof.{Signature, Timestamp, Nonce}`（用持久化私钥签 6 段换行）
   *
   * CN 协议兼容老格式（`ClientSecret:"-"` + `UserID`）不需要。**TRAE 国际版实测
   * 老协议 401 + `20405 Device proof required`**（`main.log` 修复前表现）。
   */
  deviceKeyRequired?: boolean
}

/** 上游 API 基址（Agent 服务）。 */
export const TRAE_AGENT_HOST = 'https://trae-api-cn.mchost.guru'
/** 签到/积分/Ug 基址。 */
export const TRAE_UG_HOST = 'https://api.trae.cn'
/** OAuth/认证基址。 */
export const TRAE_OAUTH_HOST = 'https://api.trae.com.cn'
/** 登录门户基址。 */
export const TRAE_CONSOLE_HOST = 'https://www.trae.cn'

/**
 * 兜底模型目录（32 个，对齐 Go 端 staticModels）。
 *
 * 来源：`handler.go:247-280`，2026-08 实测快照。
 * 顺序照抄 Go 端，不重排。远端可用时完全采信远端，本表只在远端整体失败时顶替。
 */
const TRAE_FALLBACK_MODELS: readonly TraeFallbackModel[] = [
  { id: 'DeepSeek-V4-Flash-Official', name: 'DeepSeek V4 Flash Official', contextWindow: 200_000 },
  { id: 'Doubao-Seed-2.1-Pro', name: 'Doubao Seed 2.1 Pro', contextWindow: 200_000 },
  { id: 'seed-code-pro-0430', name: 'Seed Code Pro 0430', contextWindow: 200_000 },
  { id: 'Doubao-Seed-2.1-Turbo', name: 'Doubao Seed 2.1 Turbo', contextWindow: 200_000 },
  { id: 'Doubao-Seed-2.0-Code', name: 'Doubao Seed 2.0 Code', contextWindow: 200_000 },
  { id: 'browser_use_subagent', name: 'Browser Use Subagent', contextWindow: 200_000, isHidden: true },
  { id: 'glm-5.2', name: 'GLM-5.2', contextWindow: 200_000 },
  { id: 'glm-5-turbo', name: 'GLM-5 Turbo', contextWindow: 200_000 },
  { id: 'glm-5', name: 'GLM-5', contextWindow: 200_000 },
  { id: 'DeepSeek-V4-Pro', name: 'DeepSeek V4 Pro', contextWindow: 200_000 },
  { id: 'DeepSeek-V4-Flash', name: 'DeepSeek V4 Flash', contextWindow: 200_000 },
  { id: 'kimi-k3', name: 'Kimi K3', contextWindow: 200_000 },
  { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', contextWindow: 200_000 },
  { id: 'kimi-k2.6', name: 'Kimi K2.6', contextWindow: 200_000 },
  { id: 'minimax-m3', name: 'MiniMax M3', contextWindow: 200_000 },
  { id: 'qwen-3.7-plus', name: 'Qwen 3.7 Plus', contextWindow: 200_000 },
  { id: 'sagitta', name: 'Sagitta', contextWindow: 200_000 },
  { id: 'aquila', name: 'Aquila', contextWindow: 200_000 },
  { id: 'custom_model_gemini', name: 'Custom Gemini', contextWindow: 200_000 },
  { id: 'custom_model_placeholder', name: 'Custom Placeholder', contextWindow: 200_000 },
  { id: 'custom_model_1M_text', name: 'Custom 1M Text', contextWindow: 200_000 },
  { id: 'custom_model_1M', name: 'Custom 1M', contextWindow: 200_000 },
  { id: 'custom_model_kimi', name: 'Custom Kimi', contextWindow: 200_000 },
  { id: 'custom_model_claude', name: 'Custom Claude', contextWindow: 200_000 },
  { id: 'custom_model_gpt-5', name: 'Custom GPT-5', contextWindow: 200_000 },
  { id: 'custom_model_no-fc', name: 'Custom No-FC', contextWindow: 200_000 },
  { id: 'custom_model_deepseek_chat', name: 'Custom DeepSeek Chat', contextWindow: 200_000 },
  { id: 'custom_model_deepseek_reasoner', name: 'Custom DeepSeek Reasoner', contextWindow: 200_000 },
  { id: 'custom_model_deepseek_v4', name: 'Custom DeepSeek V4', contextWindow: 200_000 },
  { id: 'explore_sub_agent_v13', name: 'Explore Sub Agent V13', contextWindow: 200_000, isHidden: true },
  { id: 'explore_sub_agent_v2', name: 'Explore Sub Agent V2', contextWindow: 200_000, isHidden: true },
  { id: 'summary', name: 'Summary', contextWindow: 200_000, isHidden: true },
]

/**
 * **可调用通道白名单**（顺序即优先级，详见 `TraeProduct.channels` 的注释）。
 *
 * 内容来自逐通道实测（2026-10-04）：只放行在
 * `/api/agent/v3/llm_utils_chat` 下真正可调用的 15 个 function。
 * `chat` / `builder` / `inline_chat` 实测稳定被拒，**不得**放入；
 * `ui_builder_v2` / `solo_builder` / `custom_agent_generation` / `utils`
 * 目录恒空，放进来也无意义。
 *
 * 前三条是通用通道（官方 Auto Mode 用的就是它们），其余为专用通道：
 * - `solo_agent`：**首位**，对应 Auto Mode 的模型列表，包含最多的模型
 *   （实测 18 条）与 `display_contact_config` / `reasoning_effort_config`。
 * - `solo_work_lite`：本项目既有通道。⚠️ 历史注释说 `glm-5-turbo` / `sagitta`
 *   在此可用 —— 那两个模型**已从目录下架**（2026-10-04 实测不在任何通道里），
 *   该说法是过期快照，不要据此断言。
 * - `solo_agent_remote`：补上 agent 专有模型（`glm-5.1` / `kimi-k2.7-code` 等）。
 *
 * 可用 `DSH_TRAE_CHANNELS`（逗号分隔）覆盖。
 */
export const TRAE_CHANNELS: readonly string[] = resolveChannelList(
  process.env.DSH_TRAE_CHANNELS,
)

/** 解析 `DSH_TRAE_CHANNELS`；空/非法时回退默认通道列表。 */
function resolveChannelList(raw: string | undefined): readonly string[] {
  const fallback: readonly string[] = [
    // ── 通用通道（顺序即优先级）──
    'solo_agent',
    'solo_work_lite',
    'solo_agent_remote',
    'solo_work_remote',
    'solo_agent_lite',
    // ── 专用通道（只有通用通道都不含某模型时才会命中）──
    'chat_v3',
    'builder_v3',
    'solo_coder',
    'solo_design_lite',
    'solo_design_remote',
    'git_ai',
    'code_reviewer',
    'code_review_summary',
    'multimodal',
    'system_diagnosis',
  ]
  if (raw === undefined) return fallback
  const parsed = raw.split(',').map((item) => item.trim()).filter((item) => item.length > 0)
  return parsed.length > 0 ? parsed : fallback
}

/** 解析布尔型开关环境变量；只有显式真值才算开启。 */
function isTruthyFlag(raw: string | undefined): boolean {
  if (raw === undefined) return false
  const value = raw.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

/**
 * 解析 `DSH_TRAE_MAX_MODE`；**默认开启**（用户要求「上下文用最大的那一档」）。
 *
 * 只有显式假值（`0` / `false` / `no` / `off`）才关闭 —— 与
 * `isTruthyFlag` 的「默认关」语义相反，故单列一个函数，不要混用。
 */
function resolveMaxModeFlag(raw: string | undefined): boolean {
  if (raw === undefined) return true
  const value = raw.trim().toLowerCase()
  return !(value === '0' || value === 'false' || value === 'no' || value === 'off')
}

/**
 * 解析 `DSH_TRAE_MAX_MODELS` 白名单。
 *
 * 留空返回 `undefined`（而非空数组）：空数组在下游是「白名单存在但什么都不匹配」
 * 的语义，会把 Max 模式**全部**关掉，与「留空 = 全部生效」相反。
 */
function resolveMaxModeModels(raw: string | undefined): readonly string[] | undefined {
  if (raw === undefined) return undefined
  const parsed = raw.split(',').map((item) => item.trim()).filter((item) => item.length > 0)
  return parsed.length > 0 ? parsed : undefined
}

/**
 * TRAE provider 配置。
 */
export const TRAE: TraeProduct = {
  id: 'trae',
  displayName: 'TRAE (字节)',
  agentHost: TRAE_AGENT_HOST,
  ugHost: TRAE_UG_HOST,
  oauthHost: TRAE_OAUTH_HOST,
  consoleHost: TRAE_CONSOLE_HOST,
  clientId: 'en1oxy7wnw8j9n',
  appId: '6eefa01c-1036-4c7e-9ca5-d891f63bfcd8',
  ideVersion: '0.1.52',
  ideVersionCode: '20260811',
  deviceBrand: 'Apple',
  osVersion: 'macOS 15.7.4',
  function: 'solo_work_lite',
  channels: TRAE_CHANNELS,
  fallbackMaxOutputTokens: 32_000,
  maxMode: resolveMaxModeFlag(process.env.DSH_TRAE_MAX_MODE),
  maxModeModels: resolveMaxModeModels(process.env.DSH_TRAE_MAX_MODELS),
  hideInternalModels: isTruthyFlag(process.env.DSH_TRAE_HIDE_INTERNAL),
  pluginVersion: '2.3.62834',
  defaultCredentialRef: 'TRAE_ACCESS_TOKEN',
  userAgent: 'Trae/0.1.52',
  fallbackModels: TRAE_FALLBACK_MODELS,
}

/**
 * 路径选择 —— **按 product 选**。
 *
 * CN 路径来自 `trae2api` Go 逆向；国际版路径来自你本机 `D:\Tools\Trae`
 * 客户端 2026-10-13 启动日志（main.log 命中 `ExchangeToken` / `GetUserInfo`
 * / `pay/ide_user_pay_status` 的完整 URL）。
 *
 * - ExchangeToken：国际版 `/trae/api/v3/oauth/ExchangeToken`、CN
 *   `/cloudide/api/v3/trae/oauth/ExchangeToken`（前缀不同，国际版带 PKCE）。
 * - GetUserInfo：国际版与 CN 路径**完全相同**，换 host 即可（路径函数
 *   仍按 product 分流，避免日后某天再次分叉）。
 * - Pay/entitlement：国际版 v1、CN v2（版本不同，路径名**相同**）。
 *   ⚠️ 启动日志里只出现过 `pay/ide_user_pay_status`，但它**不带额度**，
 *   详见 {@link traeEntUsagePathFor} 的更正说明。
 * - chat/models/checkin：**路径两边同名**，按 product 选 host 即可，路径
 *   函数统一返回 CN 字面值。
 */
export function traeExchangePathFor(product: TraeProduct): string {
  return product.id === 'trae_intl'
    ? '/trae/api/v3/oauth/ExchangeToken'
    : '/cloudide/api/v3/trae/oauth/ExchangeToken'
}

export function traeUserInfoPathFor(_product: TraeProduct): string {
  // 两版同路径；保留 product 形参以备将来分叉。
  return '/cloudide/api/v3/trae/GetUserInfo'
}

export function traeEntUsagePathFor(product: TraeProduct): string {
  // ✅ 更正（2026-10-15）：国际版**两个** v1 端点都存在，但只有 `ent_usage`
  // 带 `user_entitlement_pack_list`（额度明细）。
  // 实测 `POST /trae/api/v1/pay/ide_user_ent_usage` → 200 且含 Pro plan 的
  // `quota.basic_usage_limit: 20` / `usage.basic_usage_amount`；
  // 而 `ide_user_pay_status` → 200 但响应里**只有** `enable_solo_*` /
  // `user_pay_identity` / `trial_status`，没有任何额度字段。
  // 此前国际版指向 pay_status，于是余额恒为 null。
  return product.id === 'trae_intl'
    ? '/trae/api/v1/pay/ide_user_ent_usage'
    : '/trae/api/v2/pay/ide_user_ent_usage'
}

export function traeCheckinStatusPathFor(_product: TraeProduct): string {
  return '/trae/api/v2/ug/checkin_credits/status'
}

export function traeCheckinClaimPathFor(_product: TraeProduct): string {
  return '/trae/api/v2/ug/checkin_credits/claim'
}

export function traeChatPathFor(product: TraeProduct): string {
  // ✅ 更正（2026-10-15）：国际版走**与 CN 相同的** `/api/agent/v3/llm_utils_chat`。
  // 此前误设为 `/api/ide/v1/llm_raw_chat` —— 那是 SOLO 后端的路径，需要
  // `coresg-normal.trae.ai` + AES-256-GCM 信封 + 付费 SOLO 权益。
  // Pro 套餐（$20 美元计费）走的是 `a0ai-api-sg.byteintlapi.com` 的
  // `inline_chat`，**裸 JSON POST，无信封**，用 OAuth `access_token` 直接当
  // `Cloud-IDE-JWT` 即可。实测 200 且真实扣 token。
  return '/api/agent/v3/llm_utils_chat'
}

export function traeModelsPathFor(product: TraeProduct): string {
  return product.id === 'trae_intl' ? '/api/ide/v1/model_list' : '/api/ide/v1/get_detail_param'
}

export function traeBatchModelsPathFor(product: TraeProduct): string {
  return product.id === 'trae_intl' ? '/api/ide/v1/model_list' : '/api/ide/v1/batch_get_detail_param'
}

/**
 * 国际版模型列表的请求体（`trae-auth.ts` 的 `fetchModels` 分派用）。
 *
 * CN 用 `batch_get_detail_param`（POST 空体即可）；国际版该路径在
 * `coresg-normal.trae.ai` 上是 **404 TLB**，真实端点是 `model_list`，且**必须**带
 * `type` —— 值来自 deob 偏移 ~11873300 的 `tD`：`{type: 'llm_raw_chat'}` + `get-svc: 1`。
 * 实测 `type` 取值扫描：`llm_raw_chat`/`chat` → 9 个模型，`builder` → 2 个，
 * 其余（`agent`/`agentic`/`cue`/`solo`/`code_completion`/`''` …）全部 `400 {"code":4001}`。
 */
export function traeModelsBodyFor(product: TraeProduct): Record<string, unknown> | null {
  return product.id === 'trae_intl' ? { type: 'llm_raw_chat' } : null
}

/**
 * 兜底模型目录（国际版，**22 条** —— 上游 Solo Agent 模型选择器的真实条目，2026-10-15 刷新）。
 *
 * ## 来源与三次修正（v1/v2/v3 均已作废，现行的是 v4）
 *
 * **v1（已作废）** 手写的 8 条（Claude-Sonnet-4.6 / DeepSeek-V4-Flash / Kimi-K3 …）
 * 在服务端**根本不存在**，纯属猜测。
 *
 * **v2（已作废）** `POST https://a0ai-api-sg.byteintlapi.com/api/ide/v1/model_list
 * {"type":"llm_raw_chat"}` + `get-svc: 1` 的 9 条返回（Gemini-2.5-Pro / GPT-4o /
 * DeepSeek-V3 / GLM-5.3 / MiniMax-M2.7 …）。这是 **`llm_raw_chat` 通道的老目录**，
 * 并不是用户在 Trae 界面里看到的那个下拉框。扫了 24 个 `type` 值，
 * 只有 `llm_raw_chat` / `chat`（同名单）与 `builder`（2 条）返回 200，
 * 其余全 `400 {"code":4001}`；`chat_v3` / `solo_agent` / `builder_v3` 等
 * 真实标签值直接当 `type` 发会被拒（400）。故**不能直接调 `model_list` 拿真目录**。
 *
 * **v3（已作废，18 条）** Trae 真正的模型目录走**渲染进程 → Rust TransportManager 的 RPC**
 * （`{service:"model", method:"model_list"}` / `model_list_by_function` /
 * `get_model_selection_modes`），URL 构造在 Rust 二进制里，JS bundle 里没有字符串常量，
 * 也没有任何 HTTP 路径字面量能对应上——**HTTP 层无法直连复现**。
 * v3 从 `%APPDATA%\Trae\logs\*\window1\renderer.log` 的 `model_select_tooltip_show`
 * 与 `model-writeback` 事件逐条还原（脚本 `tmp\extract-models3.mjs`），
 * 但那个正则漏了 `-` 与 `.` 混合分隔的 id，只拿到 18 条。
 *
 * **v4（本表，22 条）** 正确提取模式是 **`solo_agent_1__<id>_null`**
 * （2026-10-15 09:35 的 `window4/renderer.log`）。注意日志里 `model list refreshed`
 * 事件**只记 `modelCountByLabel` 的计数、不含模型名**，所以模型名必须从
 * `solo_agent_1__…` 这类 key 里抠 —— 这是 v3 漏掉 4 条的根本原因。
 *
 * ⚠️ 各 agentType 的条数在不同日志里不一致（`agent` 在不同次抓取里出现过 17 与 12
 * 两个值），且 `modelCountByLabel` 只给计数不给名单。**不要采信任何单一数字**，
 * 以最新一次 renderer.log 实抓为准。本表只覆盖 `solo_agent` 一个分组。
 *
 * `Dola-Seed-2.0-Code` 的 `modelName` 与显示名 `Seed-2.1-Turbo` 不一致，
 * 以 `modelName` 作 id、显示名作 name（其余 21 条两者同名同形）。
 *
 * `contextWindow` 统一取 64_000：RPC 返回体未落盘，取不到真值，
 * 这里是**保守估计值**而非上游真值。
 *
 * ## ⚠️⚠️ 选模不生效 —— 这是上游行为，不是本适配器的 bug
 *
 * **证据共 57 次真实请求（两轮）**，全部落进同一个池：
 *
 * | 轮次 | 规模 | 结论 |
 * |---|---|---|
 * | 第一轮 | 4 个 `function` × 11 个 `model` 取值（空串 / 8 个裸模型名 / `agent_1__…_null` / `solo_agent_1__…_null` 两类 key），44 次 | 同一 `provider_model_name` |
 * | 第二轮 | 13 种变体 × 2 个 host，26 次（`model_name` / `target_model` / `extra_body.model` / `llm_config.model` / 头 `X-Model-Name` / URL `?model=` / system 正文…） | 同一池 |
 *
 * 落点：只有 `function` 能切，且仅两个池 ——
 * `inline_chat` → `ep-20250724133548-k5xl9`，`chat_v3` → `ep-20260907150747-7hcmj`。
 * **两个池的模型自述都是字节自家**（"I am Seed, developed by ByteDance" /
 * "Doubao, ByteDance"）。SSE 的 `metadata` 事件回显 `"model":""`，
 * 说明服务端根本没读我们发的字段。
 * `coresg-normal.trae.ai/api/ide/v1/llm_raw_chat` 用新模型名仍是
 * `4001 param is invalid`，那是 SOLO 网关，body 形状不同，本插件走不通。
 *
 * 真实选模在渲染进程的 Rust RPC 里（`bytegate-sg.byteintlapi.com`），
 * 那里试过 13 条路径 × 4 种 body 全 404。**尚未找遍所有可能路径** ——
 * 若后续拿到端点/包名/请求形态，这条线索值得继续打。
 *
 * 结论：Pro 套餐背后是**极小的模型池**，这 22 个 `model` 值只是给界面看的标签。
 * 本目录的价值是让用户在 DSH 里按上游真实名字选择/显示，
 * **不承诺**切换会换底层模型。保留它是因为它确实是上游目录的真值，不是编的。
 */
const TRAE_INTL_FALLBACK_MODELS: readonly TraeFallbackModel[] = [
  // v4（2026-10-15）：从渲染进程日志里的 `solo_agent_1__<id>_null` 模式还原，
  // 共 22 条（10-15 09:35 的 `window4/renderer.log`），顺序对齐用户界面
  // 「内置」分组：Seed 排第一、GPT-6 全家族 4 条、GPT-5.6/5.5/5.4/5.2 各 1 条。
  //
  // ⚠️ **截至此版本**（仍是日志还原、非上游真值）：
  // - `solo_agent` 18 → 22（v3 漏掉了 `gpt-6-astra` / `gpt-6-sol` /
  //   `gpt-6.1-sol` / `minimax-m3` —— 与用户截图一一对照）
  // - `contextWindow` 统一 64_000（RPC 响应体未落盘，保守值不是上游真值）
  // - 这 22 条**全部**会被服务端的 `model` 字段忽略（见 selection-matrix
  //   的 44 条实测），但保留真目录是为了与界面一致
  // - 其他 agentType（`solo_coder` 8 / `solo_agent_lite` 15 / `agent` 12 /
  //   `solo_work_lite` 4 / `solo_work_remote` 4 / `solo_design_lite` 2 …）
  //   用户截图里没显示；这些是「按 agentType 分组」的不同选择器，本次
  //   不引入（怕覆盖 `solo_agent` 的菜单）。
  { id: 'Dola-Seed-2.0-Code', name: 'Seed-2.1-Turbo', contextWindow: 64_000 },
  { id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol', contextWindow: 64_000 },
  { id: 'gpt-6-astra', name: 'GPT-6-Astra', contextWindow: 64_000 },
  { id: 'gpt-6-sol', name: 'GPT-6-Sol', contextWindow: 64_000 },
  { id: 'gpt-6-luna', name: 'GPT-6-Luna', contextWindow: 64_000 },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol', contextWindow: 64_000 },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra', contextWindow: 64_000 },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6-Luna', contextWindow: 64_000 },
  { id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 64_000 },
  { id: 'gpt-5.4', name: 'GPT-5.4', contextWindow: 64_000 },
  { id: 'gpt-5.2', name: 'GPT-5.2', contextWindow: 64_000 },
  { id: 'glm-5.2', name: 'GLM-5.2', contextWindow: 64_000 },
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1-Flash', contextWindow: 64_000 },
  { id: 'deepseek-v4-flash-0731', name: 'DeepSeek-V4-Flash', contextWindow: 64_000 },
  { id: 'deepseek-v4-pro-0813', name: 'DeepSeek-V4-Pro', contextWindow: 64_000 },
  { id: 'kimi-k3', name: 'Kimi-K3', contextWindow: 64_000 },
  { id: 'kimi-k2.7-code', name: 'Kimi-K2.7-Code', contextWindow: 64_000 },
  { id: 'kimi-k2.5', name: 'Kimi-K2.5', contextWindow: 64_000 },
  { id: 'gemini-3.1-pro', name: 'Gemini-3.1-Pro-Preview', contextWindow: 64_000 },
  { id: 'gemini-3-flash-solo', name: 'Gemini-3-Flash-Preview', contextWindow: 64_000 },
  { id: 'minimax-m3', name: 'MiniMax-M3', contextWindow: 64_000 },
  { id: 'minimax-m2.7', name: 'MiniMax-M2.7', contextWindow: 64_000 },
]

/**
 * 国际版通道白名单 —— **只有一个 `inline_chat`**。
 *
 * ⚠️ 与 CN 完全不同（2026-10-15 实测，17 个候选逐一发送真实请求）：
 *
 * | 结果 | function |
 * |---|---|
 * | ✅ 唯一可调用 | `inline_chat` |
 * | ❌ `no function config found for appId=6eefa01c-..., function=<f>` | `llm_raw_chat` / `llm_chat` / `raw_chat` / `chat_completion` / `llm_utils_chat` / `completion` / `agent_task` / `solo_chat` / `ide_chat` / `icube_chat` / `cloudide_chat` / `deepseek_chat` / `code_chat` / `v2_chat` / `chat_v2` / `agent_v3_chat` |
 * | ❌ `4023 the model is unknown` | `chat` / `builder` |
 *
 * 国际版 Pro 套餐的 appId 只注册了 `inline_chat` 一个 function config，
 * 远端按 `appId + function` 二元组查配置，查不到就回 `2001`。
 * CN 那 15 个 `solo_*` / `*_v3` 通道是**给 SOLO 权益用的**，Pro 账号一律 2001。
 *
 * 仍可用 `DSH_TRAE_CHANNELS` 覆盖（注意：写错就是空目录）。
 */
const TRAE_INTL_CHANNELS: readonly string[] = resolveChannelList(
  process.env.DSH_TRAE_CHANNELS,
  ['inline_chat'],
)

/**
 * TRAE 国际版 provider 配置。
 *
 * 数据来源：你本机 `D:\Tools\Trae` 客户端 2026-10-13 启动日志：
 *   - ClientID：`ono9krqynydwx5`（CN 是 `en1oxy7wnw8j9n`）
 *   - app_id (tea)：`677332`
 *   - IDEVersion：`3.5.87`、`packageType=stable_i18n`
 *   - plugin_version：`2.3.68993`
 *   - 区域：`userRegion=sg`、`StoreCountry=tw`、`Region=Singapore-Central`
 *   - OAuth 登录门户：`https://www.trae.ai/authorization`
 *   - ExchangeToken：`POST https://growsg-normal.trae.ai/trae/api/v3/oauth/ExchangeToken`
 *     （CN 是 `/cloudide/api/v3/trae/oauth/ExchangeToken`，**前缀不同**，
 *      且国际版带 PKCE `CodeVerifier`）
 *   - GetUserInfo：`POST https://growsg-normal.trae.ai/cloudide/api/v3/trae/GetUserInfo`
 *     （CN 同路径，换 host）
 *   - 账号区域 API：`https://api-sg-central.trae.ai`（凭据 `host` 字段）
 *   - 付费/权益：`/trae/api/v1/pay/ide_user_pay_status`
 *     （CN 是 `/trae/api/v2/pay/ide_user_ent_usage`，**版本+路径都不同**）；
 *     实测该端点要带 SOLO 形态头才 200，响应显示 Pro 套餐
 *     `enable_solo_*` 全 `true` + `is_dollar_usage_billing: true`
 *   - 对话端点：**`https://a0ai-api-sg.byteintlapi.com`**（备用
 *     `https://trae-api-sg.mchost.guru`）—— 实测 `POST /api/agent/v3/llm_utils_chat`
 *     配 `function: inline_chat` 回 200 并真实扣 token。
 *
 * ⚠️ **曾经的三个错假设（2026-10-15 全部推翻，勿回退）**：
 *   1. host `https://coresg-normal.trae.ai` —— 那是 **SOLO** 后端，
 *      Pro 账号打上去恒回 `4120`/`4023`，与账号余额无关。
 *   2. 请求体需要 **AES-256-GCM 信封**（`message` 字段）—— 那是 `llm_raw_chat`
 *      的反滥用机制，`inline_chat` 走**裸 JSON**。
 *   3. 需要先 `POST /cloudide/api/v3/trae/GenerateTempToken` 换 JWT ——
 *      `inline_chat` 直接把 OAuth `access_token` 同时放进
 *      `Authorization: Cloud-IDE-JWT` 和 `X-Cloudide-Token` 即可。
 *
 * 与 `TRAE` 共用同一个 `TraeAuth` / `TraeAdapter` 类（Qoder 双版本模式）。
 * 差异全部落在本 product 常量 + `*PathFor()` 分派上。
 */
export const TRAE_INTL: TraeProduct = {
  id: 'trae_intl',
  displayName: 'Trae (国际版)',
  agentHost: 'https://a0ai-api-sg.byteintlapi.com',
  agentHostFallbacks: ['https://trae-api-sg.mchost.guru'],
  ugHost: 'https://growsg-normal.trae.ai',
  oauthHost: 'https://growsg-normal.trae.ai',
  consoleHost: 'https://www.trae.ai',
  clientId: 'ono9krqynydwx5',
  appId: '6eefa01c-1036-4c7e-9ca5-d891f63bfcd8',
  ideVersion: '3.3.67',
  ideVersionCode: '20260401',
  deviceBrand: 'Apple',
  osVersion: 'macOS 15.7.4',
  // ✅ 实测：国际版 Pro appId 只注册了 `inline_chat` 一个 function
  // （其余 17 个候选全部 `2001 no function config found`）。
  function: 'inline_chat',
  channels: TRAE_INTL_CHANNELS,
  fallbackMaxOutputTokens: 32_000,
  maxMode: resolveMaxModeFlag(process.env.DSH_TRAE_MAX_MODE),
  maxModeModels: resolveMaxModeModels(process.env.DSH_TRAE_MAX_MODELS),
  hideInternalModels: isTruthyFlag(process.env.DSH_TRAE_HIDE_INTERNAL),
  pluginVersion: '2.3.68993',
  defaultCredentialRef: 'TRAE_INTL_ACCESS_TOKEN',
  userAgent: 'Trae/3.5.87 (stable_i18n; sg)',
  fallbackModels: TRAE_INTL_FALLBACK_MODELS,
  // TRAE 国际版实测 (`main.log:218`, `main.log:87/234`) 走 PKCE 流程 +
  // 新协议 DeviceProof；CN TRAE 不需要。
  pkceEnabled: true,
  deviceKeyRequired: true,
}

/**
 * `provider id` → TRAE 同族 `TraeProduct`。
 *
 * 形态与 `qoderProductById` / `clineProductById` / `productById` 完全一致：
 * 未知 id 抛 `Error`，迫使调用方在「分派表漏接」时**立即**崩而不是继续
 * 拿 fallback（与 account-probe.ts 那条「TRAE_PROVIDER_ID 漏加就交给
 * 华为云 HMAC 签名发请求」的真实缺陷同因）。
 */
export function traeProductById(id: string): TraeProduct {
  switch (id) {
    case TRAE.id:
      return TRAE
    case TRAE_INTL.id:
      return TRAE_INTL
    default:
      throw new Error(`Unknown Trae product: ${id}`)
  }
}
