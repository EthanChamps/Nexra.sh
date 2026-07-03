import { getDb } from './store.sqlite'

export type PhaseStatus = 'pending' | 'in_progress' | 'done'
export type MemoryKind = 'target' | 'dead_end' | 'note'

export function setPhaseCoverage(engagementId: string, phaseId: string, status: PhaseStatus): void {
  getDb().prepare(
    `INSERT INTO phase_coverage (engagement_id, phase_id, status, updated) VALUES (?, ?, ?, 'just now')
     ON CONFLICT(engagement_id, phase_id) DO UPDATE SET status=excluded.status, updated=excluded.updated`,
  ).run(engagementId, phaseId, status)
}

export function listPhaseCoverage(engagementId: string): { phaseId: string; status: PhaseStatus }[] {
  const rows = getDb().prepare('SELECT phase_id, status FROM phase_coverage WHERE engagement_id = ? ORDER BY phase_id')
    .all(engagementId) as { phase_id: string; status: string }[]
  return rows.map(r => ({ phaseId: r.phase_id, status: r.status as PhaseStatus }))
}

export function appendMemory(engagementId: string, kind: MemoryKind, content: string, chatId?: string): void {
  getDb().prepare(
    `INSERT INTO engagement_memory (engagement_id, chat_id, kind, content, time) VALUES (?, ?, ?, ?, 'just now')`,
  ).run(engagementId, chatId ?? null, kind, content)
}

export function listMemory(engagementId: string): { kind: MemoryKind; content: string; chatId?: string; time: string }[] {
  const rows = getDb().prepare('SELECT chat_id, kind, content, time FROM engagement_memory WHERE engagement_id = ? ORDER BY id')
    .all(engagementId) as { chat_id: string | null; kind: string; content: string; time: string }[]
  return rows.map(r => ({ kind: r.kind as MemoryKind, content: r.content, time: r.time, ...(r.chat_id != null ? { chatId: r.chat_id } : {}) }))
}
