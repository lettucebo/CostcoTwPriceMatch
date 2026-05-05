// Filled in detail in issue #7
// Costco TW SAP Hybris OCC v2 product JSON (subset of fields we use)
export interface CostcoApiPrice {
  currencyIso: string
  value: number
  priceType?: string
  formattedValue?: string
  formattedPriceForSetOfTwoQuantities?: string
}

export interface CostcoApiStock {
  stockLevelStatus: 'inStock' | 'outOfStock' | string
  stockLevel?: number
  contactDay?: number
  deliveryLeadTime?: number
}

export interface CostcoApiImage {
  format: string
  imageType: string
  url: string
}

export interface CostcoApiCouponDiscount {
  discountType?: string
  discountValue?: number
  formattedDiscountValue?: string
}

export interface CostcoApiDecal {
  key: string
  value: {
    altText?: string
    position?: number
    url?: string
  }
}

export interface CostcoApiProduct {
  code: string
  name: string
  englishName?: string
  url: string
  averageRating?: number
  numberOfReviews?: number
  basePrice?: CostcoApiPrice
  price?: CostcoApiPrice
  /** Present only when on sale */
  discountPrice?: CostcoApiPrice
  couponDiscount?: CostcoApiCouponDiscount
  pricePerUnit?: CostcoApiPrice
  unitType?: string
  hasPricePerUnit?: boolean
  stock: CostcoApiStock
  images?: CostcoApiImage[]
  decalData?: CostcoApiDecal[]
  deliveryName?: string
  multiProduct?: boolean
  membershipRestrictionApplied?: boolean
  hidePriceValue?: boolean
  purchasable?: boolean
  maxOrderQuantity?: number
  minOrderQuantity?: number
}

export interface CostcoApiPagination {
  currentPage: number
  pageSize: number
  totalPages: number
  totalResults: number
  sort: string
}

export interface CostcoApiSearchResponse {
  products: CostcoApiProduct[]
  pagination: CostcoApiPagination
}

/** Normalised product summary we actually persist. */
export interface ProductSummary {
  code: string
  zh_name: string
  en_name: string | null
  current_price: number
  base_price: number | null
  discount_price: number | null
  unit_price: number | null
  unit_type: string | null
  url: string
  image_url: string | null
  delivery_name: string | null
  in_stock: boolean
  stock_level: number | null
  is_on_sale: boolean
  is_manager_special: boolean
}

export type CostcoCategory =
  | 'hot-buys' // 優惠商品
  | 'whats-new' // 新品推薦
  | string
