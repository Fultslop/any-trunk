// apps/hunt/lib/forms.js
// JSON Forms vanilla wrapper.
// Requires: index.html loads @jsonforms/vanilla-renderers CSS via unpkg.
import { createStore, defaultMiddleware } from 'https://esm.sh/@jsonforms/core'
import { VanillaRendererRegistryEntry, vanillaRenderers }
  from 'https://esm.sh/@jsonforms/vanilla-renderers'

/**
 * Render a JSON Schema form into `container`.
 *
 * @param {HTMLElement} container - Target DOM element. Will be cleared and populated.
 * @param {object}      schema    - JSON Schema describing the data shape.
 * @param {object}      data      - Initial data (or {} for a new form).
 * @param {function}    onChange  - Called with the latest data on every change.
 * @returns {function}  dispose   - Call to unmount the form (clears the container).
 */
export function renderForm(container, schema, data, onChange) {
  // Wrap container for scoped CSS
  const root = document.createElement('div')
  root.className = 'jf-form'
  container.appendChild(root)

  const store = createStore(
    (state = { data, errors: [] }, action) => {
      const next = defaultMiddleware(state, action, vanillaRenderers)
      if (next.data !== state.data) onChange({ ...next.data })
      return next
    },
    { data, schema, uischema: undefined, renderers: vanillaRenderers }
  )

  // JSON Forms vanilla mounts directly into the DOM element
  import('https://esm.sh/@jsonforms/vanilla-renderers').then(({ mountForm }) => {
    mountForm(root, store)
  })

  return () => { container.innerHTML = '' }
}
