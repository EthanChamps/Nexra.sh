import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { Settings } from '../src/components/Settings'

const api = { get: vi.fn(), set: vi.fn(() => Promise.resolve()), setKey: vi.fn(() => Promise.resolve()) }
beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ provider: 'ollama', model: 'llama3.3', baseUrl: 'http://localhost:11434', hasKey: false })
  api.set.mockClear(); api.setKey.mockClear()
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
    fireEvent.change(key, { target: { value: 'sk-secret' } })
    fireEvent.blur(key)
    await waitFor(() => expect(api.setKey).toHaveBeenCalledWith('anthropic', 'sk-secret'))
    expect(api.get).not.toHaveReturnedWith(expect.objectContaining({ apiKey: expect.anything() }))
  })
})
