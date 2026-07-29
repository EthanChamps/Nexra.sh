import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { Settings } from '../src/components/Settings'

const api = { get: vi.fn(), set: vi.fn(() => Promise.resolve()), setKey: vi.fn(() => Promise.resolve()), testConnection: vi.fn() }
beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ provider: 'ollama', model: 'llama3.3', baseUrl: 'http://localhost:11434', hasKey: false })
  api.set.mockClear(); api.setKey.mockClear(); api.testConnection.mockReset()
  ;(window as any).nexra = { settings: api }
})

describe('Settings persistence', () => {
  it('loads persisted provider on open', async () => {
    render(<Settings state={{} as any} dispatch={() => {}} />)
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    await waitFor(() => expect((screen.getByDisplayValue('Ollama') as HTMLSelectElement)).toBeTruthy())
  })
  it('persists the API key via setKey, never rendering it back', async () => {
    api.get.mockResolvedValue({ provider: 'anthropic', model: 'claude-opus-4-8', baseUrl: 'http://localhost:11434', hasKey: false })
    render(<Settings state={{} as any} dispatch={() => {}} />)
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    const key = await screen.findByPlaceholderText('sk-...')
    // The input starts empty even after get() resolves — a stored key is never rendered back.
    expect(key).toHaveValue('')
    fireEvent.change(key, { target: { value: 'sk-secret' } })
    fireEvent.blur(key)
    await waitFor(() => expect(api.setKey).toHaveBeenCalledWith('anthropic', 'sk-secret'))
  })
  it('shows the masked "(set)" placeholder for a provider that already has a key, never the key', async () => {
    api.get.mockResolvedValue({ provider: 'anthropic', model: 'claude-opus-4-8', baseUrl: 'http://localhost:11434', hasKey: true })
    render(<Settings state={{} as any} dispatch={() => {}} />)
    const key = await screen.findByPlaceholderText('•••••••• (set — type to replace)')
    expect(key).toHaveValue('')
  })

  it('Test connection calls the backend and surfaces the result', async () => {
    api.testConnection.mockResolvedValue({ ok: true, detail: 'Connected — qwen3.5:9b ready' })
    render(<Settings state={{} as any} dispatch={() => {}} />)
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    await waitFor(() => expect(api.testConnection).toHaveBeenCalled())
    expect(await screen.findByText(/Connected — qwen3\.5:9b ready/)).toBeTruthy()
  })

  it('Test connection shows a failure detail when unreachable', async () => {
    api.testConnection.mockResolvedValue({ ok: false, detail: 'Cannot reach model host' })
    render(<Settings state={{} as any} dispatch={() => {}} />)
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(await screen.findByText(/Cannot reach model host/)).toBeTruthy()
  })
})
