/**
 * Live E2E test — sends a real email via Resend.
 *
 * Requires .env with:
 *   RESEND_API_KEY=re_xxx
 *   DEFAULT_FROM=Name <noreply@yourdomain.com>
 *   TEST_TO=your-email@example.com
 *
 * Run:  bun test test/e2e/live.test.ts
 */
import { describe, expect, test, beforeAll } from 'bun:test'
import { createResendProvider } from '../../src/providers/send/resend'
import { send } from '../../src/core/send'
import { setConfigValue } from '../../src/core/config'

const RESEND_API_KEY = process.env.RESEND_API_KEY
const DEFAULT_FROM = process.env.DEFAULT_FROM
const TEST_TO = process.env.TEST_TO

const skip = !RESEND_API_KEY || !DEFAULT_FROM || !TEST_TO

describe.skipIf(skip)('Live E2E: real email sending', () => {
  beforeAll(() => {
    setConfigValue('resend_api_key', RESEND_API_KEY!)
    setConfigValue('default_from', DEFAULT_FROM!)
  })

  test('send plain text email via Resend provider directly', async () => {
    const provider = createResendProvider(RESEND_API_KEY!)
    const result = await provider.send({
      from: DEFAULT_FROM!,
      to: [TEST_TO!],
      subject: `[mails live test] Plain text — ${new Date().toISOString()}`,
      text: 'This is a live E2E test from the mails CLI. If you received this, the Resend provider is working correctly.',
    })

    console.log(`  Sent plain text email: ${result.id}`)
    expect(result.id).toBeTruthy()
    expect(result.provider).toBe('resend')
  })

  test('send HTML email via Resend provider directly', async () => {
    const provider = createResendProvider(RESEND_API_KEY!)
    const result = await provider.send({
      from: DEFAULT_FROM!,
      to: [TEST_TO!],
      subject: `[mails live test] HTML — ${new Date().toISOString()}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #111;">mails live test</h2>
          <p>This HTML email was sent by the <code>mails</code> CLI E2E test suite.</p>
          <p style="color: #666; font-size: 12px;">Sent at ${new Date().toISOString()}</p>
        </div>
      `,
    })

    console.log(`  Sent HTML email: ${result.id}`)
    expect(result.id).toBeTruthy()
    expect(result.provider).toBe('resend')
  })

  test('send email via unified send() function', async () => {
    const result = await send({
      to: TEST_TO!,
      subject: `[mails live test] SDK send() — ${new Date().toISOString()}`,
      text: 'This email was sent using the mails SDK send() function.',
    })

    console.log(`  Sent via send(): ${result.id}`)
    expect(result.id).toBeTruthy()
    expect(result.provider).toBe('resend')
  })

  test('send email with reply-to', async () => {
    const provider = createResendProvider(RESEND_API_KEY!)
    const result = await provider.send({
      from: DEFAULT_FROM!,
      to: [TEST_TO!],
      subject: `[mails live test] Reply-To — ${new Date().toISOString()}`,
      text: 'This email has a reply-to header set.',
      replyTo: TEST_TO!,
    })

    console.log(`  Sent with reply-to: ${result.id}`)
    expect(result.id).toBeTruthy()
  })
})
