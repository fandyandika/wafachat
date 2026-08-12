export type FollowUpStage = 1 | 2 | 3;
export type FollowUpView = 'h1' | 'h2' | 'h3' | 'review' | 'closing' | 'archived';
export type FollowUpDueTone = 'scheduled' | 'due-today' | 'overdue';

export type FollowUpSnapshotContext = {
  productName: string;
  cycleId?: string;
  lastInboundPreview: string;
  lastInboundAt?: number;
  lastOutboundPreview: string;
  lastOutboundAt?: number;
  lastDetectedStage?: FollowUpStage;
  lastDetectedTemplate?: string;
};

export type FollowUpQueueRow = FollowUpSnapshotContext & {
  conversationId: string;
  customerName: string;
  customerPhone: string;
  orderId: string;
  csName: string;
  csKey: string;
  cycleInboundAt: number;
  stage: FollowUpStage;
  dueAt: number;
  dueState: 'overdue' | 'due_today' | 'scheduled';
  overdueDays: number;
  lastMessagePreview: string;
  lastMessageAt: number;
  reason: string;
};

export type FollowUpAttentionRow = FollowUpSnapshotContext & {
  conversationId: string;
  customerName: string;
  customerPhone: string;
  orderId: string;
  csName: string;
  csKey: string;
  stage?: FollowUpStage;
  dueAt?: number;
  state: 'sending' | 'failed' | 'unknown' | 'review';
  lastError?: string;
  reviewReason?: string;
  updatedAt: number;
};

export type FollowUpArchivedRow = FollowUpSnapshotContext & {
  conversationId: string;
  customerName: string;
  customerPhone: string;
  orderId: string;
  csName: string;
  csKey: string;
  archivedAt: number;
  outcome?: 'h3_complete' | 'closing' | 'cancelled' | 'manual_archive';
  updatedAt: number;
};

export type FollowUpClosedRow = {
  conversationId?: string;
  customerName: string;
  customerPhone: string;
  csName: string;
  csKey: string;
  orderId: string;
  closedAt: number;
  product: string;
  touches: number;
  fromFollowUp: boolean;
  contextAvailable: boolean;
  stage?: FollowUpStage;
  productName?: string;
  lastInboundPreview?: string;
  lastInboundAt?: number;
  lastOutboundPreview?: string;
  lastOutboundAt?: number;
  lastDetectedStage?: FollowUpStage;
  lastDetectedTemplate?: string;
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

export type FollowUpListRow = FollowUpQueueRow | FollowUpAttentionRow | FollowUpArchivedRow | FollowUpClosedRow | FollowUpSearchRow;
export type FollowUpActionRow = FollowUpQueueRow | FollowUpAttentionRow;

export const FOLLOW_UP_STAGE_LABEL: Record<FollowUpStage, string> = { 1: 'H+1', 2: 'H+2', 3: 'H+3' };
