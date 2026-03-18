import { describe, expect, test } from 'bun:test'
import { existsSync, writeFileSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { prepareSendAttachments } from '../../src/core/send-attachments'

const TMP = join(tmpdir(), 'mails-attach-test')

describe('prepareSendAttachments', () => {
  test('returns undefined for undefined', async () => {
    expect(await prepareSendAttachments(undefined)).toBeUndefined()
  })

  test('returns undefined for empty array', async () => {
    expect(await prepareSendAttachments([])).toBeUndefined()
  })

  test('prepares attachment from file path', async () => {
    mkdirSync(TMP, { recursive: true })
    const file = join(TMP, 'test.txt')
    writeFileSync(file, 'hello world')

    try {
      const result = await prepareSendAttachments([{ path: file }])
      expect(result).toHaveLength(1)
      expect(result[0]!.filename).toBe('test.txt')
      expect(result[0]!.content).toBeTruthy()
    } finally {
      rmSync(TMP, { recursive: true, force: true })
    }
  })

  test('prepares attachment from base64 content', async () => {
    const content = Buffer.from('test data').toString('base64')
    const result = await prepareSendAttachments([{
      filename: 'data.bin',
      content,
      contentType: 'application/octet-stream',
    }])

    expect(result).toHaveLength(1)
    expect(result[0]!.filename).toBe('data.bin')
    expect(result[0]!.content).toBe(content)
    expect(result[0]!.contentType).toBe('application/octet-stream')
  })

  test('prepares attachment from string content', async () => {
    const result = await prepareSendAttachments([{
      filename: 'note.txt',
      content: 'plain text content',
    }])

    expect(result).toHaveLength(1)
    expect(result[0]!.filename).toBe('note.txt')
  })

  test('prepares attachment from ArrayBuffer', async () => {
    const buf = new TextEncoder().encode('arraybuffer data').buffer
    const result = await prepareSendAttachments([{
      filename: 'buf.bin',
      content: buf,
    }])

    expect(result).toHaveLength(1)
    expect(result[0]!.filename).toBe('buf.bin')
  })

  test('prepares attachment from Uint8Array', async () => {
    const arr = new TextEncoder().encode('uint8 data')
    const result = await prepareSendAttachments([{
      filename: 'arr.bin',
      content: arr,
    }])

    expect(result).toHaveLength(1)
  })

  test('includes contentId when provided', async () => {
    const result = await prepareSendAttachments([{
      filename: 'inline.png',
      content: 'base64data',
      contentId: 'cid-123',
    }])

    expect(result[0]!.contentId).toBe('cid-123')
  })

  test('throws for attachment with no content or path', async () => {
    expect(prepareSendAttachments([{ filename: 'empty.txt' }])).rejects.toThrow()
  })
})
