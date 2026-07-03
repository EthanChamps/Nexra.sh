import { it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

it('scope: Continue is disabled until Set Scope succeeds, then enabled', async () => {
  ;(window as any).nexra = { ...(window as any).nexra, scope: { setAndValidate: vi.fn(() => Promise.resolve({ success: true })) } }
  const scopeMsg = { id: 'm2', role: 'assistant', kind: 'request', requestKind: 'scope', engagementId: 'e1' }
  render(<RequestCard message={scopeMsg} companyId="co1" onFulfill={() => {}} />)
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Set Scope' }))
  await screen.findByRole('button', { name: 'Scope set' })
  expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
})

it('scope: clicking Continue calls onFulfill exactly once, not automatically on Set Scope', async () => {
  ;(window as any).nexra = { ...(window as any).nexra, scope: { setAndValidate: vi.fn(() => Promise.resolve({ success: true })) } }
  const onFulfill = vi.fn()
  const scopeMsg = { id: 'm2', role: 'assistant', kind: 'request', requestKind: 'scope', engagementId: 'e1' }
  render(<RequestCard message={scopeMsg} companyId="co1" onFulfill={onFulfill} />)
  fireEvent.click(screen.getByRole('button', { name: 'Set Scope' }))
  await screen.findByRole('button', { name: 'Scope set' })
  expect(onFulfill).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(onFulfill).toHaveBeenCalledTimes(1)
})
