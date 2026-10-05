import { describe, expect, test } from 'vitest'
import { crc32, createZip } from './index.ts'

describe('zip', () => {
  test('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  test('stores entries uncompressed with a central directory', () => {
    const data = new TextEncoder().encode('hello')
    const zip = createZip([{ name: 'a/b.txt', data }])
    const view = new DataView(zip.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(new TextDecoder().decode(zip.slice(37, 42))).toBe('hello')
    const end = zip.length - 22
    expect(view.getUint32(end, true)).toBe(0x06054b50)
    expect(view.getUint16(end + 10, true)).toBe(1)
    expect(view.getUint32(end + 16, true)).toBe(42) // central directory offset
    expect(createZip([{ name: 'a/b.txt', data }])).toEqual(zip)
  })
})
