import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { google } from 'npm:googleapis@126'

const SHEET_ID_DATA = Deno.env.get('SHEET_ID_DATA')!
const SHEET_ID_DELETED = Deno.env.get('SHEET_ID_DELETED')!
const SHEET_ID_LOGS = Deno.env.get('SHEET_ID_LOGS')!
const GOOGLE_SERVICE_ACCOUNT_JSON = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')!

function getAuth() {
  const creds = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON)
  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
}

async function append(sheetId: string, values: string[]) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() })
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'Sheet1!A:Z',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] },
  })
}

serve(async (req) => {
  try {
    const { type, table, record, old_record } = await req.json()

    if (type === 'INSERT') {
      if (['sewadars', 'attendance_sessions', 'jatha_attendance'].includes(table)) {
        await append(SHEET_ID_DATA, [table, new Date().toISOString(), JSON.stringify(record)])
      }
      if (table === 'logs') {
        await append(SHEET_ID_LOGS, [
          record.action || '', record.user_badge || '', record.user_name || '',
          record.details || '', record.timestamp || new Date().toISOString(),
        ])
      }
    }

    if (type === 'DELETE') {
      await append(SHEET_ID_DELETED, [
        table, new Date().toISOString(), JSON.stringify(old_record || record),
      ])
    }

    return new Response('ok', { status: 200 })
  } catch (err) {
    console.error(err.message)
    return new Response(err.message, { status: 500 })
  }
})
