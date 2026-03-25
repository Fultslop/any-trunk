// apps/hunt/hunt.js
import { WorkerGitHubStore } from '../../lib/github-store-worker.js'
import { GoogleDriveStore }   from '../../lib/google-drive-store.js'
import { LocalStore }         from '../../lib/local-store.js'
import { renderServiceSelect } from './views/service-select.js'
import { renderSpaceList }     from './views/space-list.js'
import { renderHuntEditor }    from './views/hunt-editor.js'
import { renderLocationForm }  from './views/location-form.js'

// ── CONFIG — edit this section to use the app ────────────────────────────────

const SERVICES = [
  {
    id:         'github',
    label:      'GitHub',
    icon:       '🐙',
    faviconUrl: 'https://github.com/favicon.ico',
    hint:       'Version-controlled. Needs a GitHub account.',
    Store:      WorkerGitHubStore,
    config:     { clientId: '<CLIENT_ID>', workerUrl: '<WORKER_URL>' },
  },
  {
    id:         'google-drive',
    label:      'Google Drive',
    icon:       '📁',
    faviconUrl: 'https://drive.google.com/favicon.ico',
    hint:       'Easy sharing. Needs a Google account.',
    Store:      GoogleDriveStore,
    config:     { clientId: '<CLIENT_ID>', clientSecret: '<CLIENT_SECRET>' },
  },
  {
    id:         'local',
    label:      'Local Files',
    icon:       '📂',
    faviconUrl: null,
    hint:       'Saves to a folder on your computer. For testing purposes only.',
    Store:      LocalStore,
    config:     {},
  },
]

const SCHEMA = {
  hunt: {
    type: 'object',
    properties: {
      name:           { type: 'string',  title: 'Hunt name'       },
      country:        { type: 'string',  title: 'Country'         },
      flag:           { type: 'string',  title: 'Flag emoji'      },
      description:    { type: 'string',  title: 'Description'     },
      walkTime:       { type: 'string',  title: 'Walk time'       },
      suggestedRoute: { type: 'string',  title: 'Suggested route' },
    },
    required: ['name'],
  },
  location: {
    type: 'object',
    properties: {
      name:         { type: 'string',  title: 'Location name' },
      neighborhood: { type: 'string',  title: 'Neighborhood'  },
      coords:       { type: 'string',  title: 'Coordinates'   },
      clue:         { type: 'string',  title: 'Clue'          },
      challenge:    { type: 'string',  title: 'Challenge'     },
      points:       { type: 'number',  title: 'Points'        },
      badge:        { type: 'string',  title: 'Badge'         },
      isFinal:      { type: 'boolean', title: 'Final stop?'   },
    },
    required: ['name', 'clue'],
  },
}

// ─────────────────────────────────────────────────────────────────────────────

const VIEWS = {
  'service-select': renderServiceSelect,
  'space-list':     renderSpaceList,
  'hunt-editor':    renderHuntEditor,
  'location-form':  renderLocationForm,
}

const container = document.getElementById('app')
let _state = { schema: SCHEMA }

function navigate(viewName, overrides = {}) {
  _state = { ..._state, ...overrides }
  const render = VIEWS[viewName]
  if (!render) throw new Error(`Unknown view: ${viewName}`)
  container.innerHTML = ''
  render(container, _state, navigate)
}

// ── Startup ──────────────────────────────────────────────────────────────────
async function activateStore(store, service) {
  localStorage.setItem('hunt:serviceId', service.id)
  try {
    const registrySpaceId = await store.findOrCreateSpace('anytrunk-hunt')
    navigate('space-list', { store, service, registrySpaceId, services: SERVICES })
  } catch (e) {
    container.innerHTML = `
      <div class="text-center py-16">
        <p class="text-red-600 mb-4">Could not connect to your storage: ${e.message}</p>
        <button onclick="location.reload()"
          class="px-4 py-2 bg-violet-600 text-white rounded">Retry</button>
      </div>`
  }
}

async function start() {
  // Resolve which service to use
  const storedServiceId = localStorage.getItem('hunt:serviceId')
  const service = SERVICES.find(s => s.id === storedServiceId) ??
                  (SERVICES.length === 1 ? SERVICES[0] : null)

  if (!service) {
    navigate('service-select', { services: SERVICES })
    return
  }

  const store = await service.Store.init(service.config)

  if (!store && service.id === 'local') {
    // File System Access APIs require a user gesture — show a connect button
    container.innerHTML = `
      <div class="text-center py-16">
        <p class="text-gray-600 mb-4">Click below to grant access to your local folder.</p>
        <button id="local-connect"
          class="px-4 py-2 bg-violet-600 text-white rounded">
          Connect to local folder
        </button>
      </div>`
    document.getElementById('local-connect').addEventListener('click', async () => {
      const s = await service.Store.init(service.config, { gesture: true })
      if (s) await activateStore(s, service)
    })
    return
  }

  if (!store) return  // OAuth redirect in progress — page will reload

  await activateStore(store, service)
}

start()
