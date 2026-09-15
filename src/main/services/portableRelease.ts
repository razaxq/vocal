import { gt, valid } from 'semver'

export interface PortableRelease {
  version: string
  url: string
  size: number
  sha256: string
}

/** 只接受当前仓库发布的 x64 ZIP，下载后还要核对 GitHub 给出的摘要。 */
export function selectPortableRelease(value: unknown, current: string, repository: string): PortableRelease | null {
  const r = value as {
    tag_name?: string; draft?: boolean; prerelease?: boolean
    assets?: Array<{ name: string; browser_download_url: string; size: number; digest?: string }>
  }
  const version = valid(r.tag_name)
  if (r.draft || r.prerelease || !version || !gt(version, current)) return null
  const assets = r.assets?.filter((a) => /^Vocal-.*-win\.zip$/i.test(a.name) && !/arm64|ia32/i.test(a.name)) ?? []
  if (assets.length !== 1) throw new Error('新版本的更新文件尚未准备好，请稍后重试')
  const asset = assets[0]!
  const prefix = `https://github.com/${repository}/releases/download/`
  if (!asset.browser_download_url.startsWith(prefix) || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest ?? '')) {
    throw new Error('更新文件缺少有效的校验信息，请稍后重试')
  }
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0) throw new Error('更新文件大小无效')
  return { version, url: asset.browser_download_url, size: asset.size, sha256: asset.digest!.slice(7).toLowerCase() }
}
