import { NextResponse } from 'next/server'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const SETTINGS_PATH = join(process.cwd(), '..', 'data', 'settings.json')

export async function GET() {
  try {
    if (!existsSync(SETTINGS_PATH)) {
      return NextResponse.json({})
    }
    const raw = readFileSync(SETTINGS_PATH, 'utf-8')
    const settings = JSON.parse(raw)
    return NextResponse.json(settings)
  } catch {
    return NextResponse.json({})
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    // Ensure data directory exists
    const dir = join(SETTINGS_PATH, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    // Merge with existing
    let existing: any = {}
    if (existsSync(SETTINGS_PATH)) {
      try {
        existing = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'))
      } catch { /* ignore */ }
    }

    const merged = { ...existing, ...body }
    writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2))

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to save settings' },
      { status: 500 }
    )
  }
}
