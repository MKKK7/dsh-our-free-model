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
