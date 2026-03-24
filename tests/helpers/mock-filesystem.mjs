// tests/helpers/mock-filesystem.mjs
//
// In-memory mock of the File System Access API.
// Implements the subset of the API used by LocalStore.

function domEx(name) {
  const e = new Error(name)
  e.name = name
  return e
}

function createFileNode(name, parentRef) {
  let content = ''
  return {
    kind: 'file',
    name,
    async getFile() {
      return { text: async () => content }
    },
    async createWritable() {
      return {
        async write(str) { content = str },
        async close() {},
      }
    },
    async remove() {
      parentRef._children.delete(name)
    },
  }
}

function createDirNode(name, parentRef) {
  const node = {
    kind: 'directory',
    name,
    _children: new Map(),

    async getDirectoryHandle(childName, { create = false } = {}) {
      if (node._children.has(childName)) {
        const child = node._children.get(childName)
        if (child.kind !== 'directory') throw domEx('TypeMismatchError')
        return child
      }
      if (!create) throw domEx('NotFoundError')
      const child = createDirNode(childName, node)
      node._children.set(childName, child)
      return child
    },

    async getFileHandle(childName, { create = false } = {}) {
      if (node._children.has(childName)) {
        const child = node._children.get(childName)
        if (child.kind !== 'file') throw domEx('TypeMismatchError')
        return child
      }
      if (!create) throw domEx('NotFoundError')
      const child = createFileNode(childName, node)
      node._children.set(childName, child)
      return child
    },

    async *values() {
      for (const [childName, child] of node._children) {
        yield { name: childName, kind: child.kind }
      }
    },

    async remove({ recursive = false } = {}) {
      if (!recursive && node._children.size > 0) throw domEx('InvalidModificationError')
      if (recursive) node._children.clear()
      if (parentRef) parentRef._children.delete(name)
    },

    async queryPermission() { return 'granted' },
    async requestPermission() { return 'granted' },
  }
  return node
}

/**
 * Create an in-memory root directory handle for use in tests.
 * Pass the returned handle as `_rootHandle` to `LocalStore.init()`.
 */
export function createMockFilesystem(name = 'test-root') {
  return createDirNode(name, null)
}

/**
 * Override `global.showDirectoryPicker` to return the given handle.
 * Call in tests that exercise the picker path of `LocalStore.init()`.
 */
export function mockPicker(handle) {
  global.showDirectoryPicker = async () => handle
}
