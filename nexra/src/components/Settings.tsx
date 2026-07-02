import type { CSSProperties, Dispatch } from 'react'
import { useEffect, useState } from 'react'
import { Hoverable } from './Hoverable'
import { theme } from '../theme'
import type { AppState } from '../state/selectors'
import type { Action } from '../state/reducer'

type ProviderId = 'anthropic' | 'openai' | 'google' | 'ollama'

interface ProviderConfig {
  label: string
  models: string[]
  defaultModel: string
}

const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  anthropic: {
    label: 'Anthropic',
    models: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
    defaultModel: 'claude-opus-4-8',
  },
  openai: { label: 'OpenAI', models: ['gpt-5.1'], defaultModel: 'gpt-5.1' },
  google: { label: 'Google', models: ['gemini-3-pro'], defaultModel: 'gemini-3-pro' },
  ollama: { label: 'Ollama', models: [], defaultModel: 'llama3.3' },
}

const PROVIDER_ORDER: ProviderId[] = ['anthropic', 'openai', 'google', 'ollama']

const labelStyle: CSSProperties = {
  fontSize: 10.5, fontWeight: 500, letterSpacing: '0.08em', color: theme.dim2,
  textTransform: 'uppercase', marginBottom: 7,
}

const fieldStyle: CSSProperties = {
  width: '100%', background: theme.input, border: `1px solid ${theme.border2}`, borderRadius: 9,
  padding: '9px 12px', fontFamily: 'inherit', fontSize: 13, color: theme.text, outline: 'none',
}

export function Settings({ state: _state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const [provider, setProvider] = useState<ProviderId>('anthropic')
  const [model, setModel] = useState<string>(PROVIDERS.anthropic.defaultModel)
  const [apiKeys, setApiKeys] = useState<Record<ProviderId, string>>({ anthropic: '', openai: '', google: '', ollama: '' })
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434')
  const [keySet, setKeySet] = useState<Record<string, boolean>>({})

  useEffect(() => {
    window.nexra.settings.get().then(s => {
      setProvider(s.provider as ProviderId)
      setModel(s.model)
      setBaseUrl(s.baseUrl)
      setKeySet({ [s.provider]: s.hasKey })
    })
  }, [])

  const close = () => dispatch({ t: 'closeSettings' })

  const selectProvider = (id: ProviderId) => {
    setProvider(id)
    setModel(PROVIDERS[id].defaultModel)
    window.nexra.settings.set({ provider: id, model: PROVIDERS[id].defaultModel })
  }

  const setApiKey = (value: string) => setApiKeys(prev => ({ ...prev, [provider]: value }))

  const isOllama = provider === 'ollama'
  const cfg = PROVIDERS[provider]

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(6,7,9,0.68)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 440, maxWidth: '100%', background: theme.card2, border: `1px solid ${theme.border2}`,
          borderRadius: 14, boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ padding: '20px 22px 4px' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: theme.text }}>Settings</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: theme.muted, marginTop: 5 }}>
            Choose a provider and model for the agent.
          </div>
        </div>

        <div style={{ padding: '16px 22px 4px' }}>
          <div style={labelStyle}>Provider</div>
          <select
            value={provider}
            onChange={e => selectProvider(e.target.value as ProviderId)}
            style={fieldStyle}
          >
            {PROVIDER_ORDER.map(id => (
              <option key={id} value={id}>{PROVIDERS[id].label}</option>
            ))}
          </select>
        </div>

        <div style={{ padding: '16px 22px 4px' }}>
          <div style={labelStyle}>Model</div>
          {isOllama ? (
            <input
              value={model}
              onChange={e => setModel(e.target.value)}
              onBlur={e => { if (e.target.value) window.nexra.settings.set({ model: e.target.value }) }}
              placeholder="gemma4:e4b"
              style={fieldStyle}
            />
          ) : (
            <select
              value={model}
              onChange={e => { setModel(e.target.value); window.nexra.settings.set({ model: e.target.value }) }}
              style={fieldStyle}
            >
              {cfg.models.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
        </div>

        <div style={{ padding: '16px 22px 6px' }}>
          {isOllama ? (
            <>
              <div style={labelStyle}>Ollama base URL</div>
              <input
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                onBlur={e => window.nexra.settings.set({ baseUrl: e.target.value })}
                placeholder="http://localhost:11434"
                style={fieldStyle}
              />
            </>
          ) : (
            <>
              <div style={labelStyle}>{cfg.label} API key</div>
              <input
                type="password"
                value={apiKeys[provider]}
                onChange={e => setApiKey(e.target.value)}
                onBlur={e => { if (e.target.value) { window.nexra.settings.setKey(provider, e.target.value); setKeySet(prev => ({ ...prev, [provider]: true })) } }}
                placeholder={keySet[provider] ? '•••••••• (set — type to replace)' : 'sk-...'}
                autoComplete="off"
                style={fieldStyle}
              />
            </>
          )}
        </div>

        <div style={{ padding: '4px 22px 18px' }}>
          <div style={{ fontSize: 11.5, lineHeight: 1.5, color: theme.dim2 }}>
            Saved locally. API key stored in your OS keychain.
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, padding: '14px 22px 20px' }}>
          <Hoverable
            as="button"
            type="button"
            onClick={close}
            baseStyle={{
              padding: '8px 17px', borderRadius: 9, border: 'none', background: theme.accent, color: '#fff',
              fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', transition: 'background .12s',
            }}
            hoverStyle={{ background: theme.accentHover }}
          >
            Done
          </Hoverable>
        </div>
      </div>
    </div>
  )
}
