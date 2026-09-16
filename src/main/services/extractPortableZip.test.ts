import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { crc32, deflateRawSync } from 'node:zlib'
import { extractPortableZip } from './extractPortableZip.ts'

interface ZipEntry { name: string; data?: string; mode?: number; deflate?: boolean; declaredSize?: number }

// Construct ZIP bytes directly so invalid names, symlinks and duplicate entries survive fixture creation.
function zipBytes(entries: ZipEntry[]): Buffer {
  const files: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const data = Buffer.from(entry.data ?? '')
    const compressed = entry.deflate ? deflateRawSync(data) : data
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8)
    local.writeUInt32LE(crc32(data), 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.declaredSize ?? data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50, 0)
    record.writeUInt16LE(0x314, 4)
    local.copy(record, 6, 4, 30)
    record.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38)
    record.writeUInt32LE(offset, 42)
    files.push(local, name, compressed)
    central.push(record, name)
    offset += local.length + name.length + compressed.length
  }
  const index = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(index.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...files, index, end])
}

async function fixture(t: TestContext, entries: ZipEntry[]) {
  const root = await mkdtemp(join(tmpdir(), 'vocal-zip-'))
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(basename(root).startsWith('vocal-zip-'))
    await rm(root, { recursive: true, force: true })
  })
  const archive = join(root, 'update.zip')
  const payload = join(root, 'payload')
  await writeFile(archive, zipBytes(entries))
  return { root, archive, payload }
}

test('正常更新包流式解压，支持目录、压缩数据及中文文件名', async t => {
  const f = await fixture(t, [
    { name: 'Vocal.exe', data: 'new exe' },
    { name: 'resources/', mode: 0o040755 },
    { name: 'resources/app.asar', data: 'new app'.repeat(1000), deflate: true },
    { name: 'resources/说明.txt', data: '测试内容', deflate: true }
  ])
  await extractPortableZip(f.archive, f.payload)
  assert.equal(await readFile(join(f.payload, 'Vocal.exe'), 'utf8'), 'new exe')
  assert.equal(await readFile(join(f.payload, 'resources', 'app.asar'), 'utf8'), 'new app'.repeat(1000))
  assert.equal(await readFile(join(f.payload, 'resources', '说明.txt'), 'utf8'), '测试内容')
})

for (const entries of [
  [{ name: 'link', data: '../outside.txt', mode: 0o120777 }],
  [{ name: 'link', data: '../outside.txt', mode: 0o120777 }, { name: 'link', data: 'overwritten' }],
  [{ name: 'link', data: '..', mode: 0o120777 }, { name: 'link/outside.txt', data: 'overwritten' }]
]) {
  test(`拒绝恶意符号链接（${entries.length} 个条目，末项 ${entries.at(-1)!.name}），目录外文件不变`, async t => {
    const f = await fixture(t, entries)
    const outside = join(f.root, 'outside.txt')
    await writeFile(outside, 'keep')
    await assert.rejects(extractPortableZip(f.archive, f.payload), /符号链接/)
    assert.equal(await readFile(outside, 'utf8'), 'keep')
    assert.deepEqual(await readdir(f.payload), [])
  })
}

for (const name of ['../outside.txt', '/outside.txt', 'C:/outside.txt', 'dir\\outside.txt',
  'dir/../../outside.txt', 'dir/./file', 'dir//file', 'file:stream', 'file.', 'dir /file',
  'NUL.txt', 'COM1', 'LPT¹.txt', 'CONOUT$', 'data/config.json', 'DATA/model.onnx', '.vocal-update-other/file']) {
  test(`拒绝越界或 Windows 特殊路径：${name}`, async t => {
    const f = await fixture(t, [{ name, data: 'bad' }])
    await writeFile(join(f.root, 'outside.txt'), 'keep')
    await assert.rejects(extractPortableZip(f.archive, f.payload))
    assert.equal(await readFile(join(f.root, 'outside.txt'), 'utf8'), 'keep')
    assert.deepEqual(await readdir(f.payload), [])
  })
}

test('同名和仅大小写不同的文件均拒绝覆盖', async t => {
  for (const duplicate of ['Vocal.exe', 'VOCAL.EXE']) {
    const f = await fixture(t, [{ name: 'Vocal.exe', data: 'first' }, { name: duplicate, data: 'second' }])
    await assert.rejects(extractPortableZip(f.archive, f.payload), /重复路径/)
    assert.equal(await readFile(join(f.payload, 'Vocal.exe'), 'utf8'), 'first')
  }
})

test('拒绝复用已有暂存目录，包括目录联接', async t => {
  const f = await fixture(t, [{ name: 'Vocal.exe', data: 'new' }])
  const outside = join(f.root, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'Vocal.exe'), 'keep')
  await symlink(outside, f.payload, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(extractPortableZip(f.archive, f.payload), /EEXIST/)
  assert.equal(await readFile(join(outside, 'Vocal.exe'), 'utf8'), 'keep')
})

test('拒绝特殊文件及解压后大小不符的压缩包', async t => {
  const special = await fixture(t, [{ name: 'pipe', mode: 0o010644 }])
  await assert.rejects(extractPortableZip(special.archive, special.payload), /特殊文件/)
  const corrupt = await fixture(t, [{ name: 'Vocal.exe', data: 'payload', deflate: true, declaredSize: 2 }])
  await assert.rejects(extractPortableZip(corrupt.archive, corrupt.payload))
})
