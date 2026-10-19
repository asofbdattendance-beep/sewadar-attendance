// @vitest-environment jsdom
/**
 * ReportsPage — archival download wiring.
 *
 * The page no longer knows how an archive is produced: it maps UI state onto
 * runArchivalExport() and reports what came back. These tests drive the real
 * buttons against a stub Supabase client so the wiring itself is what fails if
 * it regresses — a signed-URL artifact downloads directly, an unreachable
 * endpoint falls through to the RPC, a queued job is surfaced instead of
 * spinning forever, and a filtered download without a duty type is refused
 * before any request leaves the browser.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, act, cleanup, fireEvent, waitFor, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const h = vi.hoisted(() => {
  const state = {
    rows: [],            // rows the stub returns for archival_attendance
    rowsError: null,     // when set, range() resolves this as an error instead
    rpcImpl: null,       // (name, args) => { data, error }
    ranges: [],          // every range(from,to) the page asked for
    rpcCalls: [],        // [name, args]
    container: null,     // the table a query was built from
  }

  const makeQuery = (table) => {
    const query = {
      _filters: [],
      select() { return query },
      order() { return query },
      limit() { return query },
      in() { return query },
      not() { return query },
      or() { return query },
      ilike() { return query },
      eq(col, value) { query._filters.push(['eq', col, value]); return query },
      gte(col, value) { query._filters.push(['gte', col, value]); return query },
      lte(col, value) { query._filters.push(['lte', col, value]); return query },
      range(from, to) {
        state.ranges.push({ table, from, to, filters: query._filters })
        if (state.rowsError) return Promise.resolve({ data: null, error: state.rowsError })
        return Promise.resolve({ data: table === 'archival_attendance' ? state.rows.slice(from, to + 1) : [], error: null })
      },
      single() { return Promise.resolve({ data: null, error: null }) },
      maybeSingle() { return Promise.resolve({ data: null, error: null }) },
      insert() { return query },
      update() { return query },
      upsert() { return query },
      delete() { return query },
      // Awaiting a bare select() (no range) must also resolve.
      then(resolve) { return Promise.resolve({ data: table === 'archival_attendance' ? state.rows : [], error: null }).then(resolve) },
    }
    return query
  }

  const client = {
    from(table) { state.container = table; return makeQuery(table) },
    async rpc(name, args) {
      state.rpcCalls.push([name, args])
      return state.rpcImpl ? state.rpcImpl(name, args) : { data: '', error: null }
    },
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'test-token' } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({}),
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}), unsubscribe: () => ({}) }),
    removeChannel: () => {},
  }

  // One stable object for the whole file: useAuth() is called on every render,
  // and a fresh `profile` object each time re-fires the page's data effect
  // forever (the test then hangs instead of failing).
  const auth = {
    user: { id: 'user-1' },
    profile: { role: 'aso', name: 'ASO Tester', centre: null },
    permissions: { allow_reports: true },
    hasPermission: () => true,
    loading: false,
    signIn: async () => {},
    signOut: async () => {},
  }

  return { state, client, auth }
})

vi.mock('../context/AuthContext', () => ({
  useAuth: () => h.auth,
}))

vi.mock('../lib/supabase.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, supabase: h.client }
})

const ReportsPage = (await import('./ReportsPage')).default

// A wiring loop under React shows up as a hang, not a failure. Fail fast.
vi.setConfig({ testTimeout: 8000, hookTimeout: 8000 })

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const RPC_CSV = 'Sewadar Name,Badge Number\r\nA,1\r\nB,2'

/** The page also calls get_user_accessible_centres on mount; only the export matters here. */
function archivalRpcCalls() {
  return h.state.rpcCalls.filter(([name]) => name === 'get_archival_csv_chunk')
}

/** jsdom's Blob has no .text(); Node's has no FileReader. Support both. */
async function blobText(blob) {
  if (typeof blob.text === 'function') return blob.text()
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

/** Anchor capture: downloadBlob/downloadUrl both click a synthetic <a>. */
function captureAnchors() {
  const created = []
  const original = document.createElement.bind(document)
  const spy = vi.spyOn(document, 'createElement').mockImplementation((tag, ...rest) => {
    const el = original(tag, ...rest)
    if (String(tag).toLowerCase() === 'a') {
      el.click = vi.fn()
      created.push(el)
    }
    return el
  })
  return { created, restore: () => spy.mockRestore() }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/reports?category=downloads']}>
      <ReportsPage />
    </MemoryRouter>,
  )
}

let anchors

beforeEach(() => {
  h.state.rows = []
  h.state.rpcImpl = null
  h.state.rowsError = null
  h.state.ranges = []
  h.state.rpcCalls = []
  vi.stubEnv('VITE_ARCHIVAL_EXPORT_ENDPOINT', 'https://example.test/functions/v1/request-archival-export')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
  Element.prototype.scrollIntoView = () => {}
  URL.createObjectURL = vi.fn(() => 'blob:test-url')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(window, 'alert').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  anchors = captureAnchors()
})

afterEach(() => {
  anchors.restore()
  cleanup()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('archival downloads on the Downloads tab', () => {
  it('a ready artifact downloads the signed URL and never touches the RPC', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'ready',
        url: 'https://signed.example.test/archival_all.csv?token=abc',
        filename: 'archival_all.csv',
        rowCount: 615724,
        expiresAt: '2026-01-01T00:00:00.000Z',
      }),
    }))

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Download Combined CSV/i }))

    await waitFor(() => expect(anchors.created.length).toBe(1))
    const anchor = anchors.created[0]
    expect(anchor.href).toContain('signed.example.test')
    expect(anchor.download).toBe('archival_all.csv')
    expect(anchor.click).toHaveBeenCalled()
    expect(archivalRpcCalls()).toHaveLength(0)
    await screen.findByText(/615,724 rows/)
  })

  it('an unreachable endpoint falls through to the chunked RPC and saves the blob', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('endpoint not deployed')
    })
    h.state.rpcImpl = (name, args) => (name === 'get_archival_csv_chunk' && args.p_chunk === 0
      ? { data: RPC_CSV, error: null }
      : { data: '', error: null })

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Download Combined CSV/i }))

    await waitFor(() => expect(anchors.created.length).toBe(1))
    const [call] = archivalRpcCalls()
    expect(call[0]).toBe('get_archival_csv_chunk')
    expect(call[1]).toEqual({
      p_chunk: 0, p_duty_type: null, p_from: null, p_to: null, p_limit: 100000,
    })
    expect(anchors.created[0].download).toBe('archival_all.csv')
    expect(URL.createObjectURL).toHaveBeenCalled()
    const blob = URL.createObjectURL.mock.calls[0][0]
    expect(await blobText(blob)).toBe(RPC_CSV)
  })

  it('a queued answer with no working fallback still surfaces its job id', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'queued', jobId: 'job-9f2', deduplicated: false }),
    }))
    // RPC empty (default stub) and the browser pager dead: nothing can build a file.
    h.state.rowsError = { message: 'network is down' }

    renderPage()
    // The filtered button refuses an empty duty type, so pick one first.
    fireEvent.change(await screen.findByLabelText(/Duty type|Duty Type/i), { target: { value: 'JMC' } })
    fireEvent.click(screen.getByRole('button', { name: /Download Filtered CSV/i }))

    expect(await screen.findByText(/job-9f2/)).toBeTruthy()
    expect(archivalRpcCalls().length).toBeGreaterThan(0)
    expect(anchors.created.length).toBe(0)
  })

  it('a queued answer does not block the download when the RPC can build the file', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'queued', jobId: 'job-9f2', deduplicated: false }),
    }))
    h.state.rpcImpl = (name, args) => (name === 'get_archival_csv_chunk' && args.p_chunk === 0
      ? { data: RPC_CSV, error: null }
      : { data: '', error: null })

    renderPage()
    fireEvent.change(await screen.findByLabelText(/Duty type|Duty Type/i), { target: { value: 'JMC' } })
    fireEvent.click(screen.getByRole('button', { name: /Download Filtered CSV/i }))

    // "No prepared file yet" must not mean "no file": the RPC answers the same
    // filters, so the user still gets their CSV.
    await waitFor(() => expect(anchors.created.length).toBe(1))
    expect(anchors.created[0].download).toMatch(/\.csv$/)
    const blob = URL.createObjectURL.mock.calls[0][0]
    expect(await blobText(blob)).toBe(RPC_CSV)
  })

  it('a broken RPC falls through to the browser and still delivers a file', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('endpoint not deployed')
    })
    h.state.rows = [
      { sewadar_name: 'A', badge_number: '1', duty_date: '2024-05-01' },
      { sewadar_name: 'B', badge_number: '2', duty_date: '2024-05-02' },
    ]
    h.state.rpcImpl = () => ({ data: null, error: { message: '57014 statement timeout' } })

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Download Combined CSV/i }))

    await waitFor(() => expect(anchors.created.length).toBe(1))
    const blob = URL.createObjectURL.mock.calls[0][0]
    const text = await blobText(blob)
    expect(text.startsWith('Sewadar Name,Badge Number')).toBe(true)
    expect(text).toContain('A,1')
    expect(text.split('\r\n')).toHaveLength(3)
  })

  it('refuses a filtered download with no duty type before any request leaves the browser', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Download Filtered CSV/i }))

    await waitFor(() => expect(window.alert).toHaveBeenCalled())
    expect(window.alert.mock.calls[0][0]).toMatch(/duty type/i)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(archivalRpcCalls()).toHaveLength(0)
  })

  it('no longer carries its own copy of the RPC/client download logic', () => {
    const source = readFileSync(join(repoRoot, 'src', 'pages', 'ReportsPage.jsx'), 'utf8')
    expect(source).not.toMatch(/downloadViaRpc/)
    expect(source).not.toMatch(/downloadViaClient/)
    expect(source).not.toMatch(/const escapeCsv/)
    expect(source).not.toMatch(/650000/)
    expect(source).toMatch(/from '\.\.\/lib\/archivalExport'/)
    expect(source).toMatch(/csvEscapeCell/)
  })
})
