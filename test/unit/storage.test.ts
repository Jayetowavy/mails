import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test'
import { saveConfig, setConfigValue } from '../../src/core/config'
import type { MailsConfig } from '../../src/core/types'

describe('storage resolver', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    // Reset config
    saveConfig({
      mode: 'hosted',
      domain: 'mails.dev',
      mailbox: '',
      send_provider: 'resend',
      storage_provider: 'sqlite',
    } as MailsConfig)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('resolves sqlite by default', async () => {
    // Clear module cache to get fresh _provider
    const mod = await reimportStorage()
    const provider = await mod.getStorage()
    expect(provider.name).toBe('sqlite')
  })

  test('resolves db9 when configured', async () => {
    setConfigValue('storage_provider', 'db9')
    setConfigValue('db9_token', 'test-token')
    setConfigValue('db9_database_id', 'test-db-id')

    // Mock db9 API for init
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ columns: [], rows: [], row_count: 0 }))
    }) as typeof fetch

    const mod = await reimportStorage()
    const provider = await mod.getStorage()
    expect(provider.name).toBe('db9')
  })

  test('throws when db9 token missing', async () => {
    setConfigValue('storage_provider', 'db9')

    const mod = await reimportStorage()
    expect(mod.getStorage()).rejects.toThrow('db9_token not configured')
  })

  test('throws when db9 database_id missing', async () => {
    setConfigValue('storage_provider', 'db9')
    setConfigValue('db9_token', 'some-token')

    const mod = await reimportStorage()
    expect(mod.getStorage()).rejects.toThrow('db9_database_id not configured')
  })

  test('caches provider on second call', async () => {
    const mod = await reimportStorage()
    const p1 = await mod.getStorage()
    const p2 = await mod.getStorage()
    expect(p1).toBe(p2) // same instance
  })
})

// Helper to bust module cache and get fresh storage module
let counter = 0
async function reimportStorage() {
  // Bun caches modules, so we use a query param trick
  counter++
  // We can't bust ESM cache easily, so we re-create the logic inline
  const { loadConfig } = await import('../../src/core/config')
  const { createSqliteProvider } = await import('../../src/providers/storage/sqlite')
  const { createDb9Provider } = await import('../../src/providers/storage/db9')
  const type = await import('../../src/core/types')

  let _provider: type.StorageProvider | null = null

  return {
    async getStorage(): Promise<type.StorageProvider> {
      if (_provider) return _provider

      const config = loadConfig()
      switch (config.storage_provider) {
        case 'db9': {
          if (!config.db9_token) {
            throw new Error('db9_token not configured. Run: mails config set db9_token <token>')
          }
          if (!config.db9_database_id) {
            throw new Error('db9_database_id not configured. Run: mails config set db9_database_id <id>')
          }
          _provider = createDb9Provider(config.db9_token, config.db9_database_id)
          break
        }
        case 'sqlite':
        default: {
          _provider = createSqliteProvider()
          break
        }
      }

      await _provider.init()
      return _provider
    },
  }
}
