// apps/hunt/lib/forms.js
// Lightweight schema-driven form renderer (no external dependencies).
// Supports JSON Schema property types: string, number, boolean.

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
  const current = { ...data }
  const root = document.createElement('div')
  root.className = 'jf-form space-y-3'

  const props = schema.properties ?? {}
  const required = new Set(schema.required ?? [])

  for (const [key, def] of Object.entries(props)) {
    const label = document.createElement('label')
    label.className = 'block'

    const labelText = document.createElement('span')
    labelText.className = 'block text-sm font-medium text-gray-700 mb-1'
    labelText.textContent = def.title ?? key
    if (required.has(key)) {
      const star = document.createElement('span')
      star.className = 'text-red-500 ml-1'
      star.textContent = '*'
      labelText.appendChild(star)
    }
    label.appendChild(labelText)

    let input
    if (def.type === 'boolean') {
      const wrapper = document.createElement('div')
      wrapper.className = 'flex items-center gap-2'
      input = document.createElement('input')
      input.type = 'checkbox'
      input.className = 'h-4 w-4 text-violet-600'
      input.checked = Boolean(current[key])
      input.addEventListener('change', () => {
        current[key] = input.checked
        onChange({ ...current })
      })
      wrapper.appendChild(input)
      label.appendChild(wrapper)
    } else {
      input = document.createElement('input')
      input.type = def.type === 'number' ? 'number' : 'text'
      input.className = 'w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400'
      input.value = current[key] ?? ''
      input.addEventListener('input', () => {
        current[key] = def.type === 'number' ? (input.value === '' ? undefined : Number(input.value)) : input.value
        onChange({ ...current })
      })
      label.appendChild(input)
    }

    root.appendChild(label)
  }

  container.appendChild(root)
  return () => { container.innerHTML = '' }
}
