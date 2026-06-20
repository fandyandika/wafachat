import type { Id } from '@/convex/_generated/dataModel';

export interface Conversation {
  conversationId: Id<'conversations'>;
  phone: string;
  status: 'active' | 'handover' | 'closed';
  customerName: string;
  productName: string;
  products?: string;
  productsSubtotal?: string;
  shippingCost?: string;
  total?: string;
  shippingAddress?: string;
  shippingDistrict?: string;
  shippingCity?: string;
  csName: string;
  csNumber?: string;
  order_id?: string;
  updatedAt: string;
  note: string;
  aiEnabled?: boolean;
  closingSource?: 'ai' | 'manual' | null;
  salesOutcome?: 'pending' | 'ai_won' | 'manual_won' | 'cancelled';
}

export interface Stats {
  orders: number;
  closings: number;
  ai_closings?: number;
  manual_closings?: number;
  cancelled?: number;
  handovers: number;
  closed_today: number;
  date: string;
}

export type QueueKey = 'active' | 'handover' | 'closed' | 'all';

export type RecapStatus = 'ready' | 'needs_review' | 'exported' | 'delivered' | 'cancelled' | 'cancelled_after_export';

export type PaymentFilter = 'all' | 'cod' | 'transfer';

export type RecapSort = 'newest' | 'oldest' | 'value_asc' | 'value_desc' | 'status';

export interface ShippingRecap {
  _id: Id<'shippingRecaps'>;
  orderIdBerdu?: string;
  customerPhone: string;
  customerName: string;
  csName: string;
  csPhone?: string;
  orderedAt?: number;
  closedAt: number;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  recipientDistrict: string;
  recipientCity: string;
  packageContent: string;
  paymentMethod: 'cod' | 'transfer' | 'unknown';
  nonCodItemPrice?: number;
  codValue?: number;
  shippingCost?: number;
  total?: number;
  discount?: number;
  inferredDiscount?: number;
  bumpOrder?: string;
  upsell?: string;
  specialBonus?: string;
  shippingInstruction?: string;
  status: RecapStatus;
  flags: string[];
  sourceMessageText: string;
  version: number;
  exportedAt?: number;
  exportBatchId?: string;
  cancelReason?: string;
  deliveredAt?: number;
}

export interface PerformanceData {
  totalLeads: number;
  totalClosing: number;
  overallCr: number;
  totalCod: number;
  totalTransfer: number;
  totalRevenue: number;
  totalDiscount: number;
  delivered: number;
  cancelled: number;
  products: Array<{ product: string; leads: number; closing: number; cr: number; revenue: number; discount: number }>;
  cs: Array<{ csName: string; leads: number; closing: number; cr: number; revenue: number; discount: number }>;
}

export interface CsConfig {
  csName: string;
  orderAutomationEnabled: boolean;
  aiAssistantEnabled: boolean;
  reportingEnabled: boolean;
  isActive: boolean;
}
