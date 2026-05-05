import type { Context } from 'hono'
import {
  ConfirmReceiptSchema,
  OcrResultSchema,
  type OcrResult,
} from '@costco/shared'
import type { AppContext } from '../env.js'
import { fetchAndUpsertProduct } from './products.js'

const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct'
const PROMPT = `You are an OCR + parser for Costco Taiwan paper receipts.

Extract the receipt data and respond with ONLY a JSON object that matches this schema:

{
  "purchase_date": "YYYY-MM-DD or null if unreadable",
  "items": [
    {
      "code": "Costco item number (4-7 digit string)",
      "name": "product name as printed",
      "price": <number, TWD>,
      "quantity": <integer, default 1>
    }
  ]
}

Rules:
- The Costco code (商品代碼) is usually a 4-7 digit number on the same row as the item.
- The price is in TWD, integer or 1 decimal place.
- If the code is unreadable, set "code" to null and keep the name + price.
- Do NOT include subtotals, taxes, member ID, store totals.
- Output ONLY the JSON. No prose, no markdown fences.`

/** POST /api/receipts/scan — multipart image upload. */
export async function scanReceipt(c: Context<AppContext>) {
  const userId = c.get('userId')
  const ct = c.req.header('content-type') ?? ''
  if (!ct.startsWith('multipart/form-data')) {
    return c.json({ error: 'expected multipart/form-data' }, 400)
  }
  const form = await c.req.formData()
  const file = form.get('image')
  if (!(file instanceof File)) {
    return c.json({ error: 'missing image field' }, 400)
  }
  if (file.size > 8 * 1024 * 1024) {
    return c.json({ error: 'image too large (>8MB)' }, 413)
  }

  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)

  // Try once with the standard prompt; if Llama returns malformed / non-JSON
  // output, retry with a stricter prompt that re-emphasizes the format
  // requirement before giving up.
  const ocr = await runOcrWithRetry(c.env.AI, bytes)
  if (!ocr.ok) {
    return c.json(ocr.error, ocr.status)
  }
  const parsed = ocr.value

  // For each item with a code, try to fetch from Costco so user can preview.
  // For items without a code, fuzzy match against products.zh_name.
  const enriched: Array<{
    code: string | null
    name: string
    price: number
    quantity: number
    matched_product?: {
      code: string
      zh_name: string
      current_price: number
      image_url: string | null
    }
  }> = []

  for (const item of parsed.items) {
    let matched: typeof enriched[0]['matched_product'] = undefined
    if (item.code) {
      const exists = await c.env.DB
        .prepare(
          'SELECT code, zh_name, current_price, image_url FROM products WHERE code = ?',
        )
        .bind(item.code)
        .first<NonNullable<typeof matched>>()
      if (exists) {
        matched = exists
      } else {
        const ok = await fetchAndUpsertProduct(c.env.DB, item.code).catch(
          () => false,
        )
        if (ok) {
          matched = await c.env.DB
            .prepare(
              'SELECT code, zh_name, current_price, image_url FROM products WHERE code = ?',
            )
            .bind(item.code)
            .first<NonNullable<typeof matched>>() ?? undefined
        }
      }
    }
    if (!matched) {
      // Fuzzy match by name (LIKE) — best effort
      const fuzzy = await c.env.DB
        .prepare(
          `SELECT code, zh_name, current_price, image_url FROM products
           WHERE zh_name LIKE ? LIMIT 1`,
        )
        .bind(`%${item.name.slice(0, 6)}%`)
        .first<NonNullable<typeof matched>>()
      if (fuzzy) matched = fuzzy
    }
    enriched.push({
      code: item.code ?? null,
      name: item.name,
      price: item.price,
      quantity: item.quantity ?? 1,
      matched_product: matched,
    })
  }

  return c.json({
    purchase_date: parsed.purchase_date ?? null,
    items: enriched,
  })
}

/** POST /api/receipts/confirm — bulk add items to watchlist. */
export async function confirmReceipt(c: Context<AppContext>) {
  const userId = c.get('userId')
  const body = ConfirmReceiptSchema.parse(await c.req.json())
  let added = 0
  let skipped = 0
  let failed = 0

  for (const item of body.items) {
    // Ensure product exists
    const exists = await c.env.DB
      .prepare('SELECT 1 FROM products WHERE code = ?')
      .bind(item.code)
      .first()
    if (!exists) {
      const ok = await fetchAndUpsertProduct(c.env.DB, item.code).catch(
        () => false,
      )
      if (!ok) {
        failed++
        continue
      }
    }

    try {
      await c.env.DB
        .prepare(
          `INSERT INTO watchlist_items
            (user_id, product_code, purchase_price, purchase_date)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(userId, item.code, item.purchase_price, body.purchase_date)
        .run()
      added++
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint/i.test(err.message)) {
        skipped++
      } else {
        failed++
      }
    }
  }

  return c.json({ added, skipped, failed })
}

function extractJson(raw: string): string | null {
  const trimmed = raw.trim()
  // Handle ```json ... ``` blocks
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced && fenced[1]) return fenced[1].trim()
  // Otherwise grab the outermost {...}
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1)
  }
  return null
}

const STRICT_RETRY_PROMPT = `${PROMPT}

⚠️ STRICT OUTPUT REQUIREMENTS — your last response was not valid JSON:
- Output ONLY one JSON object. No markdown fences, no commentary, no \`\`\`.
- The first character of your response must be \`{\`.
- The last character must be \`}\`.
- Use double quotes only. Do not use trailing commas.`

type OcrOutcome =
  | { ok: true; value: OcrResult }
  | { ok: false; status: 422 | 503; error: Record<string, unknown> }

/**
 * Call Workers AI vision model and parse the result. If the first attempt
 * returns malformed / non-JSON output, retry once with a stricter prompt that
 * re-emphasizes the format requirement before giving up.
 *
 * @param ai Cloudflare Workers AI binding (kept untyped to avoid leaking the
 *           Ai type beyond this module).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runOcrWithRetry(ai: any, bytes: Uint8Array): Promise<OcrOutcome> {
  let lastRaw = ''
  let lastError: string | null = null

  for (const [attempt, prompt] of [
    [0, PROMPT],
    [1, STRICT_RETRY_PROMPT],
  ] as const) {
    let raw: string
    try {
      const result = (await ai.run(VISION_MODEL, {
        image: [...bytes],
        prompt,
        max_tokens: 1024,
      })) as { response?: string; description?: string }
      raw = result.response ?? result.description ?? ''
    } catch (err) {
      console.error('[ocr] AI run failed', err)
      return {
        ok: false,
        status: 503,
        error: {
          error: 'ocr_failed',
          message: err instanceof Error ? err.message : 'unknown',
          suggestion: 'Try again, or use BYOK mode in settings.',
          attempt,
        },
      }
    }
    lastRaw = raw

    const jsonStr = extractJson(raw)
    if (!jsonStr) {
      lastError = 'no_json'
      continue // retry with stricter prompt
    }
    try {
      const obj = JSON.parse(jsonStr) as unknown
      return { ok: true, value: OcrResultSchema.parse(obj) }
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'parse_error'
      // fall through and retry
    }
  }

  return {
    ok: false,
    status: 422,
    error: {
      error: lastError === 'no_json' ? 'ocr_no_json' : 'ocr_schema_invalid',
      message: lastError ?? 'unknown',
      raw: lastRaw.slice(0, 500),
      retried: true,
    },
  }
}
