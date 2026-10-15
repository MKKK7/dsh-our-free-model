/**
 * TRAE（字节跳动 TRAE IDE）每日签到与积分余额。
 *
 * ## 数据来源
 *
 * 本模块重构自 trae-mate 的 `checkin.rs` + `credits.rs`。
 * trae-mate 是实际能成功签到的参考实现，其核心差异：
 *
 * - **请求头齐全**：约 20 个客户端头，而非简单的 Ug 头
 * - **设备身份稳定**：每个账号的 device_id 基于 user_id 确定性派生
 *   （15 位数字 + UUID v4 market_user_id + 64 hex session_id）
 * - **领取 body 为 `{}`**，而非 `{"req_source":2}`
 * - **积分余额 body 含 `require_usage: true`**
 * - **错误分类与冷却**：PlanLimit/SoftRate/SessionDead 等有冷却时间
 *
 * ## 签到
 *
 * 状态查询：
 *   POST /trae/api/v2/ug/checkin_credits/status → body {}
 *   响应: { checked_in: bool, credits: int64, enable: bool }
 *
 * 领取：
 *   POST /trae/api/v2/ug/checkin_credits/claim → body {}
 *   响应: { code: 0, message: "success" }
 *
 * ## 积分余额
 *
 *   POST /trae/api/v2/pay/ide_user_ent_usage
 *   body {"require_usage": true, "req_source": 2}
 *   响应: { user_entitlement_pack_list: [ ... ] }
 *   remain = ∑(credits_limit - credits_amount)
 *
 * ## 公共约定（与另三套协议一致）
 *
 * - `claimAll` / `status` **处理该 provider 下的全部账号，含已停用**
 * - 逐账号**顺序执行**（并发易触发风控），单个账号失败不中断整批
 * - 返回同一个 `ClaimOutcome` / `CreditBalance` 判别联合
 */

import {
  TRAE_REQUEST_TIMEOUT_MS,
  traeCheckinHeaders,
  type TraeCredential,
} from './trae.js'
import {
  traeCheckinClaimPathFor,
  traeCheckinStatusPathFor,
  traeEntUsagePathFor,
  type TraeProduct,
} from './trae-product.js'
import type { CheckinStatus, ClaimOutcome, CreditBalance, CreditPackage } from './credits.js'

// ── 错误分类与冷却时间（对齐 trae-mate `cooldown.rs`）──

/**
 * 签到错误分类，每类对应不同冷却策略。
 */
export interface TraeCheckinError {
  type: string     // PlanLimit | SoftRate | SessionDead | NotFound | Server | Client | BusinessError | Unknown
  cooldownSecs: number // -1=永久, 0=不冷却, >0=冷却秒数
}

/**
 * 分类签到错误，返回类型与冷却时间。
 *
 * 对齐 trae-mate `cooldown.rs:classify_error`：
 * - 200 + code=1005 → PlanLimit, 43200s (12h)
 * - HTTP 429 → SoftRate, 60s
 * - HTTP 401 → SessionDead, 永久
 * - HTTP 404 → NotFound, 60s
 * - 5xx → Server, 600s
 * - 4xx → Client, 600s
 * - 业务码非0 → BusinessError, 300s
 * - 成功/无码 → Unknown, 不冷却
 */
export function classifyTraeCheckinError(
  httpStatus: number,
  code: number | undefined,
): TraeCheckinError {
  if (httpStatus === 200 && code === 1005) {
    return { type: 'PlanLimit', cooldownSecs: 43_200 }
  }
  if (httpStatus === 429) {
    return { type: 'SoftRate', cooldownSecs: 60 }
  }
  if (httpStatus === 401) {
    return { type: 'SessionDead', cooldownSecs: -1 }
  }
  if (httpStatus === 404) {
    return { type: 'NotFound', cooldownSecs: 60 }
  }
  if (httpStatus >= 500 && httpStatus < 600) {
    return { type: 'Server', cooldownSecs: 600 }
  }
  if (httpStatus >= 400 && httpStatus < 500) {
    return { type: 'Client', cooldownSecs: 600 }
  }
  if (code !== undefined && code !== 0) {
    return { type: 'BusinessError', cooldownSecs: 300 }
  }
  return { type: 'Unknown', cooldownSecs: 0 }
}

/**
 * 签到业务码 **9074**：「签到人数过多」。
 *
 * 保留此常量作为公开引用（供测试与 RPC 使用）。
 */
export const TRAE_CHECKIN_BUSY_CODE = 9074

// ── JSON 安全读取 ──

function readNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  return typeof value === 'string' ? value : ''
}

/** 只认真正的布尔 `true` —— 服务端偶尔下发 `'true'` 字符串，不做宽松转换。 */
function readBoolean(source: Record<string, unknown>, key: string): boolean {
  return source[key] === true
}

/**
 * 读取业务码，兼容数字与字符串形态。
 *
 * ⚠️ 不能只 `typeof === 'number'`：后端在部分网关上以字符串 `"9074"` 返回，
 * 只认数字会误判为成功（code=0）。
 */
function readClaimCode(body: Record<string, unknown>): number {
  const raw = body.code
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim())) return Number(raw.trim())
  return raw === undefined ? 0 : -1
}

// ── HTTP 请求 ──

/**
 * 发起一次 POST 请求（签到专用，使用完整客户端头）。
 *
 * 用 `credential.uid` 作为 user_id 来派生稳定的设备身份。
 * 每次请求生成独立的 `X-Request-Id`。
 */
async function postJson(
  path: string,
  credential: TraeCredential,
  body: string,
  fetcher: typeof fetch,
  userId: string | undefined,
  /**
   * `host`：TRAE 签到与余额端点域名（CN `https://api.trae.cn`、INTL `https://growsg-normal.trae.ai`）。
   *
   * ⚠️ **必须由调用方按 product 注入**：早先这里写死 `https://api.trae.cn` —— 是的，
   * 那是「中国版」的 ugHost。国际版账号一旦发签到，就会把请求打到 CN 域名上
   * （跨站 token 不通用、必失败）。改为传参后路径仍按 `*PathFor(product)` 走，
   * host 按 product 走 —— 两边解耦后跟「同协议族共用实现、差异收敛到 product」一致。
   */
  host: string,
  /**
   * `product`：TRAE 同族的产品配置。**必须由调用方注入** —— 早先这里传
   * `{} as never`，导致 `traeCheckinHeaders` 拿不到 product 就退回 CN 形态
   * （`Authorization: Cloud-IDE-JWT` + `X-User-Region: CN`），
   * 且 `product.ideVersion` 是 undefined → 头里出现 `App-Version: undefined`。
   * 国际版账号因此拿不到余额（请求头与真身不符）。
   */
  product: TraeProduct,
): Promise<{ ok: true; body: Record<string, unknown>; httpStatus: number } | { ok: false; message: string; httpStatus: number }> {
  const uid = userId ?? credential.uid
  if (uid.length === 0) {
    return { ok: false, message: '缺少 user_id，无法构造设备身份', httpStatus: 0 }
  }
  try {
    const response = await fetcher(`${host}${path}`, {
      method: 'POST',
      headers: traeCheckinHeaders(credential, product, uid) as Record<string, string>,
      body,
      signal: AbortSignal.timeout(TRAE_REQUEST_TIMEOUT_MS),
    })
    const httpStatus = response.status
    const text = await response.text()
    if (!response.ok) {
      const snippet = text.trim().slice(0, 80).replace(/\s+/g, ' ')
      return { ok: false, message: `HTTP ${response.status}: ${snippet}`, httpStatus }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return { ok: false, message: `非 JSON 响应: ${text.trim().slice(0, 80)}`, httpStatus }
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return { ok: false, message: '响应不是对象', httpStatus }
    }
    return { ok: true, body: parsed as Record<string, unknown>, httpStatus }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error), httpStatus: 0 }
  }
}

// ── 签到状态查询 ──

/**
 * 查询签到状态。
 */
export async function fetchTraeCheckinStatus(
  credential: TraeCredential,
  product: TraeProduct,
  fetcher: typeof fetch = fetch,
): Promise<CheckinStatus | null> {
  const result = await postJson(traeCheckinStatusPathFor(product), credential, '{}', fetcher, credential.uid, product.ugHost, product)
  if (!result.ok) return null
  const body = result.body
  const code = readClaimCode(body)
  if (code !== 0) return null
  return {
    active: body.enable === true,
    todayCheckedIn: body.checked_in === true,
    streakDays: readNumber(body, 'streak_days') || 0,
    dailyCredit: readNumber(body, 'credits') || 0,
    todayCredit: 0,
    isStreakDay: false,
    totalCredits: readNumber(body, 'total_credits') || 0,
    checkinDates: [],
    activityName: '',
    themeName: '',
    endTime: '',
  }
}

// ── 签到领取 ──

/**
 * 执行签到领取。
 *
 * 对齐 trae-mate `checkin_engine` 流程，关键差异：
 *
 * 1. **请求头**：使用完整客户端头（含 `X-Market-User-ID` / `X-Lscbd-Aid` 等）
 * 2. **设备身份**：基于 `credential.uid` 确定性派生，每个账号独立稳定
 * 3. **Body**：`{}` 而非 `{"req_source":2}`
 * 4. **网络重试**：网络异常（非业务码、HTTP 不可达）重试，业务码不重试
 * 5. **错误分类**：返回分类信息供调用方做冷却
 *
 * @param userId 可选的手动 user_id（默认用 credential.uid）
 */
export async function claimTraeDailyCheckin(
  credential: TraeCredential,
  product: TraeProduct,
  fetcher: typeof fetch = fetch,
  generation = 0,
  onRotate?: (nextGeneration: number) => void | Promise<void>,
  userId?: string,
  retryCount = 3,
): Promise<ClaimOutcome & { errorType?: string; cooldownSecs?: number }> {
  const uid = userId ?? credential.uid
  // 多次重试
  const doClaim = async (): Promise<{ ok: boolean; body?: Record<string, unknown>; httpStatus: number; message: string; code: number }> => {
    let lastError = { ok: false, httpStatus: 0, message: '', code: 0 }
    for (let attempt = 0; attempt <= Math.max(0, retryCount); attempt++) {
      const result = await postJson(traeCheckinClaimPathFor(product), credential, '{}', fetcher, uid, product.ugHost, product)
      if (result.ok) {
        const c = readClaimCode(result.body)
        return { ok: true, body: result.body, httpStatus: result.httpStatus, message: '', code: c }
      }
      lastError = { ok: false, httpStatus: result.httpStatus, message: result.message, code: 0 }
      // 只重试网络异常（非 Web 页面/非 JSON 等）——业务错误不再重试
      if (result.httpStatus > 0) {
        return lastError
      }
      if (attempt < retryCount) {
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
    return lastError
  }

  const response = await doClaim()
  if (!response.ok) {
    return { kind: 'failed', code: -1, message: response.message, errorType: 'Unknown', cooldownSecs: 0 }
  }

  const body = response.body!
  const code = readClaimCode(body)

  // ── 9074：设备轮换已废弃，不再重试 ──
  // trae-mate 基于 user_id 确定性派生设备身份，不同账号天然不同设备，
  // 不再需要 9074 时换设备号重试。
  if (code === 9074) {
    return {
      kind: 'failed',
      code: 9074,
      message: readString(body, 'message') || readString(body, 'msg') || '签到人数过多，请稍后再试',
      errorType: 'BusinessError',
      cooldownSecs: 300,
    }
  }

  const msg = readString(body, 'message') || readString(body, 'msg') || ''

  if (code === 0) {
    // ⚠️ **claim 响应不含积分数**：实测（2026-09-20）它的完整响应就是
    // `{"code":0,"message":"success"}`，没有 credits 字段。早期实现读
    // `body.credits` 因此恒为 0，界面显示「领取成功 +0 积分」（用户报障），
    // 而 IDE 里明明写着 150。
    //
    // 真实数值只在 **status 端点**的 `credits` 字段里（实测 `credits:150`，
    // 与积分余额中「签到奖励」包的 `credits_limit:150` 完全吻合）。
    // 故领取成功后补查一次状态 —— 多一次往返，换取如实报告所得。
    const status = await fetchTraeCheckinStatus(credential, product, fetcher)
    return {
      kind: 'claimed',
      credit: status?.dailyCredit ?? 0,
      streakDays: status?.streakDays ?? 0,
      isStreakDay: false,
    }
  }

  const { type, cooldownSecs } = classifyTraeCheckinError(response.httpStatus, code)
  return {
    kind: 'failed',
    code,
    message: msg.length > 0 ? msg : `签到失败（code=${code}）`,
    errorType: type,
    cooldownSecs,
  }
}

// ── 积分余额查询 ──

/**
 * 查询积分余额（对齐 trae-mate `calc_remaining_credits`）。
 *
 * 关键差异与签到相同：使用完整客户端头 + 基于 user_id 的设备身份。
 * body 使用 `{"require_usage": true, "req_source": 2}`。
 */
export async function fetchTraeCreditBalance(
  credential: TraeCredential,
  product: TraeProduct,
  fetcher: typeof fetch = fetch,
): Promise<CreditBalance | null> {
  const result = await postJson(
    traeEntUsagePathFor(product),
    credential,
    JSON.stringify({ require_usage: true, req_source: 2 }),
    fetcher,
    credential.uid,
    product.ugHost,
    product,
  )
  if (!result.ok) return null
  const body = result.body
  const packList = body.user_entitlement_pack_list
  if (!Array.isArray(packList) || packList.length === 0) return null

  const packages: CreditPackage[] = []
  let total = 0
  let expiredTotal = 0

  /**
   * 国际版是**美元计费**（`is_dollar_usage_billing: true`，Pro 套餐
   * `basic_usage_limit: 20` 美元/月），额度不在 `credits_limit` 上 —— 它恒为
   * `0`。所以下面那个 `if (creditsLimit <= 0) continue` 会把**所有**国际版包
   * 滤掉，`packages` 恒空、余额恒 `null`（2026-10-15 实测）。
   *
   * 两种计费形态的字段对照（实测 Pro $20 账号，`ide_user_ent_usage`）：
   *
   * | 语义        | 国内版（积分）      | 国际版（美元）              |
   * |-------------|--------------------|-----------------------------|
   * | 套餐额度    | `credits_limit`    | `basic_usage_limit`（USD）  |
   * | 已用        | `credits_amount`   | `basic_usage_amount`（USD） |
   * | 赠送额度    | ——                 | `bonus_usage_limit` / `_amount` |
   * | 快速请求数  | ——                 | `premium_model_fast_request_limit`（次，600） |
   * | 计费版本    | ——                 | `billing_version: 3`        |
   */
  const dollarBilling = readBoolean(body, 'is_dollar_usage_billing') === true

  for (const item of packList) {
    if (typeof item !== 'object' || item === null) continue
    const entry = item as Record<string, unknown>
    const base = entry.entitlement_base_info as Record<string, unknown> | undefined
    if (typeof base !== 'object' || base === null) continue
    const quota = base.quota as Record<string, unknown> | undefined
    if (typeof quota !== 'object' || quota === null) continue
    const creditsLimit = readNumber(quota, 'credits_limit')
    const basicLimit = readNumber(quota, 'basic_usage_limit')
    // 国内版靠 `credits_limit > 0` 判「这个包有额度」；国际版它恒 0，
    // 改用美元额度与快速请求数判。两者都拿不到才是真的空包。
    if (creditsLimit <= 0 && basicLimit <= 0 && readNumber(quota, 'premium_model_fast_request_limit') <= 0) continue

    const usage = entry.usage as Record<string, unknown> | undefined
    const hasUsage = typeof usage === 'object' && usage !== null
    const used = dollarBilling
      ? (hasUsage ? readNumber(usage, 'basic_usage_amount') : 0)
      : (hasUsage ? readNumber(usage, 'credits_amount') : 0)
    const limit = dollarBilling ? basicLimit : creditsLimit

    // 到期时间（2026-09-29 抓包取证，推翻早前"起始日期+31天"的推断方案）：
    // 服务端在**条目级**直接下发 `expire_time` —— **秒级** Unix 时间戳
    // （实测 1790783999 = 2026-09-30 23:59:59，与官方 UI "2026/09/30 23:59 到期"
    // 逐条吻合：每月登录赠送 500 的 1790783999、三个签到包的 10/28·29·30）。
    // ⚠️ 秒 → 毫秒必须 ×1000；不乘会让显示落在 1970 年。
    // `base_info.end_time` 与它同值（备用来源），`yearly_expire_time` 实测恒 0
    // 不取。拿不到（0/缺失）就不设置 deductionEndTime（前端显示"永久"）。
    // ⚠️ 国际版的条目级 `expire_time` **恒为 0**，真到期时间只在
    // `base.end_time`（Pro 实测 1793583752）—— 不取兜底就永远显示"永久"。
    const expireSec = readNumber(entry, 'expire_time') || readNumber(base, 'end_time')
    const deductionEndMs = expireSec > 0 ? expireSec * 1000 : undefined

    const planName = readString(entry, 'display_desc') || readString(base, 'display_desc') || '资源包'
    const pack: CreditPackage = {
      // ⚠️ 包名用 `display_desc`（实测"每月登录赠送"/"签到奖励"/"免费"），
      // 不是 `base.name` —— 后者实测为 undefined，旧代码全部回退成了"资源包"。
      name: dollarBilling ? `${planName} · 基础额度` : planName,
      unit: dollarBilling ? 'USD' : 'credits',
      remaining: limit - used,
      total: limit,
      used,
      active: true,
      cycleStartTime: '',
      cycleEndTime: '',
      expiredTime: '',
      ...(deductionEndMs !== undefined ? { deductionEndTime: deductionEndMs } : {}),
    }
    packages.push(pack)
    total += pack.remaining

    if (!dollarBilling) continue

    // 美元形态下另外两笔额度要各占一个包，否则用户看到的余额不含它们。
    const bonusLimit = readNumber(quota, 'bonus_usage_limit')
    if (bonusLimit > 0) {
      const bonusUsed = hasUsage ? readNumber(usage, 'bonus_usage_amount') : 0
      const bonusPack: CreditPackage = {
        ...pack,
        name: `${planName} · 赠送额度`,
        remaining: bonusLimit - bonusUsed,
        total: bonusLimit,
        used: bonusUsed,
      }
      packages.push(bonusPack)
      total += bonusPack.remaining
    }

    const fastRequests = readNumber(quota, 'premium_model_fast_request_limit')
    if (fastRequests > 0) {
      // ⚠️ 这是**次**数不是金额，绝不能并进 `total` —— 那会让美元余额虚高。
      // 单独成一个包且不累加，UI 上单位是「次」自明。
      packages.push({
        ...pack,
        name: `${planName} · 快速请求次数`,
        unit: '次',
        remaining: fastRequests,
        total: fastRequests,
        used: 0,
      })
    }
  }

  // ⚠️ `total` 只累加货币单位，`次` 的包不加 —— 上面的循环已保证。
  return { total, packages, expiredTotal }
}

// ── 处理器工厂（与 `channel-pack-rpc.ts` 协作）──
//
// ⚠️ 这些形参**必须真的传下去**。早期实现收下 `_product` 却把 `{} as TraeProduct`
// 塞给下游 —— 于是 header 退回 CN 形态、`App-Version: undefined`，
// 国际版账号余额恒为 null。

export function makeTraeCheckinStatusHandler(product: TraeProduct) {
  return async (credential: TraeCredential) => fetchTraeCheckinStatus(credential, product)
}

export function makeTraeClaimHandler(product: TraeProduct) {
  return async (credential: TraeCredential) => claimTraeDailyCheckin(credential, product)
}

export function makeTraeBalanceHandler(product: TraeProduct) {
  return async (credential: TraeCredential) => fetchTraeCreditBalance(credential, product)
}
