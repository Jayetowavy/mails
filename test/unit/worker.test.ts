import { describe, expect, test } from 'bun:test'

// Test the worker helper functions by extracting them
// Since worker/src/index.ts exports a default handler, we test the HTTP handlers via fetch simulation

// We can't directly import the worker module (it uses ExportedHandler types),
// so we test the extractBody and parseFromName logic by duplicating the pure functions
// The actual worker integration is tested via wrangler in e2e

describe('worker: MIME body extraction', () => {
  // Duplicated from worker for unit testing (pure functions)
  function extractBody(raw: string): string {
    const plainMatch = raw.match(
      /Content-Type:\s*text\/plain[^\r\n]*\r?\n(?:Content-Transfer-Encoding:[^\r\n]*\r?\n)?(?:\r?\n)([\s\S]*?)(?:\r?\n--|\r?\n\r?\n\S*$)/i
    )
    if (plainMatch) return plainMatch[1]!.trim()
    const headerEnd = raw.indexOf('\r\n\r\n')
    if (headerEnd > 0) return raw.slice(headerEnd + 4).trim()
    return raw
  }

  function extractHtmlBody(raw: string): string {
    const htmlMatch = raw.match(
      /Content-Type:\s*text\/html[^\r\n]*\r?\n(?:Content-Transfer-Encoding:[^\r\n]*\r?\n)?(?:\r?\n)([\s\S]*?)(?:\r?\n--)/i
    )
    if (htmlMatch) return htmlMatch[1]!.trim()
    return ''
  }

  function parseFromName(from: string): string {
    const match = from.match(/^"?([^"<]+)"?\s*</)
    return match ? match[1]!.trim() : ''
  }

  test('extracts plain text from multipart MIME', () => {
    const raw = `From: sender@test.com\r\nContent-Type: multipart/alternative; boundary="boundary"\r\n\r\n--boundary\r\nContent-Type: text/plain\r\n\r\nHello World\r\n--boundary\r\nContent-Type: text/html\r\n\r\n<p>Hello World</p>\r\n--boundary--`
    expect(extractBody(raw)).toBe('Hello World')
  })

  test('extracts HTML body from multipart MIME', () => {
    const raw = `Content-Type: multipart/alternative; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nPlain\r\n--b\r\nContent-Type: text/html\r\n\r\n<h1>HTML</h1>\r\n--b--`
    expect(extractHtmlBody(raw)).toBe('<h1>HTML</h1>')
  })

  test('falls back to body after headers', () => {
    const raw = `From: sender@test.com\r\nSubject: Test\r\n\r\nSimple body text`
    expect(extractBody(raw)).toBe('Simple body text')
  })

  test('returns raw string when no headers found', () => {
    expect(extractBody('No headers at all')).toBe('No headers at all')
  })

  test('returns empty string when no HTML part', () => {
    const raw = `Content-Type: text/plain\r\n\r\nPlain only`
    expect(extractHtmlBody(raw)).toBe('')
  })

  test('parseFromName extracts display name', () => {
    expect(parseFromName('John Doe <john@test.com>')).toBe('John Doe')
    expect(parseFromName('"Jane Smith" <jane@test.com>')).toBe('Jane Smith')
  })

  test('parseFromName returns empty for bare address', () => {
    expect(parseFromName('user@test.com')).toBe('')
  })
})
