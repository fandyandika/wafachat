import { describe, expect, test } from "vitest";
import {
  adminThreadNeedsReply,
  adminThreadPreview,
  filterAdminThreads,
  type AdminInboxThreadView,
} from "./admin-expedition-inbox-model";

const threads: AdminInboxThreadView[] = [
  {
    id: "thread-1",
    customerPhone: "6285715682110",
    customerName: "Fandi",
    productName: "Quran Mapping",
    orderId: "ORD-101",
    lastInboundAt: 300,
    lastOutboundAt: 200,
    windowOpen: true,
    updatedAt: 300,
  },
  {
    id: "thread-2",
    customerPhone: "6281287497002",
    customerName: "Hasna",
    orderId: "ORD-102",
    lastInboundAt: 100,
    lastOutboundAt: 200,
    windowOpen: false,
    updatedAt: 200,
  },
  {
    id: "thread-3",
    customerPhone: "087738293725",
    customerName: "Fauzi",
    lastOutboundAt: 150,
    windowOpen: false,
    updatedAt: 150,
  },
];

describe("admin expedition inbox thread model", () => {
  test("marks a thread reply-needed only when its latest inbound is newer", () => {
    expect(adminThreadNeedsReply(threads[0])).toBe(true);
    expect(adminThreadNeedsReply(threads[1])).toBe(false);
    expect(adminThreadNeedsReply(threads[2])).toBe(false);
  });

  test("searches loaded threads by normalized name, phone, product, and order", () => {
    expect(filterAdminThreads(threads, "fandi", "all").map((row) => row.id)).toEqual(["thread-1"]);
    expect(filterAdminThreads(threads, "0857 1568 2110", "all").map((row) => row.id)).toEqual(["thread-1"]);
    expect(filterAdminThreads(threads, "quran", "all").map((row) => row.id)).toEqual(["thread-1"]);
    expect(filterAdminThreads(threads, "ord-102", "all").map((row) => row.id)).toEqual(["thread-2"]);
  });

  test("filters reply-needed and open-window views without changing source order", () => {
    expect(filterAdminThreads(threads, "", "needs_reply").map((row) => row.id)).toEqual(["thread-1"]);
    expect(filterAdminThreads(threads, "", "window_open").map((row) => row.id)).toEqual(["thread-1"]);
    expect(filterAdminThreads(threads, "", "all").map((row) => row.id)).toEqual(["thread-1", "thread-2", "thread-3"]);
  });

  test("uses product, verified order, then phone as preview fallbacks", () => {
    expect(adminThreadPreview(threads[0])).toBe("Quran Mapping");
    expect(adminThreadPreview(threads[1])).toBe("Order ORD-102");
    expect(adminThreadPreview(threads[2])).toBe("087738293725");
  });
});
