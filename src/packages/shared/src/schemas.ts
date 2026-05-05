import { z } from 'zod'
import { NOTIFICATION_CHANNELS, SUBSCRIPTION_TYPES } from './constants.js'

/** Costco product code: 6-7 digit number string */
export const CostcoCodeSchema = z
  .string()
  .regex(/^\d{4,9}$/, 'Costco product code must be 4-9 digits')

/** Date in YYYY-MM-DD format */
export const DateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')

/** Price: positive number */
export const PriceSchema = z.number().positive().finite()

/** POST /api/watchlist */
export const CreateWatchlistItemSchema = z.object({
  code: CostcoCodeSchema,
  purchase_price: PriceSchema,
  purchase_date: DateStringSchema,
  notes: z.string().max(500).optional(),
})
export type CreateWatchlistItemInput = z.infer<typeof CreateWatchlistItemSchema>

/** PATCH /api/watchlist/:id */
export const UpdateWatchlistItemSchema = z.object({
  purchase_price: PriceSchema.optional(),
  purchase_date: DateStringSchema.optional(),
  notes: z.string().max(500).nullable().optional(),
  status: z.enum(['active', 'claimed']).optional(),
})
export type UpdateWatchlistItemInput = z.infer<typeof UpdateWatchlistItemSchema>

/** POST /api/subscriptions */
export const CreateSubscriptionSchema = z
  .object({
    type: z.enum(SUBSCRIPTION_TYPES),
    product_code: CostcoCodeSchema.optional(),
  })
  .refine(
    (v) => v.type !== 'restock' || !!v.product_code,
    'restock subscription requires product_code',
  )
export type CreateSubscriptionInput = z.infer<typeof CreateSubscriptionSchema>

/** PATCH /api/me/notifications */
export const UpdateNotificationSettingsSchema = z.object({
  notification_email: z.string().email().nullable().optional(),
  channels: z.array(z.enum(NOTIFICATION_CHANNELS)).optional(),
})
export type UpdateNotificationSettingsInput = z.infer<
  typeof UpdateNotificationSettingsSchema
>

/** POST /api/receipts/confirm */
export const ConfirmReceiptItemSchema = z.object({
  code: CostcoCodeSchema,
  purchase_price: PriceSchema,
})
export const ConfirmReceiptSchema = z.object({
  purchase_date: DateStringSchema,
  items: z.array(ConfirmReceiptItemSchema).min(1).max(50),
})
export type ConfirmReceiptInput = z.infer<typeof ConfirmReceiptSchema>

/** OCR LLM output schema */
export const OcrItemSchema = z.object({
  code: z.string().optional().nullable(),
  name: z.string(),
  price: z.number().positive(),
  quantity: z.number().int().positive().optional().nullable(),
})
export const OcrResultSchema = z.object({
  purchase_date: DateStringSchema.optional().nullable(),
  items: z.array(OcrItemSchema),
})
export type OcrResult = z.infer<typeof OcrResultSchema>

/** POST /api/push/subscribe */
export const PushSubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
})
export type PushSubscribeInput = z.infer<typeof PushSubscribeSchema>
