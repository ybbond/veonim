import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver-types'
import { prefixWith, onFnCall } from '../support/utils'
import WorkerClient from '../messaging/worker-client'
import { QuickFixList } from '../core/vim-functions'
import CreateTransport from '../messaging/transport'
import NeovimUtils from '../support/neovim-utils'
import { Problem } from '../ai/diagnostics'
import { Api, Prefixes } from '../core/api'
import SetupRPC from '../messaging/rpc'
import Neovim from '@veonim/neovim'

const { on } = WorkerClient()
const prefix = { core: prefixWith(Prefixes.Core) }
const vimOptions = {
  rgb: false,
  ext_popupmenu: false,
  ext_tabline: false,
  ext_wildmenu: false,
  ext_cmdline: false
}

const { encoder, decoder } = CreateTransport()
const proc = Neovim([
  '--cmd', `let g:veonim = 1 | let g:vn_loaded = 0 | let g:vn_ask_cd = 0`,
  '--cmd', `exe ":fun! Veonim(...)\\n endfun"`,
  '--cmd', `exe ":fun! VK(...)\\n endfun"`,
  '--cmd', `com! -nargs=+ -range Veonim 1`,
  '--cmd', 'com! -nargs=* Plug 1',
  '--embed',
])

proc.on('error', e => console.error('vim error-reader err', e))
proc.stdout.on('error', e => console.error('vim error-reader stdout err', e))
proc.stdin.on('error', e => console.error('vim error-reader stdin err', e))
proc.stderr.on('data', e => console.error('vim error-reader stderr', e))
proc.on('exit', () => console.error('vim error-reader exit'))

encoder.pipe(proc.stdin)
proc.stdout.pipe(decoder)

const { notify, request, onData } = SetupRPC(encoder.write)
decoder.on('data', ([type, ...d]: [number, any]) => onData(type, d))

const req: Api = onFnCall((name: string, args: any[] = []) => request(prefix.core(name), args))
const api: Api = onFnCall((name: string, args: any[]) => notify(prefix.core(name), args))

const { unblock } = NeovimUtils({ notify: api, request: req })

unblock().then(errors => {
  if (errors.length) {
    console.error(`vim error-reader had some errors starting up`)
    errors.forEach(e => console.error(e))
  }

  api.uiAttach(5, 2, vimOptions)
})

const qfGroup = (fixes: object[]) => fixes.reduce((map, item) => {

}, new Map<string, Diagnostic[]>)

// TODO: probably need some mechanism to queue requests and do them serially.
// don't want to override vim buffer while another req is processing
on.getErrors(async (file: string, format: string): Problem[] => {
  api.command(`set errorformat=${format}`)
  api.command(`cgetfile ${file}`)
  const qf = await api.commandOutput(`filter(getqflist(), {k,v->v.valid})`) as QuickFixList[]
  // TODO: translate to bufname here?
  return qf
})
