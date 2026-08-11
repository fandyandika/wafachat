export type FollowUpStage = 1 | 2 | 3;
export type FollowUpHistoryView = 'sent' | 'review' | 'completed';

export type FollowUpQueueRow = {
  conversationId: string;
  customerName: string;
  customerPhone: string;
  orderId: string;
  csName: string;
  csKey: string;
  cycleInboundAt: number;
  stage: FollowUpStage;
  dueAt: number;
  productName: string;
  lastMessagePreview: string;
  lastMessageAt: number;
  reason: string;
};

export type FollowUpSearchRow = {
  conversationId: string;
  customerName: string;
  customerPhone: string;
  orderId: string;
  csName: string;
  stage?: FollowUpStage;
  state?: 'waiting' | 'sending' | 'unknown' | 'failed' | 'complete' | 'archived';
  updatedAt: number;
};

export type FollowUpHistoryRow = {
  id: string;
  conversationId?: string;
  customerName: string;
  customerPhone: string;
  orderId: string;
  csName: string;
  stage?: FollowUpStage;
  method?: 'provider_template' | 'provider_webhook' | 'manual_confirmation';
  status: string;
  error?: string;
  at: number;
};

export type FollowUpPagination = { isDone: boolean; continueCursor: string };
export const FOLLOW_UP_STAGE_LABEL: Record<FollowUpStage, string> = { 1: 'H+1', 2: 'H+2', 3: 'H+3' };
