/** Whether this host can create the file symlinks the refusal cases construct. */
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * True when this host can create file symlinks. Windows without Developer Mode or an elevated
 * token denies them (EPERM), and a case that constructs a symlink cannot run there.
 */
export const symlinkSupported = (() => {
  const probe = mkdtempSync(join(tmpdir(), 'dsh-symlink-capacity-'))
  try {
    writeFileSync(join(probe, 'target'), 'x')
    symlinkSync(join(probe, 'target'), join(probe, 'link'), 'file')
    return true
  } catch {
    // EPERM: no symlink privilege on this host.
    return false
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
})()
