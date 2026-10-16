/** Validate the assembled application, including native Office conversion outside ASAR. */
import { execFile } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { join } from 'node:path'
import { parseArgs, promisify } from 'node:util'
import { desktopArtifactOutput, resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { readDesktopRuntime, verifyDesktopRuntime } from '../src/runtime-tree.ts'
import { verifyWindowsCode } from './windows-runtime-signature.mjs'
import { smokePreparedRuntime } from './smoke-prepared-runtime.ts'
import { resolveDesktopPackageTarget } from './package-target.ts'

const run = promisify(execFile)

/**
 * Read the executable name a macOS bundle declares.
 * @param infoPlist - Packaged Info.plist path.
 * @returns The bundle's `CFBundleExecutable` value.
 */
async function readBundleExecutable(infoPlist: string): Promise<string> {
  const { stdout } = await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', infoPlist])
  const name = stdout.trim()
  if (name === '') throw new Error(`desktop smoke: ${infoPlist} declares no CFBundleExecutable`)
  return name
}

/**
 * Fail packaging when the installed `dsh` command cannot reach its own executable.
 *
 * The command resolves the executable from the bundle instead of embedding a
 * product name, so nothing earlier catches a renamed product shipping a launcher
 * that exits with "No such file or directory".
 * @param resources - Packaged Resources directory holding the installed launcher.
 * @param windows - Whether the target is Windows.
 */
async function verifyInstalledCli(resources: string, windows: boolean): Promise<void> {
  const command = join(resources, 'runtime', 'cli', 'bin', windows ? 'dsh.cmd' : 'dsh')
  const [file, args] = windows
    ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `""${command}" --version"`]]
    : [command, ['--version']]
  const { stdout } = await run(file, args, { timeout: 300_000, windowsVerbatimArguments: windows })
  if (stdout.trim() === '') throw new Error(`desktop smoke: ${command} --version printed nothing`)
}

const paths = resolveDesktopTargetBuildPaths()
const { values } = parseArgs({ options: { unsigned: { type: 'boolean', default: false }, 'skip-notarization': { type: 'boolean', default: false } }, allowPositionals: false })
const target = resolveDesktopBuildTarget()
const windows = target === 'win-x64'
const artifacts = desktopArtifactOutput(paths, { unsigned: values.unsigned, skipNotarization: values['skip-notarization'] }).directory
const application = windows ? join(artifacts, 'win-unpacked')
  : join(artifacts, target === 'mac-arm64' ? 'mac-arm64' : 'mac', 'PureHub Desktop.app', 'Contents')
const resources = join(application, windows ? 'resources' : 'Resources')
const executable = windows ? join(application, 'PureHub Desktop.exe') : join(application, 'MacOS', 'PureHub Desktop')
const descriptor = await verifyDesktopRuntime(paths.dsh, readDesktopRuntime(paths.dsh).release.version,
  resolveDesktopPackageTarget(target))
if (windows && !values.unsigned) await verifyWindowsCode(application)
if (!windows) {
  // The launcher reads this value at run time, so the bundle has to agree with it.
  const declared = await readBundleExecutable(join(application, 'Info.plist'))
  accessSync(join(application, 'MacOS', declared), constants.X_OK)
}
await verifyInstalledCli(resources, windows)
await smokePreparedRuntime(join(resources, 'app.asar', 'dsh'), executable, join(resources, 'runtime'), descriptor)
