import { getDb, listFindingsByChat, deleteFindingsByChat } from './store.sqlite'
import type { Company, Engagement, Chat, Message, Phase, ScopeRow, ToolAvailability, InputRequestItem } from './store.types'

// Undefined → null for sqlite; empty string is preserved as-is.
const n = (v: string | undefined): string | null => (v == null ? null : v)

export function isEmptyGraph(): boolean {
  const r = getDb().prepare('SELECT COUNT(*) AS n FROM companies').get() as { n: number }
  return r.n === 0
}

export function saveGraph(companies: Company[]): void {
  const db = getDb()
  const upCompany = db.prepare(
    `INSERT INTO companies (id, name, updated, ord) VALUES (@id, @name, @updated, @ord)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated=excluded.updated, ord=excluded.ord`)
  const upEng = db.prepare(
    `INSERT INTO engagements (id, company_id, type, name, status, updated, linear, phases, scope, ord)
     VALUES (@id, @company_id, @type, @name, @status, @updated, @linear, @phases, @scope, @ord)
     ON CONFLICT(id) DO UPDATE SET company_id=excluded.company_id, type=excluded.type, name=excluded.name,
       status=excluded.status, updated=excluded.updated, linear=excluded.linear,
       phases=excluded.phases, scope=excluded.scope, ord=excluded.ord`)
  const upChat = db.prepare(
    `INSERT INTO chats (id, engagement_id, name, phase_id, color, tools, ord)
     VALUES (@id, @engagement_id, @name, @phase_id, @color, @tools, @ord)
     ON CONFLICT(id) DO UPDATE SET engagement_id=excluded.engagement_id, name=excluded.name,
       phase_id=excluded.phase_id, color=excluded.color, tools=excluded.tools, ord=excluded.ord`)
  const upMsg = db.prepare(
    `INSERT INTO messages (id, chat_id, role, kind, content, tool_name, command, output, duration,
       reason, install_cmd, state, request_kind, request_id, items, engagement_id, ord)
     VALUES (@id, @chat_id, @role, @kind, @content, @tool_name, @command, @output, @duration,
       @reason, @install_cmd, @state, @request_kind, @request_id, @items, @engagement_id, @ord)
     ON CONFLICT(id) DO UPDATE SET chat_id=excluded.chat_id, role=excluded.role, kind=excluded.kind,
       content=excluded.content, tool_name=excluded.tool_name, command=excluded.command, output=excluded.output,
       duration=excluded.duration, reason=excluded.reason, install_cmd=excluded.install_cmd, state=excluded.state,
       request_kind=excluded.request_kind, request_id=excluded.request_id, items=excluded.items,
       engagement_id=excluded.engagement_id, ord=excluded.ord`)

  const tx = db.transaction((cs: Company[]) => {
    cs.forEach((c, ci) => {
      upCompany.run({ id: c.id, name: c.name, updated: c.updated, ord: ci })
      c.engagements.forEach((e, ei) => {
        upEng.run({ id: e.id, company_id: c.id, type: e.type, name: e.name, status: e.status,
          updated: e.updated, linear: e.linear ? 1 : 0, phases: JSON.stringify(e.phases),
          scope: JSON.stringify(e.scope), ord: ei })
        e.chats.forEach((ch, chi) => {
          upChat.run({ id: ch.id, engagement_id: e.id, name: ch.name, phase_id: ch.phaseId,
            color: ch.color, tools: JSON.stringify(ch.tools), ord: chi })
          ch.messages.forEach((m, mi) => {
            upMsg.run({ id: m.id, chat_id: ch.id, role: m.role, kind: m.kind, content: n(m.content),
              tool_name: n(m.toolName), command: n(m.command), output: n(m.output), duration: n(m.duration),
              reason: n(m.reason), install_cmd: n(m.installCmd), state: n(m.state),
              request_kind: n(m.requestKind), request_id: n(m.requestId),
              items: m.items ? JSON.stringify(m.items) : null, engagement_id: n(m.engagementId), ord: mi })
          })
        })
      })
    })
  })
  tx(companies)
}

interface CompanyRow { id: string; name: string; updated: string }
interface EngRow { id: string; type: string; name: string; status: string; updated: string; linear: number; phases: string; scope: string }
interface ChatRow { id: string; name: string; phase_id: string; color: string; tools: string }
interface MsgRow {
  id: string; role: string; kind: string; content: string | null; tool_name: string | null; command: string | null
  output: string | null; duration: string | null; reason: string | null; install_cmd: string | null; state: string | null
  request_kind: string | null; request_id: string | null; items: string | null; engagement_id: string | null
}

function rowToMessage(r: MsgRow): Message {
  const m: Message = { id: r.id, role: r.role as Message['role'], kind: r.kind as Message['kind'] }
  if (r.content != null) m.content = r.content
  if (r.tool_name != null) m.toolName = r.tool_name
  if (r.command != null) m.command = r.command
  if (r.output != null) m.output = r.output
  if (r.duration != null) m.duration = r.duration
  if (r.reason != null) m.reason = r.reason
  if (r.install_cmd != null) m.installCmd = r.install_cmd
  if (r.state != null) m.state = r.state as Message['state']
  if (r.request_kind != null) m.requestKind = r.request_kind as Message['requestKind']
  if (r.request_id != null) m.requestId = r.request_id
  if (r.items != null) m.items = JSON.parse(r.items) as InputRequestItem[]
  if (r.engagement_id != null) m.engagementId = r.engagement_id
  return m
}

export function deleteChatGraph(chatId: string): void {
  const db = getDb()
  const tx = db.transaction((id: string) => {
    deleteFindingsByChat(id)
    db.prepare('DELETE FROM messages WHERE chat_id = ?').run(id)
    db.prepare('DELETE FROM chats WHERE id = ?').run(id)
  })
  tx(chatId)
}

export function deleteCompanyGraph(companyId: string): void {
  const db = getDb()
  const tx = db.transaction((cid: string) => {
    const engIds = (db.prepare('SELECT id FROM engagements WHERE company_id = ?').all(cid) as { id: string }[]).map(r => r.id)
    for (const eid of engIds) {
      const chatIds = (db.prepare('SELECT id FROM chats WHERE engagement_id = ?').all(eid) as { id: string }[]).map(r => r.id)
      for (const chid of chatIds) {
        deleteFindingsByChat(chid)
        db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chid)
      }
      db.prepare('DELETE FROM chats WHERE engagement_id = ?').run(eid)
    }
    db.prepare('DELETE FROM engagements WHERE company_id = ?').run(cid)
    db.prepare('DELETE FROM companies WHERE id = ?').run(cid)
  })
  tx(companyId)
}

export function readGraph(): Company[] {
  const db = getDb()
  const companies = db.prepare('SELECT id, name, updated FROM companies ORDER BY ord').all() as CompanyRow[]
  const engStmt = db.prepare('SELECT id, type, name, status, updated, linear, phases, scope FROM engagements WHERE company_id = ? ORDER BY ord')
  const chatStmt = db.prepare('SELECT id, name, phase_id, color, tools FROM chats WHERE engagement_id = ? ORDER BY ord')
  const msgStmt = db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY ord')

  return companies.map(c => ({
    id: c.id, name: c.name, updated: c.updated,
    engagements: (engStmt.all(c.id) as EngRow[]).map(e => ({
      id: e.id, type: e.type as Engagement['type'], name: e.name, status: e.status as Engagement['status'],
      updated: e.updated, linear: !!e.linear,
      phases: JSON.parse(e.phases) as Phase[], scope: JSON.parse(e.scope) as ScopeRow[],
      chats: (chatStmt.all(e.id) as ChatRow[]).map(ch => ({
        id: ch.id, name: ch.name, phaseId: ch.phase_id, color: ch.color,
        tools: JSON.parse(ch.tools) as ToolAvailability[],
        messages: (msgStmt.all(ch.id) as MsgRow[]).map(rowToMessage),
        findings: listFindingsByChat(ch.id),
      })),
    })),
  }))
}
