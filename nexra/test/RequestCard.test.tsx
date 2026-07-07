import { it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RequestCard } from '../src/components/RequestCard'

const items = [
  { key: 'AWS_ACCESS_KEY_ID', label: 'AWS access key', sensitive: true, required: true },
  { key: 'REGION', label: 'Target region', sensitive: false, required: false },
]
const msg = { id: 'm1', role: 'assistant', kind: 'request', requestKind: 'inputs', requestId: 'r1', items }

let fulfill: ReturnType<typeof vi.fn>
beforeEach(() => {
  fulfill = vi.fn(() => Promise.resolve({ success: true }))
  ;(window as any).nexra = { inputs: { fulfill } }
})

it('renders a masked input for sensitive items and a plain input for non-secret ones', () => {
  render(<RequestCard message={msg} companyId="co1" onFulfill={() => {}} />)
  expect((screen.getByLabelText('AWS access key') as HTMLInputElement).type).toBe('password')
  expect((screen.getByLabelText('Target region') as HTMLInputElement).type).toBe('text')
})

it('auto-saves a field on blur with its sensitivity', async () => {
  render(<RequestCard message={msg} companyId="co1" onFulfill={() => {}} />)
  const input = screen.getByLabelText('AWS access key')
  fireEvent.change(input, { target: { value: 'AKIA-1' } })
  fireEvent.blur(input)
  expect(fulfill).toHaveBeenCalledWith('co1', 'AWS_ACCESS_KEY_ID', 'AKIA-1', true)
})

it('does NOT auto-continue once required items are saved — shows an enabled Continue button instead', async () => {
  const onFulfill = vi.fn()
  render(<RequestCard message={msg} companyId="co1" onFulfill={onFulfill} />)
  const input = screen.getByLabelText('AWS access key')       // the only required item
  fireEvent.change(input, { target: { value: 'AKIA-1' } })
  fireEvent.blur(input)
  await Promise.resolve(); await Promise.resolve()
  expect(onFulfill).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
})

it('Continue is disabled until all required fields are filled (optional REGION may stay blank)', () => {
  render(<RequestCard message={msg} companyId="co1" onFulfill={() => {}} />)
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
})

it('clicking Continue calls onFulfill exactly once even on a rapid double-click', async () => {
  const onFulfill = vi.fn()
  render(<RequestCard message={msg} companyId="co1" onFulfill={onFulfill} />)
  const input = screen.getByLabelText('AWS access key')
  fireEvent.change(input, { target: { value: 'AKIA-1' } })
  fireEvent.blur(input)
  await Promise.resolve(); await Promise.resolve()
  const continueBtn = screen.getByRole('button', { name: 'Continue' })
  fireEvent.click(continueBtn)
  fireEvent.click(continueBtn)
  expect(onFulfill).toHaveBeenCalledTimes(1)
})

it('toggling "not a secret" unmasks the field and saves it as non-sensitive', async () => {
  render(<RequestCard message={msg} companyId="co1" onFulfill={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /not a secret/i }))   // on the AWS row
  const input = screen.getByLabelText('AWS access key') as HTMLInputElement
  expect(input.type).toBe('text')
  fireEvent.change(input, { target: { value: 'plain' } })
  fireEvent.blur(input)
  expect(fulfill).toHaveBeenCalledWith('co1', 'AWS_ACCESS_KEY_ID', 'plain', false)
})

it('scope_proposal: prefills the proposed item, adds on confirm, resumes with "added"', async () => {
  const add = vi.fn(() => Promise.resolve({ id: 'i9' }))
  ;(window as any).nexra = { projectScope: { add } }
  const onScopeResolve = vi.fn()
  const msg = { id: 'p1', role: 'assistant', kind: 'request', requestKind: 'scope_proposal', proposeItem: { type: 'hostname', value: 'admin.acme.com' } }
  render(<RequestCard message={msg} companyId="co1" onFulfill={() => {}} onScopeResolve={onScopeResolve} />)
  expect((screen.getByLabelText('Proposed scope value') as HTMLInputElement).value).toBe('admin.acme.com')
  fireEvent.click(screen.getByRole('button', { name: 'Add to scope' }))
  await waitFor(() => expect(add).toHaveBeenCalledWith('co1', { type: 'hostname', value: 'admin.acme.com', source: 'agent' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
  expect(onScopeResolve).toHaveBeenCalledWith('added')
})

it('scope_proposal: Decline resumes with "declined" and does not add', () => {
  const add = vi.fn()
  ;(window as any).nexra = { projectScope: { add } }
  const onScopeResolve = vi.fn()
  const msg = { id: 'p2', role: 'assistant', kind: 'request', requestKind: 'scope_proposal', proposeItem: { type: 'ip', value: '10.0.0.9' } }
  render(<RequestCard message={msg} companyId="co1" onFulfill={() => {}} onScopeResolve={onScopeResolve} />)
  fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
  expect(add).not.toHaveBeenCalled()
  expect(onScopeResolve).toHaveBeenCalledWith('declined')
})
