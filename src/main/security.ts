export const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

export function isTrustedRendererUrl(candidate: string, packagedEntry: string, devRendererUrl?: string): boolean {
  try {
    const actual = new URL(candidate)
    if (devRendererUrl) {
      const expected = new URL(devRendererUrl)
      return (
        (expected.protocol === 'http:' || expected.protocol === 'https:') &&
        actual.protocol === expected.protocol &&
        actual.origin === expected.origin
      )
    }

    const expected = new URL(packagedEntry)
    actual.hash = ''
    expected.hash = ''
    return actual.protocol === 'file:' && actual.href === expected.href
  } catch {
    return false
  }
}
