import { describe, it, expect } from 'vitest'
import { WEB_SKILLS, dockerRun, skillsForEngagement } from '../electron/services/agent.tools'

describe('dockerRun', () => {
  it('builds a docker run that passes an env NAME (not value) and the target positionally', () => {
    const built = dockerRun({ image: 'projectdiscovery/nuclei:v3', script: 'nuclei -u "$1" -jsonl', positional: ['https://app.acme.com'], envPassthrough: ['WEB_AUTH_HEADER'] })
    expect(built.command).toBe('docker')
    expect(built.args.slice(0, 2)).toEqual(['run', '--rm'])
    expect(built.args).toEqual(expect.arrayContaining(['-e', 'WEB_AUTH_HEADER']))
    expect(built.args).toContain('https://app.acme.com')
    expect(built.args).toContain('--entrypoint'); expect(built.args).toContain('sh')
  })
  it('applies blast-radius hardening flags to every container', () => {
    const built = dockerRun({ image: 'x', script: 'true', positional: [] })
    const j = built.args.join(' ')
    expect(j).toContain('--cap-drop ALL')
    expect(j).toContain('--security-opt no-new-privileges')
    expect(built.args).toEqual(expect.arrayContaining(['--pids-limit', '512']))
  })
})

describe('WEB_SKILLS', () => {
  it('resolves for web engagements', () => { expect(skillsForEngagement('web')).toBe(WEB_SKILLS) })
  it('web_probe targets the given url via httpx', () => {
    const b = WEB_SKILLS.web_probe.build({ skill: 'web_probe', companyId: 'c', engagementId: 'e', url: 'https://app.acme.com' })
    expect(b.command).toBe('docker')
    expect(b.args.join(' ')).toContain('https://app.acme.com')
    expect(b.args.join(' ')).toContain('httpx')
  })
  it('web_scan runs nuclei and passes the session header via env passthrough (name only)', () => {
    const b = WEB_SKILLS.web_scan.build({ skill: 'web_scan', companyId: 'c', engagementId: 'e', url: 'https://app.acme.com' })
    expect(b.args).toEqual(expect.arrayContaining(['-e', 'WEB_AUTH_HEADER']))
    expect(b.args.join(' ')).toContain('nuclei')
    expect(b.args.join(' ')).not.toMatch(/Bearer|Cookie:/i)
  })
})

describe('WEB_SKILLS (full pack)', () => {
  const inv = (skill: string) => ({ skill, companyId: 'c', engagementId: 'e', url: 'https://app.acme.com' })
  it('exposes all six skills', () => {
    expect(Object.keys(WEB_SKILLS).sort()).toEqual(
      ['web_content_discovery', 'web_crawl', 'web_headers_tls', 'web_probe', 'web_scan', 'web_sqli'])
  })
  it('web_content_discovery mounts a read-only wordlist volume', () => {
    const b = WEB_SKILLS.web_content_discovery.build(inv('web_content_discovery') as any)
    expect(b.args).toContain('-v')
    expect(b.args.join(' ')).toMatch(/:ro\b/)
    expect(b.args.join(' ')).toContain('ffuf')
  })
  it('web_sqli lives behind Verify and runs sqlmap on the url', () => {
    const b = WEB_SKILLS.web_sqli.build(inv('web_sqli') as any)
    expect(b.args.join(' ')).toContain('sqlmap')
    expect(b.args.join(' ')).toContain('https://app.acme.com')
  })
})
