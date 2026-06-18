import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const t0 = 1_750_000_000_000;

test("backfillFromMessages still upserts one recap for an outbound PEMESANAN BERHASIL", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    const convId = await ctx.db.insert("conversations", {
      orderId: "O-1", customerPhone: "62811", customerName: "A", assignedCsName: "CS Aisyah",
      status: "active", aiEnabled: true, note: "", createdAt: t0, updatedAt: t0,
    });
    await ctx.db.insert("messages", {
      conversationId: convId, orderId: "O-1", customerPhone: "62811", role: "cs",
      direction: "outbound", content: "PEMESANAN BERHASIL\nProduk: Quran\nTotal: Rp100.000",
      messageType: "text", source: "n8n", externalMessageId: "msg_1", createdAt: t0,
    });
  });
  const res = await t.mutation(api.shippingRecaps.backfillFromMessages, {});
  expect(res.upserted).toBe(1);
  const recaps = await t.run(async (ctx) => ctx.db.query("shippingRecaps").collect());
  expect(recaps.length).toBe(1);
  expect(recaps[0].orderIdBerdu).toBe("O-1");
});
