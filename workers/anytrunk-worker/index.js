// workers/anytrunk-worker/index.js
// Cloudflare Worker — AnyTrunk auth backend
// Endpoints:
//   POST /oauth/token      — exchange GitHub OAuth code for access token
//   POST /spaces/register  — store organizer token, generate invite code (idempotent)
//   POST /spaces/invite    — validate invite code, add collaborator via stored organizer token

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS })
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: CORS })
    }

    let body
    try {
      body = await request.json()
    } catch {
      return new Response('Invalid JSON', { status: 400, headers: CORS })
    }

    const { pathname } = new URL(request.url)
    if (pathname === '/oauth/token')    return handleOAuthToken(body, env)
    if (pathname === '/spaces/register') return handleRegister(body, env)
    if (pathname === '/spaces/invite')   return handleInvite(body, env)
    return new Response('Not found', { status: 404, headers: CORS })
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

async function handleOAuthToken({ code }, env) {
  if (!code) return json({ error: 'missing_code' }, 400)

  const resp = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  })
  const data = await resp.json()
  if (!data.access_token) return json({ error: data.error ?? 'token_exchange_failed' }, 400)
  return json({ access_token: data.access_token })
}

async function handleRegister({ repo, token }, env) {
  if (!repo || !token) return json({ error: 'missing_fields' }, 400)

  // {repo} is URL-encoded to avoid key separator issues across KV implementations
  const key = encodeURIComponent(repo)
  const codeKey  = `repo:${key}:inviteCode`
  const tokenKey = `repo:${key}:token`

  // Idempotent: return existing code if already registered
  const existing = await env.KV.get(codeKey)
  if (existing) return json({ inviteCode: existing })

  const inviteCode = Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  await env.KV.put(tokenKey, token)
  await env.KV.put(codeKey, inviteCode)
  return json({ inviteCode })
}

async function handleInvite({ repo, username, inviteCode }, env) {
  if (!repo || !username || !inviteCode) return json({ error: 'missing_fields' }, 400)

  const key = encodeURIComponent(repo)
  const storedCode = await env.KV.get(`repo:${key}:inviteCode`)
  if (storedCode !== inviteCode) return json({ error: 'invalid_invite_code' }, 403)

  const token = await env.KV.get(`repo:${key}:token`)
  if (!token) return json({ error: 'no_organizer_token' }, 403)

  const [owner, repoName] = repo.split('/')
  const resp = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/collaborators/${username}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ permission: 'push' }),
    }
  )
  // GitHub returns 204 for both new invite and already-a-collaborator — both are success
  if (!resp.ok) {
    const err = await resp.text()
    return json({ error: `github_api_error: ${err}` }, 502)
  }
  return json({ ok: true })
}
