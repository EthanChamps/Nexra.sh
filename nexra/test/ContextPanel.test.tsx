import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ContextPanel } from '../src/components/ContextPanel'
import { reducer, initialUI } from '../src/state/reducer'
import { buildSnapshot } from '../electron/services/store.mock'
import { activeChat } from '../src/state/selectors'
import type { Finding } from '../electron/services/store.types'

function mountWithFindings(findings: Finding[]) {
  let s = reducer({ data: buildSnapshot(), ui: initialUI }, { t: 'openCompany', id: 'c1' })
  const chatId = activeChat(s)!.id
  // clear seed findings, then add ours
  activeChat(s)!.findings.length = 0
  for (const f of findings) s = reducer(s, { t: 'upsertFinding', chatId, finding: f })
  const dispatch = () => {}
  return render(<ContextPanel state={s} dispatch={dispatch as any} />)
}

const verified: Finding = { id: 'v1', title: 'Public S3 bucket', sev: 'High', phase: 'Storage', time: 'now', rationale: 'World-readable ACL', verified: true, evidence: [{ kind: 'tool_output', toolCallId: 'tc7', excerpt: 'BucketPublicAccess: true' }] }
const unverified: Finding = { id: 'u1', title: 'Root MFA missing', sev: 'Critical', phase: 'IAM', time: 'now', rationale: 'No hardware MFA', verified: false, evidence: [] }

describe('ContextPanel findings', () => {
  it('shows a verified badge and reveals the tool-output excerpt on expand', () => {
    mountWithFindings([verified])
    fireEvent.click(screen.getByText('findings'))
    expect(screen.getByText(/verified/i)).toBeTruthy()
    fireEvent.click(screen.getByText('Public S3 bucket'))
    expect(screen.getByText(/BucketPublicAccess: true/)).toBeTruthy()
    expect(screen.getByText(/World-readable ACL/)).toBeTruthy()
  })
  it('marks a finding without evidence as unverified', () => {
    mountWithFindings([unverified])
    fireEvent.click(screen.getByText('findings'))
    expect(screen.getByText(/unverified/i)).toBeTruthy()
  })
})

describe('ContextPanel secrets tab', () => {
  it('passes the real company id to SecretsPanel, not the (nonexistent) Engagement.companyId', () => {
    let s = reducer({ data: buildSnapshot(), ui: initialUI }, { t: 'openCompany', id: 'c1' })
    const list = vi.fn(() => Promise.resolve([]))
    ;(window as any).nexra = { secrets: { list } }
    const dispatch = () => {}
    render(<ContextPanel state={s} dispatch={dispatch as any} />)
    fireEvent.click(screen.getByText('secrets'))
    expect(list).toHaveBeenCalledWith('c1')
  })
})
