export interface IssueEnvironment {
  appVersion: string
  scrcpyVersion: string
  platform: string
  release: string
  arch: string
  bundleName?: string
}

export function buildIssueHelperUrl(environment: IssueEnvironment): string {
  const url = new URL('https://github.com/SimonAKing/scrcpy-gui/issues/new')
  url.searchParams.set('template', 'bug.yml')
  url.searchParams.set('version', environment.appVersion)
  url.searchParams.set('scrcpy-version', environment.scrcpyVersion || 'See diagnostic bundle')
  url.searchParams.set('os', `${environment.platform} ${environment.release} / ${environment.arch}`)
  const attachment = environment.bundleName
    ? `Attach \`${environment.bundleName}\` manually after reviewing its contents.`
    : 'Attach the exported diagnostic bundle manually after reviewing it.'
  url.searchParams.set('diagnostics', `${attachment}\n\nScrcpy GUI did not upload any file or submit this issue.`)
  return url.toString()
}
