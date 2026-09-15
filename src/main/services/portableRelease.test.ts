import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectPortableRelease } from './portableRelease.ts'

const release = () => ({
  tag_name: 'v0.2.0', draft: false, prerelease: false,
  assets: [{ name: 'Vocal-0.2.0-win.zip', size: 100,
    browser_download_url: 'https://github.com/razaxq/vocal/releases/download/v0.2.0/Vocal-0.2.0-win.zip',
    digest: `sha256:${'a'.repeat(64)}` }]
})

test('选择较新的稳定版 ZIP，跳过旧版和预发布版', () => {
  assert.equal(selectPortableRelease(release(), '0.1.0', 'razaxq/vocal')?.version, '0.2.0')
  assert.equal(selectPortableRelease(release(), '0.2.0', 'razaxq/vocal'), null)
  assert.equal(selectPortableRelease({ ...release(), prerelease: true }, '0.1.0', 'razaxq/vocal'), null)
})

test('拒绝缺少摘要、来自其他仓库或有歧义的更新包', () => {
  const noHash = release()
  noHash.assets[0]!.digest = ''
  assert.throws(() => selectPortableRelease(noHash, '0.1.0', 'razaxq/vocal'), /校验/)
  assert.throws(() => selectPortableRelease(release(), '0.1.0', 'other/repo'), /校验/)
  const ambiguous = release()
  ambiguous.assets.push({ ...ambiguous.assets[0]! })
  assert.throws(() => selectPortableRelease(ambiguous, '0.1.0', 'razaxq/vocal'), /准备好/)
})
