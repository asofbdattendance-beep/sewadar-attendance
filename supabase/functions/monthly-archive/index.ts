import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { google } from 'npm:googleapis@126'

const SHEET_IDS = {
  DATA: Deno.env.get('SHEET_ID_DATA')!,
  DELETED: Deno.env.get('SHEET_ID_DELETED')!,
  LOGS: Deno.env.get('SHEET_ID_LOGS')!,
}
const ARCHIVE_SHEET_IDS = {
  DATA: Deno.env.get('ARCHIVE_SHEET_ID_DATA')!,
  DELETED: Deno.env.get('ARCHIVE_SHEET_ID_DELETED')!,
  LOGS: Deno.env.get('ARCHIVE_SHEET_ID_LOGS')!,
}
const SERVICE_ACCOUNT_JSON = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')!

function getAuth(scopes: string[]) {
  const creds = JSON.parse(SERVICE_ACCOUNT_JSON)
  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes,
  })
}

const auth = getAuth(['https://www.googleapis.com/auth/spreadsheets'])
const sheets = google.sheets({ version: 'v4', auth })

async function archiveOne(
  sourceId: string,
  destId: string,
  label: string,
) {
  // 1. Read all data from source
  const src = await sheets.spreadsheets.values.get({
    spreadsheetId: sourceId,
    range: 'A:Z',
  })
  const rows = src.data.values || []
  if (rows.length <= 1) {
    console.log(`${label}: no data to archive (only header or empty)`)
    return
  }
  const header = rows[0]
  const data = rows.slice(1)

  // 2. Append data to archive sheet
  const MONTH = new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' })
  const rowsToAppend = data.map((row) => [...row, MONTH])
  const destMeta = await sheets.spreadsheets.get({ spreadsheetId: destId })
  const destSheet = destMeta.data.sheets?.[0]?.properties?.title || 'Sheet1'
  const destRange = `${destSheet}!A:Z`

  // Check if archive has a header; if not, add one
  const destExisting = await sheets.spreadsheets.values.get({
    spreadsheetId: destId,
    range: `${destSheet}!1:1`,
  })
  if (!destExisting.data.values || destExisting.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: destId,
      range: `${destSheet}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[...header, 'Archived Month']] },
    })
  }

  // Append with a month column
  await sheets.spreadsheets.values.append({
    spreadsheetId: destId,
    range: destRange,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rowsToAppend },
  })
  console.log(`Archived ${data.length} rows from ${label}`)

  // 3. Clear source (keep header)
  const srcMeta = await sheets.spreadsheets.get({ spreadsheetId: sourceId })
  const srcSheet = srcMeta.data.sheets?.[0]?.properties?.title || 'Sheet1'
  await sheets.spreadsheets.values.clear({
    spreadsheetId: sourceId,
    range: `${srcSheet}!2:1000000`,
  })
  console.log(`Cleared ${label}`)
}

serve(async () => {
  try {
    await Promise.all([
      archiveOne(SHEET_IDS.DATA, ARCHIVE_SHEET_IDS.DATA, 'Live Data'),
      archiveOne(SHEET_IDS.DELETED, ARCHIVE_SHEET_IDS.DELETED, 'Deleted Records'),
      archiveOne(SHEET_IDS.LOGS, ARCHIVE_SHEET_IDS.LOGS, 'Logs'),
    ])
    return new Response('Archive complete', { status: 200 })
  } catch (err) {
    console.error(err.message)
    return new Response(err.message, { status: 500 })
  }
})
