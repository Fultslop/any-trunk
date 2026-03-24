// apps/hunt/views/service-select.js

export function renderServiceSelect(container, state, navigate) {
  const { services } = state
  let selectedService = services[0]

  function render() {
    container.innerHTML = `
      <div class="text-center mb-8">
        <h1 class="text-2xl font-bold text-gray-900">Where do you want to save your hunt?</h1>
        <p class="text-gray-500 text-sm mt-1">You can switch at any time.</p>
      </div>
      <div class="flex flex-col gap-3 mb-6">
        ${services.map(s => `
          <button data-service-id="${s.id}"
            class="service-card flex items-center gap-4 border-2 rounded-lg p-4 text-left transition-colors
              ${s.id === selectedService.id
                ? 'border-violet-600 bg-violet-50'
                : 'border-gray-200 bg-white hover:border-gray-300'}">
            <span class="text-2xl">${s.icon}</span>
            <div>
              <div class="font-semibold text-sm">${s.label}</div>
              <div class="text-xs text-gray-500">${s.hint}</div>
            </div>
            ${s.id === selectedService.id
              ? '<span class="ml-auto text-xs font-semibold text-violet-600">Selected ✓</span>'
              : ''}
          </button>
        `).join('')}
      </div>
      <button id="continue-btn"
        class="w-full py-3 bg-violet-600 text-white font-semibold rounded-lg hover:bg-violet-700">
        Continue with ${selectedService.label} →
      </button>
      <div id="error-msg" class="mt-4 text-red-600 text-sm text-center hidden"></div>`

    container.querySelectorAll('.service-card').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedService = services.find(s => s.id === btn.dataset.serviceId)
        render()
      })
    })

    container.querySelector('#continue-btn').addEventListener('click', handleContinue)
  }

  async function handleContinue() {
    const btn = container.querySelector('#continue-btn')
    const errEl = container.querySelector('#error-msg')
    btn.disabled = true
    btn.textContent = 'Connecting…'
    errEl.classList.add('hidden')

    try {
      const store = await selectedService.Store.init(selectedService.config)
      if (!store) return  // OAuth redirect — page will reload
      localStorage.setItem('hunt:serviceId', selectedService.id)
      const registrySpaceId = await store.findOrCreateSpace('anytrunk-hunt')
      navigate('space-list', { store, service: selectedService, registrySpaceId })
    } catch (e) {
      errEl.textContent = e.message
      errEl.classList.remove('hidden')
      btn.disabled = false
      btn.textContent = `Continue with ${selectedService.label} →`
    }
  }

  render()
}
