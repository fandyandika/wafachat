import type { FollowUpSearchRow, FollowUpStage } from './follow-up-types';

type Requester = typeof fetch;

export class FollowUpClientError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
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
    throw new FollowUpClientError(result.error ?? 'Permintaan gagal.', response.status, result.status);
  }
  return result as T;
}

export function searchCustomers(query: string, csName?: string, request: Requester = fetch) {
  return postJson<{ ok: true; page: FollowUpSearchRow[] }>('/api/follow-up/search', { query, csName }, request);
}

export function sendTemplate(input: { conversationId: string; stage: FollowUpStage; templateId: string; requestId: string }, request: Requester = fetch) {
  return postJson<{ ok: boolean; status: string; providerMessageId?: string }>('/api/follow-up/send', input, request);
}

export function confirmContact(input: { conversationId: string; requestId: string }, request: Requester = fetch) {
  return postJson<{ ok: boolean; duplicate: boolean }>('/api/follow-up/confirm-contact', input, request);
}

export function archiveFollowUp(conversationId: string, request: Requester = fetch) {
  return postJson<{ ok: boolean; duplicate: boolean }>(
    '/api/follow-up/archive', { conversationId, requestId: crypto.randomUUID() }, request,
  );
}

export function unarchiveFollowUp(conversationId: string, request: Requester = fetch) {
  return postJson<{ ok: boolean; duplicate: boolean }>('/api/follow-up/unarchive', { conversationId }, request);
}
