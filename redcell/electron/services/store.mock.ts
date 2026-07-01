import type { Snapshot } from './store.types'
import { buildCompanies, buildTypes } from './seed'

export function buildSnapshot(): Snapshot {
  return { companies: buildCompanies(), types: buildTypes() }
}
