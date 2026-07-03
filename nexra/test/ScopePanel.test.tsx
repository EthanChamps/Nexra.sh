import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ScopePanel } from '../src/components/ScopePanel'

beforeEach(() => {
  ;(window as any).nexra = {
    projectScope: {
      get: vi.fn(() => Promise.resolve({ companyId: 'c1', notes: 'be careful', items: [
        { id: 'i1', type: 'cloud_account', value: '111111111111', source: 'user', addedAt: 1 },
        { id: 'i2', type: 'hostname', value: 'admin.acme.com', source: 'agent', addedAt: 2 },
      ] })),
      add: vi.fn((_c: string, input: any) => Promise.resolve({ id: 'i3', ...input, addedAt: 3 })),
      remove: vi.fn(() => Promise.resolve()),
      setNotes: vi.fn(() => Promise.resolve()),
    },
  }
})

describe('ScopePanel', () => {
  it('lists items and notes for the company', async () => {
    render(<ScopePanel companyId="c1" />)
    expect(await screen.findByText('111111111111')).toBeTruthy()
    expect(screen.getByText('admin.acme.com')).toBeTruthy()
    expect((screen.getByDisplayValue('be careful'))).toBeTruthy()
    expect((window as any).nexra.projectScope.get).toHaveBeenCalledWith('c1')
  })

  it('adds an item through the IPC bridge', async () => {
    render(<ScopePanel companyId="c1" />)
    await screen.findByText('111111111111')
    fireEvent.change(screen.getByLabelText('New scope value'), { target: { value: '10.0.0.0/8' } })
    fireEvent.change(screen.getByLabelText('New scope type'), { target: { value: 'cidr' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect((window as any).nexra.projectScope.add).toHaveBeenCalledWith('c1', { type: 'cidr', value: '10.0.0.0/8', source: 'user' }))
  })

  it('removes an item through the IPC bridge', async () => {
    render(<ScopePanel companyId="c1" />)
    await screen.findByText('admin.acme.com')
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove scope item' })[1])
    await waitFor(() => expect((window as any).nexra.projectScope.remove).toHaveBeenCalledWith('c1', 'i2'))
  })
})
