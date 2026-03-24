function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderOnboardingGate(repoParam, { url, hint, signIn }) {
  const app = document.getElementById('app')
  app.innerHTML = `
    <h1>Gift Registry</h1>
    <p>You've been invited to a gift registry. Do you have a GitHub account?</p>
    <button id="hasAccount">Yes, sign in with GitHub</button>
    <button id="noAccount">No, create a free account</button>
    <p id="hint" style="display:none">${esc(hint)}
      <a href="${esc(url)}" target="_blank">Create account →</a>
    </p>
  `
  document.getElementById('hasAccount').addEventListener('click', () => signIn())
  document.getElementById('noAccount').addEventListener('click', () => {
    document.getElementById('hint').style.display = ''
  })
}

export async function renderParticipant(store, repoParam, inviteCode) {
  const app = document.getElementById('app')
  app.innerHTML = `<p>Joining registry...</p>`

  try {
    await store.join(repoParam, inviteCode)
  } catch (e) {
    app.innerHTML = `<p class="err">Failed to join: ${esc(e.message)}</p>`
    return
  }

  async function renderWishlist(optimisticClaim = null) {
    const wishlist = await store.read('_wishlist.json')
    const participants = await store.readAll()

    // Build claims map: item → first claimant (lexicographically earliest timestamp)
    // readAll returns entries sorted by path, so entries[0] is earliest
    const firstClaims = {}
    const allClaims = {}
    for (const { username, entries } of participants) {
      for (const { data } of entries) {
        if (data?.item) {
          if (!allClaims[data.item]) allClaims[data.item] = []
          allClaims[data.item].push(username)
          // Track first claim by insertion order (entries already sorted by timestamp)
          if (!firstClaims[data.item]) firstClaims[data.item] = username
        }
      }
    }

    // Apply optimistic claim so the UI updates immediately without waiting for GitHub
    if (optimisticClaim && !allClaims[optimisticClaim]) {
      allClaims[optimisticClaim] = [store.userId]
    }

    const items = wishlist?.items ?? []

    app.innerHTML = `
      <h1>Gift Registry</h1>
      <p>Signed in as: <strong>${esc(store.userId)}</strong></p>
      <p>Status: <strong class="badge">joined ✓</strong></p>

      <section>
        <h2>Wishlist</h2>
        <ul id="wishlistItems">
          ${items.map(item => {
            const claimants = allClaims[item] ?? []
            const myClaim = claimants.includes(store.userId)

            let display
            if (claimants.length === 0) {
              display = `<button class="claim-btn" data-item="${esc(item)}">Claim</button>`
            } else if (claimants.length > 1) {
              display = `<span class="conflict">⚠ claimed by ${esc(claimants.join(', '))}</span>`
            } else if (myClaim) {
              display = `<span class="yours">You ✓</span>`
            } else {
              display = `<span class="claimed">claimed by ${esc(claimants[0])}</span>`
            }

            return `<li>${esc(item)} ${display}</li>`
          }).join('')}
        </ul>
      </section>
    `

    document.querySelectorAll('.claim-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const item = btn.dataset.item
        btn.textContent = 'Claiming…'
        btn.disabled = true
        try {
          await store.append({ item }, { prefix: store.userId })
          await renderWishlist(item)
        } catch (e) {
          app.insertAdjacentHTML('beforeend', `<p class="err">${esc(e.message)}</p>`)
          btn.disabled = false
        }
      })
    })

    // Poll every 30s
    clearTimeout(renderWishlist._pollTimer)
    renderWishlist._pollTimer = setTimeout(renderWishlist, 30_000)
  }

  await renderWishlist()
}
