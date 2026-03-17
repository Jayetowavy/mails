import { describe, expect, test, mock, afterEach } from 'bun:test'
import { setConfigValue, loadConfig, saveConfig } from '../../src/core/config'

describe('CLI: send command', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('send command parses args correctly', async () => {
    // Setup config
    setConfigValue('resend_api_key', 're_test')
    setConfigValue('default_from', 'Bot <bot@test.com>')

    let sentBody: Record<string, unknown> = {}
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string)
      return new Response(JSON.stringify({ id: 'msg_cli' }))
    }) as typeof fetch

    // Import and call directly
    const { send } = await import('../../src/core/send')
    const result = await send({
      to: 'user@example.com',
      subject: 'CLI Test',
      text: 'Hello from CLI',
    })

    expect(sentBody.to).toEqual(['user@example.com'])
    expect(sentBody.subject).toBe('CLI Test')
    expect(sentBody.text).toBe('Hello from CLI')
    expect(result.id).toBe('msg_cli')
  })
})

describe('CLI: config command', () => {
  test('config set and get work', () => {
    setConfigValue('domain', 'cli-test.com')
    const { getConfigValue } = require('../../src/core/config')
    expect(getConfigValue('domain')).toBe('cli-test.com')
  })

  test('config loads defaults for missing file', () => {
    const config = loadConfig()
    expect(config.mode).toBe('hosted')
    expect(config.send_provider).toBe('resend')
  })
})

describe('CLI: help command', () => {
  test('helpCommand outputs text', () => {
    const { helpCommand } = require('../../src/cli/commands/help')
    // Just verify it doesn't throw
    const originalLog = console.log
    let output = ''
    console.log = (msg: string) => { output = msg }
    helpCommand()
    console.log = originalLog
    expect(output).toContain('mails')
    expect(output).toContain('send')
    expect(output).toContain('inbox')
    expect(output).toContain('code')
    expect(output).toContain('config')
    expect(output).toContain('mails.dev')
  })
})
