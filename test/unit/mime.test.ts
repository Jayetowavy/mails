import { describe, expect, test } from 'bun:test'
import { parseIncomingEmail } from '../../worker/src/mime'

describe('MIME parsing edge cases', () => {
  test('handles email with no attachments', async () => {
    const raw = [
      'From: sender@test.com',
      'Subject: Plain email',
      'Content-Type: text/plain',
      '',
      'Just a plain email body',
    ].join('\r\n')

    const parsed = await parseIncomingEmail(
      new TextEncoder().encode(raw).buffer,
      'plain-1',
      '2026-01-01T00:00:00Z',
    )

    expect(parsed.subject).toBe('Plain email')
    expect(parsed.bodyText).toContain('Just a plain email body')
    expect(parsed.attachmentCount).toBe(0)
    expect(parsed.attachments).toHaveLength(0)
    expect(parsed.attachmentNames).toBe('')
    expect(parsed.attachmentSearchText).toBe('')
  })

  test('handles multipart with HTML body', async () => {
    const raw = [
      'Subject: HTML test',
      'Content-Type: multipart/alternative; boundary="b"',
      '',
      '--b',
      'Content-Type: text/plain',
      '',
      'Text version',
      '--b',
      'Content-Type: text/html',
      '',
      '<h1>HTML version</h1>',
      '--b--',
    ].join('\r\n')

    const parsed = await parseIncomingEmail(
      new TextEncoder().encode(raw).buffer,
      'html-1',
      '2026-01-01T00:00:00Z',
    )

    expect(parsed.bodyText).toContain('Text version')
    expect(parsed.bodyHtml).toContain('HTML version')
  })

  test('extracts headers as record', async () => {
    const raw = [
      'From: sender@test.com',
      'To: recipient@test.com',
      'Subject: Headers test',
      'X-Custom: custom-value',
      'Content-Type: text/plain',
      '',
      'body',
    ].join('\r\n')

    const parsed = await parseIncomingEmail(
      new TextEncoder().encode(raw).buffer,
      'hdr-1',
      '2026-01-01T00:00:00Z',
    )

    expect(parsed.headers['From']).toContain('sender@test.com')
    expect(parsed.headers['X-Custom']).toBe('custom-value')
  })

  test('handles binary attachment as unsupported', async () => {
    const imgData = Buffer.from([0x89, 0x50, 0x4E, 0x47]).toString('base64')
    const raw = [
      'Subject: Image',
      'Content-Type: multipart/mixed; boundary="b"',
      '',
      '--b',
      'Content-Type: text/plain',
      '',
      'Body',
      '--b',
      'Content-Type: image/png; name="photo.png"',
      'Content-Disposition: attachment; filename="photo.png"',
      'Content-Transfer-Encoding: base64',
      '',
      imgData,
      '--b--',
    ].join('\r\n')

    const parsed = await parseIncomingEmail(
      new TextEncoder().encode(raw).buffer,
      'img-1',
      '2026-01-01T00:00:00Z',
    )

    expect(parsed.attachments).toHaveLength(1)
    expect(parsed.attachments[0]!.text_extraction_status).toBe('unsupported')
    expect(parsed.attachments[0]!.text_content).toBe('')
  })

  test('handles email with message-id', async () => {
    const raw = [
      'Subject: With ID',
      'Message-ID: <abc-123@example.com>',
      'Content-Type: text/plain',
      '',
      'body',
    ].join('\r\n')

    const parsed = await parseIncomingEmail(
      new TextEncoder().encode(raw).buffer,
      'mid-1',
      '2026-01-01T00:00:00Z',
    )

    expect(parsed.messageId).toContain('abc-123')
  })

  test('multiple attachments have correct names and indices', async () => {
    const a1 = Buffer.from('file1').toString('base64')
    const a2 = Buffer.from('file2').toString('base64')
    const raw = [
      'Subject: Multi',
      'Content-Type: multipart/mixed; boundary="b"',
      '',
      '--b',
      'Content-Type: text/plain',
      '',
      'Body',
      '--b',
      'Content-Type: text/plain; name="a.txt"',
      'Content-Disposition: attachment; filename="a.txt"',
      'Content-Transfer-Encoding: base64',
      '',
      a1,
      '--b',
      'Content-Type: text/plain; name="b.txt"',
      'Content-Disposition: attachment; filename="b.txt"',
      'Content-Transfer-Encoding: base64',
      '',
      a2,
      '--b--',
    ].join('\r\n')

    const parsed = await parseIncomingEmail(
      new TextEncoder().encode(raw).buffer,
      'multi-1',
      '2026-01-01T00:00:00Z',
    )

    expect(parsed.attachmentCount).toBe(2)
    expect(parsed.attachmentNames).toContain('a.txt')
    expect(parsed.attachmentNames).toContain('b.txt')
    expect(parsed.attachments[0]!.mime_part_index).toBe(0)
    expect(parsed.attachments[1]!.mime_part_index).toBe(1)
  })
})
