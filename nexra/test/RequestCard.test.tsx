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

it('calls onFulfill once all REQUIRED items are saved (optionals may stay blank)', async () => {
  const onFulfill = vi.fn()
  render(<RequestCard message={msg} companyId="co1" onFulfill={onFulfill} />)
  const input = screen.getByLabelText('AWS access key')       // the only required item
  fireEvent.change(input, { target: { value: 'AKIA-1' } })
  fireEvent.blur(input)
  await Promise.resolve(); await Promise.resolve()
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
