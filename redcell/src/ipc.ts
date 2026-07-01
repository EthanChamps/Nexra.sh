import type { Snapshot } from '../electron/services/store.types'
export const getSnapshot = (): Promise<Snapshot> => window.redcell.store.snapshot()
