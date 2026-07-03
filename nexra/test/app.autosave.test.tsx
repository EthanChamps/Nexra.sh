import { describe, it, expect, vi, beforeEach } from 'vitest'
import { persistDelete } from '../src/App'
import { initialUI } from '../src/state/reducer'
import type { AppState } from '../src/state/selectors'

describe('renderer persistence side-effects', () => {
  beforeEach(() => {
    ;(globalThis as any).window = globalThis as any
    ;(window as any).nexra = {
      store: { snapshot: vi.fn().mockResolvedValue({ companies: [], types: {} }), save: vi.fn(), deleteCompany: vi.fn(), deleteChat: vi.fn() },
      findings: { list: vi.fn().mockResolvedValue([]) },
    }
  })
  it('confirmDeleteCompany fires store.deleteCompany with the id', () => {
    const state: AppState = { data: { companies: [], types: {} as any }, ui: { ...initialUI, confirmDeleteCompanyId: 'c1' } }
    persistDelete(state, { t: 'confirmDeleteCompany' })
    expect(window.nexra.store.deleteCompany).toHaveBeenCalledWith('c1')
  })
  it('ctxDelete fires store.deleteChat with the chat id', () => {
    const state: AppState = { data: { companies: [], types: {} as any }, ui: initialUI }
    persistDelete(state, { t: 'ctxDelete', engId: 'e1', chatId: 'ch1' })
    expect(window.nexra.store.deleteChat).toHaveBeenCalledWith('ch1')
  })
  it('does not call deleteCompany when confirmDeleteCompanyId is unset', () => {
    const state: AppState = { data: { companies: [], types: {} as any }, ui: initialUI }
    persistDelete(state, { t: 'confirmDeleteCompany' })
    expect(window.nexra.store.deleteCompany).not.toHaveBeenCalled()
  })
})
