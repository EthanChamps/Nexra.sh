import type { Company, Engagement, Chat, ReviewTypeId, ReviewTypeConfig, Message } from './store.types'

let _uid = 0
const uid = () => 'm' + (++_uid)

export const chatColors = [
  { id: 'slate', bg: '#0a0b0d', dot: '#3a3f47' },
  { id: 'indigo', bg: '#0d0e1c', dot: '#5866f0' },
  { id: 'teal', bg: '#08140f', dot: '#3aa980' },
  { id: 'wine', bg: '#170a0f', dot: '#d05668' },
  { id: 'amber', bg: '#16110a', dot: '#d99a4a' },
  { id: 'plum', bg: '#130a19', dot: '#a765d0' },
]

export const terminalShells = [
  { id: 'pwsh' as const, label: 'PowerShell', color: '#9aa2f5' },
  { id: 'cmd' as const, label: 'Command Prompt', color: '#c9cdd4' },
  { id: 'kali' as const, label: 'Kali · WSL', color: '#5bd493' },
]

export function buildTypes(): Record<ReviewTypeId, ReviewTypeConfig> {
  return {
    aws: { label: 'AWS Config Review', short: 'AWS', linear: false,
      phases: [{ id: 'iam', label: 'IAM' }, { id: 'storage', label: 'Storage (S3)' }, { id: 'network', label: 'Network (VPC)' }, { id: 'logging', label: 'Logging & Monitoring' }],
      tools: [{ name: 'prowler', available: true }, { name: 'scoutsuite', available: true }, { name: 'aws-cli', available: true }, { name: 'pmapper', available: false }],
      scope: [{ label: 'Account', value: '4821-9930-1174' }, { label: 'Regions', value: 'us-east-1, us-west-2' }, { label: 'Environment', value: 'Production' }, { label: 'Benchmark', value: 'CIS AWS v3.0' }] },
    azure: { label: 'Azure Config Review', short: 'AZ', linear: false,
      phases: [{ id: 'entra', label: 'Entra ID' }, { id: 'storage', label: 'Storage' }, { id: 'network', label: 'Network' }, { id: 'logging', label: 'Logging & Monitoring' }],
      tools: [{ name: 'scoutsuite', available: true }, { name: 'az-cli', available: true }, { name: 'roadrecon', available: true }, { name: 'pingcastle', available: false }],
      scope: [{ label: 'Tenant', value: 'contoso.onmicrosoft.com' }, { label: 'Subscription', value: 'prod-01' }, { label: 'Regions', value: 'eastus, westeu' }, { label: 'Benchmark', value: 'CIS Azure v2.1' }] },
    m365: { label: 'M365 Config Review', short: 'M365', linear: false,
      phases: [{ id: 'identity', label: 'Identity' }, { id: 'exchange', label: 'Exchange' }, { id: 'sharepoint', label: 'SharePoint' }, { id: 'compliance', label: 'Compliance' }],
      tools: [{ name: 'scoutsuite', available: true }, { name: 'msol', available: true }, { name: 'purview', available: true }, { name: 'maester', available: true }],
      scope: [{ label: 'Tenant', value: 'contoso.onmicrosoft.com' }, { label: 'Licenses', value: 'E5 · 1,240 seats' }, { label: 'Benchmark', value: 'CIS M365 v4.0' }] },
    internal: { label: 'Internal Pen Test', short: 'INT', linear: true,
      phases: [{ id: 'recon', label: 'Recon' }, { id: 'exploit', label: 'Exploit' }],
      tools: [{ name: 'nmap', available: true }, { name: 'bloodhound', available: true }, { name: 'crackmapexec', available: true }, { name: 'impacket', available: true }],
      scope: [{ label: 'Subnet', value: '10.10.0.0/16' }, { label: 'Domain', value: 'CORP.LOCAL' }, { label: 'DC', value: '10.10.0.5' }, { label: 'Exclusions', value: '10.10.9.0/24' }] },
    external: { label: 'External Pen Test', short: 'EXT', linear: true,
      phases: [{ id: 'recon', label: 'Recon' }, { id: 'exploit', label: 'Exploit' }],
      tools: [{ name: 'nmap', available: true }, { name: 'nuclei', available: true }, { name: 'amass', available: true }, { name: 'burp', available: false }],
      scope: [{ label: 'Domains', value: 'acme.com, *.acme.io' }, { label: 'ASN', value: 'AS40021' }, { label: 'Ranges', value: '198.51.100.0/24' }, { label: 'Rules', value: 'No DoS · business hrs' }] },
  }
}

const TYPES = buildTypes()

function makeEngagement(type: ReviewTypeId, name: string | null, status: 'In Progress' | 'Complete', updated: string): Engagement {
  const cfg = TYPES[type]
  return { id: 'e' + (++_uid), type, name: name || cfg.label, status, updated, linear: cfg.linear, phases: cfg.phases, scope: cfg.scope.map(s => ({ ...s })), chats: [] }
}

function makeChat(eng: Engagement, phaseId: string, name: string | null, color = '#0a0b0d'): Chat {
  const cfg = TYPES[eng.type]
  const ph = cfg.phases.find(p => p.id === phaseId) || cfg.phases[0]
  return {
    id: 'ch' + (++_uid), name: name || ph.label, phaseId: ph.id, color,
    messages: [{ id: uid(), role: 'assistant', kind: 'text', content: "I'm the " + ph.label + " agent for this " + cfg.label + ". Ask me to enumerate configuration, run automated checks, or log findings — this chat keeps its own context." }],
    findings: [], tools: cfg.tools.map(t => ({ ...t })),
  }
}
const stamp = (eng: Engagement) => eng.chats.forEach(c => c.messages.forEach(m => { if (!m.id) m.id = uid() }))

function enrichAws(e: Engagement) {
  const iam = makeChat(e, 'iam', 'IAM privilege review')
  iam.messages = ([
    { role: 'user', kind: 'text', content: 'Review IAM for overly permissive policies and privilege-escalation paths.' },
    { role: 'assistant', kind: 'text', content: "Starting the IAM review. I'll run Prowler's IAM checks, enumerate roles with wildcard permissions, then map privilege-escalation paths. I'll log findings to the panel as I go." },
    { role: 'assistant', kind: 'tool', toolName: 'prowler', command: 'prowler aws --service iam --status FAIL --output json', state: 'success', duration: '42.3s', output: '[iam_policy_allows_privilege_escalation]  FAIL  role/ci-deployer\n[iam_root_hardware_mfa_enabled]           FAIL  root\n[iam_user_accesskey_unused_90_days]       FAIL  12 users\n[iam_password_policy_reuse_prevention]    FAIL  account\n\n4 failed · 37 passed · 0 errors' },
    { role: 'assistant', kind: 'text', content: "Prowler flagged 4 failing controls. The critical one: role ci-deployer has an inline policy granting iam:* on * — effectively account admin reachable from the CI/CD pipeline. Pulling the policy document now." },
    { role: 'assistant', kind: 'tool', toolName: 'aws-cli', command: 'aws iam get-role-policy --role-name ci-deployer --policy-name inline-deploy', state: 'success', duration: '1.2s', output: '{\n  "Statement": [{\n    "Effect": "Allow",\n    "Action": "iam:*",\n    "Resource": "*"\n  }]\n}' },
    { role: 'assistant', kind: 'text', content: "Confirmed — unrestricted iam:* on all resources. Logged as Critical. To confirm the exploitable escalation path from the pipeline principal I'd normally map reachability with PMapper." },
    { role: 'assistant', kind: 'tool', state: 'unavailable', toolName: 'pmapper', reason: 'PMapper (AWS IAM privilege-escalation path finder) is not installed in this environment. Reachability-graph analysis for ci-deployer will be skipped until it is available.', installCmd: 'pip install principalmapper' },
    { role: 'assistant', kind: 'text', content: "I captured the direct finding from the policy document regardless. Install PMapper for the full escalation graph, or I can move on to the access-key hygiene issues." },
  ] as Message[]).map(m => ({ ...m, id: uid() }))
  iam.findings = [
    { title: 'ci-deployer role grants iam:* on *', sev: 'Critical', phase: 'IAM', time: '2m ago' },
    { title: 'Root account missing hardware MFA', sev: 'High', phase: 'IAM', time: '3m ago' },
    { title: '12 users with access keys unused >90d', sev: 'Medium', phase: 'IAM', time: '4m ago' },
    { title: 'Password policy permits reuse', sev: 'Low', phase: 'IAM', time: '4m ago' },
  ]
  const s3 = makeChat(e, 'storage', 'S3 bucket audit', '#08140f')
  s3.messages.push({ id: uid(), role: 'assistant', kind: 'tool', toolName: 'scoutsuite', command: 'scout aws --services s3 --report-dir ./scout-out', state: 'running', output: '' })
  e.chats = [iam, s3]; stamp(e)
}

function enrichInternal(e: Engagement) {
  const rc = makeChat(e, 'recon', 'Recon sweep')
  rc.messages = ([
    { role: 'user', kind: 'text', content: 'Enumerate live hosts and check SMB signing across 10.10.0.0/16.' },
    { role: 'assistant', kind: 'text', content: 'Running host discovery plus an SMB signing sweep across the in-scope subnet. This maps our initial attack surface.' },
    { role: 'assistant', kind: 'tool', toolName: 'nmap', command: 'nmap -sn 10.10.0.0/16 -oG live.txt', state: 'success', duration: '1m04s', output: 'Nmap scan: 65536 addresses, 218 hosts up\nNmap done in 64.11s' },
    { role: 'assistant', kind: 'tool', toolName: 'crackmapexec', command: 'cme smb 10.10.0.0/16 --gen-relay-list relay.txt', state: 'success', duration: '38.9s', output: 'SMB  10.10.2.14  signing:False  SMBv1:True\nSMB  10.10.2.51  signing:False\nSMB  10.10.4.03  signing:False\n... 14 hosts with signing disabled written to relay.txt' },
    { role: 'assistant', kind: 'text', content: '218 live hosts; 14 have SMB signing disabled — solid NTLM-relay candidates. Logged to findings. Spin up a separate chat when you move to exploitation so this context stays clean.' },
  ] as Message[]).map(m => ({ ...m, id: uid() }))
  rc.findings = [
    { title: 'SMB signing disabled on 14 hosts', sev: 'High', phase: 'Recon', time: '54m ago' },
    { title: 'SMBv1 enabled on legacy host', sev: 'Medium', phase: 'Recon', time: '55m ago' },
  ]
  const ex = makeChat(e, 'exploit', 'Kerberoast svc-sql', '#170a0f')
  ex.messages = ([
    { role: 'assistant', kind: 'text', content: 'Exploit agent ready. Recon handed off 14 relay candidates and 1 Kerberoastable SPN. Want me to run an NTLM relay chain or start with Kerberoasting?' },
    { role: 'user', kind: 'text', content: 'Kerberoast svc-sql first.' },
    { role: 'assistant', kind: 'tool', toolName: 'impacket', command: 'GetUserSPNs.py CORP.LOCAL/pentest -request -dc-ip 10.10.0.5', state: 'success', duration: '6.1s', output: 'ServicePrincipalName   Name     MemberOf\nMSSQL/sql01.corp.local svc-sql  Domain Admins\n\n$krb5tgs$23$*svc-sql$CORP.LOCAL$... (TGS captured)' },
    { role: 'assistant', kind: 'tool', state: 'unavailable', toolName: 'hashcat', reason: 'hashcat is not installed on this host — GPU cracking of the captured TGS ticket is unavailable locally.', installCmd: 'apt install hashcat' },
    { role: 'assistant', kind: 'text', content: "TGS captured for svc-sql (member of Domain Admins). hashcat isn't available to crack it here — install it, or I can hand the hash off to your cracking rig." },
  ] as Message[]).map(m => ({ ...m, id: uid() }))
  ex.findings = [{ title: 'Kerberoastable SPN svc-sql is Domain Admin', sev: 'High', phase: 'Exploit', time: '40m ago' }]
  ex.tools = [{ name: 'nmap', available: true }, { name: 'bloodhound', available: true }, { name: 'impacket', available: true }, { name: 'hashcat', available: false }]
  e.chats = [rc, ex]; stamp(e)
}

export function buildCompanies(): Company[] {
  _uid = 0
  const e1 = makeEngagement('aws', 'AWS Config Review', 'In Progress', '2m ago')
  const e2 = makeEngagement('internal', 'Internal Pen Test', 'In Progress', '1h ago')
  const e3 = makeEngagement('m365', 'M365 Config Review', 'Complete', '2d ago')
  const e4 = makeEngagement('azure', 'Azure Config Review', 'In Progress', '6h ago')
  const e5 = makeEngagement('external', 'External Pen Test', 'In Progress', '5d ago')
  enrichAws(e1); enrichInternal(e2)
  ;[e4, e5].forEach(e => { e.chats = [makeChat(e, e.phases[0].id, null)]; stamp(e) })
  return [
    { id: 'c1', name: 'Acme Corp', updated: '2m ago', engagements: [e1, e2] },
    { id: 'c2', name: 'Contoso Ltd', updated: '6h ago', engagements: [e3, e4] },
    { id: 'c3', name: 'Globex Systems', updated: '5d ago', engagements: [e5] },
  ]
}

export function buildTerminalSessions() {
  return {
    pwsh: [
      { kind: 'sys' as const, text: 'Windows PowerShell 7.4 · PSReadLine' },
      { kind: 'sys' as const, text: 'Shared session — the RedCell agent runs its commands in this same shell. You can take over any time. Type `help` for demo commands.' },
    ],
    cmd: [
      { kind: 'sys' as const, text: 'Microsoft Windows [Version 10.0.22631.4317]' },
      { kind: 'sys' as const, text: 'Shared session — agent + operator. Type `help` for demo commands.' },
    ],
    kali: [
      { kind: 'sys' as const, text: 'Kali GNU/Linux (WSL2) · kernel 6.6.36' },
      { kind: 'sys' as const, text: 'Shared session — agent + operator. Type `help` for demo commands.' },
    ],
  }
}
