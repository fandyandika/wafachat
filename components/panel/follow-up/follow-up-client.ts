import type {
  FollowUpHistoryRow,
  FollowUpHistoryView,
  FollowUpPagination,
  FollowUpQueueRow,
  FollowUpSearchRow,
  FollowUpStage,
} from './follow-up-types';

type Requester = typeof fetch;

export class FollowUpClientError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'FollowUpClientError';
  }
}

async function postJson<T>(url: string, body: unknown, request: Requester = fetch): Promise<T> {
  let response: Response;
  try {
    response = await request(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch {
    throw new FollowUpClientError('Tidak dapat menghubungi server. Coba lagi.', 0);
  }
  const result = await response.json().catch(() => ({ ok: false, error: 'Respons server tidak valid.' }));
  if (!response.ok || !result.ok) {
    throw new FollowUpClientError(result.error ?? 'Permintaan gagal.', response.status);
  }
  return result as T;
}

export function fetchQueue(filters: { csName?: string; stage?: FollowUpStage }, cursor: string | null = null, request: Requester = fetch) {
  return postJson<{ ok: true; page: FollowUpQueueRow[]; pagination: FollowUpPagination }>(
    '/api/follow-up/snapshot', { ...filters, cursor }, request,
  );
}

export function searchCustomers(query: string, csName?: string, request: Requester = fetch) {
  return postJson<{ ok: true; page: FollowUpSearchRow[] }>('/api/follow-up/search', { query, csName }, request);
}

export function fetchHistory(view: FollowUpHistoryView, csName?: string, cursor: string | null = null, request: Requester = fetch) {
  return postJson<{ ok: true; page: FollowUpHistoryRow[]; isDone: boolean; continueCursor: string }>(
    '/api/follow-up/history', { view, csName, cursor }, request,
  );
}

export function sendTemplate(input: { conversationId: string; stage: FollowUpStage; templateId: string; requestId: string }, request: Requester = fetch) {
  return postJson<{ ok: boolean; status: string; providerMessageId?: string }>('/api/follow-up/send', input, request);
}

export function confirmContact(input: { conversationId: string; stage: FollowUpStage; requestId: string }, request: Requester = fetch) {
  return postJson<{ ok: boolean; duplicate: boolean }>('/api/follow-up/confirm-contact', input, request);
}
