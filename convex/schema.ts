import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const rollupProduct = v.object({
  product: v.string(),
  leads: v.number(),
  closings: v.number(),
  leadOrders: v.number(),
  revenue: v.number(),
  discount: v.number(),
  cod: v.number(),
  transfer: v.number(),
});

export default defineSchema({
  customers: defineTable({
    orgId: v.id("organizations"), // B1: REQUIRED — every row belongs to an org (spec §3.4)
    phone: v.string(),
    name: v.string(),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_org_phone", ["orgId", "phone"]),

  orders: defineTable({
    orgId: v.id("organizations"), // B1: REQUIRED — every row belongs to an org (spec §3.4)
    orderId: v.string(),
    customerPhone: v.string(),
    customerName: v.string(),
    assignedCsName: v.string(),
    csKey: v.optional(v.string()), // = csKey(assignedCsName); powers by_csKey_createdAt (rollup per-CS slice reads)
    assignedCsNumber: v.optional(v.string()),
    productName: v.string(),
    products: v.string(),
    productsSubtotal: v.string(),
    shippingCost: v.string(),
    total: v.string(),
    shippingAddress: v.string(),
    shippingDistrict: v.string(),
    shippingCity: v.string(),
    source: v.literal("berdu"),
    aiEligible: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org_orderId", ["orgId", "orderId"])
    .index("by_org_customerPhone", ["orgId", "customerPhone"])
    .index("by_org_customerPhone_createdAt", ["orgId", "customerPhone", "createdAt"])
    .index("by_org_createdAt", ["orgId", "createdAt"])
    .index("by_org_csKey_createdAt", ["orgId", "csKey", "createdAt"]),

  // Per-day cursor for the Berdu safety-net reconciler. This keeps repeated
  // cron runs to only the new order-id tail plus a bounded set of old holes.
  reconcileStates: defineTable({
    orgId: v.id("organizations"),
    datePrefix: v.string(),
    nextCounter: v.number(),
    unresolvedCounters: v.array(v.number()),
    probeCursor: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_org_datePrefix", ["orgId", "datePrefix"]),

  conversations: defineTable({
    orgId: v.id("organizations"), // B1: REQUIRED — every row belongs to an org (spec §3.4)
    orderId: v.string(),
    customerPhone: v.string(),
    customerName: v.string(),
    assignedCsName: v.string(),
    status: v.union(v.literal("active"), v.literal("handover"), v.literal("closed")),
    aiEnabled: v.boolean(),
    note: v.string(),
    lastMessageAt: v.optional(v.number()),
    followUpStage: v.optional(v.number()),   // 1 = H+1 sent, 2 = H+2 sent
    followUpStageAt: v.optional(v.number()),
    followUpStageOverride: v.optional(v.number()), // manual override: 1, 2, or 3; cleared on reply/send
    followUpArchivedAt: v.optional(v.number()),     // timestamp when manually archived
    rtPendingInboundAt: v.optional(v.number()), // response-time pairing state (first inbound of current streak)
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org_orderId", ["orgId", "orderId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_org_status_updatedAt", ["orgId", "status", "updatedAt"])
    .index("by_org_customerPhone_updatedAt", ["orgId", "customerPhone", "updatedAt"])
    .index("by_org_assignedCsName_status", ["orgId", "assignedCsName", "status"]),

  lifecycleSweepStates: defineTable({
    orgId: v.id("organizations"),
    activeCursor: v.optional(v.string()),
    handoverCursor: v.optional(v.string()),
    activeDone: v.boolean(),
    handoverDone: v.boolean(),
    nextStatus: v.union(v.literal("active"), v.literal("handover")),
    updatedAt: v.number(),
  }).index("by_org", ["orgId"]),

  csConfigs: defineTable({
    orgId: v.id("organizations"), // B1: REQUIRED — every row belongs to an org (spec §3.4)
    normalizedName: v.string(),
    csName: v.string(),
    csPhone: v.optional(v.string()),
    provider: v.optional(v.string()),
    providerNumberId: v.optional(v.string()),
    providerNumberIds: v.optional(v.array(v.string())), // one CS can own >1 WABA number (e.g. Nabila has 2)
    berduStaffIds: v.optional(v.array(v.string())), // Berdu staff id(s) owned by this CS (order attribution)
    key: v.optional(v.string()),          // canonical per-org identity key (= csKey(csName) at creation; IMMUTABLE across renames)
    nameAliases: v.optional(v.array(v.string())), // raw name forms that resolve to this agent (e.g. "CS Aisyah", pre-rename names)
    orderAutomationEnabled: v.boolean(),
    aiAssistantEnabled: v.boolean(),
    reportingEnabled: v.boolean(),
    autoFollowUpEnabled: v.optional(v.boolean()), // auto-send H+1/H+2 for this CS (default off)
    autoSentDay: v.optional(v.number()),          // WIB day-number of the last auto-send (daily-cap reset key)
    autoSentCount: v.optional(v.number()),        // auto-sends counted on autoSentDay (enforces the daily cap)
    isActive: v.boolean(),
    avatarStorageId: v.optional(v.id("_storage")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_key", ["orgId", "key"])
    .index("by_org_normalizedName", ["orgId", "normalizedName"])
    .index("by_org_providerNumberId", ["orgId", "providerNumberId"])
    .index("by_org_active", ["orgId", "isActive"]),

  providerNumberBackfillRuns: defineTable({
    orgId: v.id("organizations"),
    phase: v.union(v.literal("scan"), v.literal("apply"), v.literal("cleanup"), v.literal("complete")),
    version: v.optional(v.number()),
    cursor: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_org", ["orgId"]),

  providerNumberBackfillClaims: defineTable({
    orgId: v.id("organizations"),
    runId: v.id("providerNumberBackfillRuns"),
    providerNumberId: v.string(),
    agentId: v.id("csConfigs"),
    createdAt: v.number(),
  })
    .index("by_org_run_providerNumberId", ["orgId", "runId", "providerNumberId"])
    .index("by_org_run", ["orgId", "runId"])
    .index("by_org_run_agent", ["orgId", "runId", "agentId"]),

  providerPlatformMigrationRuns: defineTable({
    key: v.string(),
    status: v.union(v.literal("running"), v.literal("failed"), v.literal("complete")),
    enumerationCursor: v.optional(v.string()),
    enumerationComplete: v.boolean(),
    enumeratedOrganizations: v.number(),
    completedOrganizations: v.number(),
    pendingOrganizations: v.number(),
    failedOrganizations: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  providerPlatformMigrationOrganizations: defineTable({
    runId: v.id("providerPlatformMigrationRuns"),
    orgId: v.id("organizations"),
    status: v.union(v.literal("pending"), v.literal("failed"), v.literal("complete")),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_run_org", ["runId", "orgId"])
    .index("by_run_status", ["runId", "status"]),

  // ── Ingestion API (Fase 1) ────────────────────────────────────────────────
  // Capture-first: every inbound webhook is stored raw BEFORE processing, so a
  // processing bug never loses data and failed events replay from OUR table,
  // not the vendor's dead-letter UI. (Incident 2026-07-07.)
  ingestEvents: defineTable({
    orgId: v.id("organizations"), // B1: REQUIRED — every row belongs to an org (spec §3.4)
    sourceKey: v.string(),
    kind: v.string(), // "message.event" | "lead.created" | "generic.message" | "generic.lead" | "unknown"
    rawHeaders: v.string(), // JSON string of the relevant header subset
    rawBody: v.string(),
    signatureOk: v.boolean(),
    status: v.union(
      v.literal("received"),
      v.literal("processed"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    error: v.optional(v.string()),
    skipReason: v.optional(v.string()),
    resultRef: v.optional(v.string()),
    receivedAt: v.number(),
    processedAt: v.optional(v.number()),
    replayOf: v.optional(v.id("ingestEvents")),
  })
    .index("by_status_receivedAt", ["status", "receivedAt"])
    .index("by_receivedAt", ["receivedAt"])
    .index("by_org_kind_status_receivedAt", ["orgId", "kind", "status", "receivedAt"])
    .index("by_org_status_receivedAt", ["orgId", "status", "receivedAt"]),

  ingestSources: defineTable({
    orgId: v.id("organizations"), // B1: REQUIRED — every row belongs to an org (spec §3.4)
    sourceKey: v.string(),
    name: v.string(),
    kind: v.union(v.literal("kirimdev"), v.literal("berdu"), v.literal("custom")),
    secret: v.string(),
    enabled: v.boolean(),
    // false = log-only: record signatureOk but accept the request. Prevents a
    // wrong HMAC construction from 401-ing every delivery and getting the NEW
    // subscription auto-disabled. Flip true after live verification.
    enforceSignature: v.boolean(),
    createdAt: v.number(),
  }).index("by_sourceKey", ["sourceKey"]),

  alertState: defineTable({
    orgId: v.id("organizations"), // B1: REQUIRED — every row belongs to an org (spec §3.4)
    alertKey: v.string(), // "silence" | "failure-spike"
    lastSentAt: v.number(),
  })
    .index("by_alertKey", ["alertKey"])
    .index("by_org_alertKey", ["orgId", "alertKey"]),

  // ── Rollup efficiency (specs/2026-07-08-rollup-efficiency-design.md) ──────
  // 1 row per (csKey, 16:00-WIB window). Recomputed-bounded on every order/recap
  // write; idempotent (row = pure function of raw rows) -> drift impossible.
  dailyRollups: defineTable({
    orgId: v.id("organizations"), // B1: REQUIRED — every row belongs to an org (spec §3.4)
    windowKey: v.string(),
    csKey: v.string(),
    csName: v.string(),
    leadOrders: v.number(),
    leadsCust: v.number(),
    closings: v.number(),
    closedCust: v.number(),
    cancelled: v.number(),
    manualClosings: v.number(),
    delivered: v.number(),
    revenue: v.number(),
    discount: v.number(),
    // Additive facts: optional until the Task 8 production backfill completes.
    cod: v.optional(v.number()),
    transfer: v.optional(v.number()),
    fuClosings: v.number(),
    fuH1: v.number(),
    fuH2: v.number(),
    fuH3: v.number(),
    byProduct: v.array(v.object({
      product: v.string(),
      leads: v.number(),
      closings: v.number(),
      leadOrders: v.optional(v.number()),
      revenue: v.optional(v.number()),
      discount: v.optional(v.number()),
      cod: v.optional(v.number()),
      transfer: v.optional(v.number()),
    })),
    updatedAt: v.number(),
  })
    .index("by_org_window_cs", ["orgId", "windowKey", "csKey"])
    .index("by_org_windowKey", ["orgId", "windowKey"]),

  // Written only after a bounded recompute has reconciled every CS row. Empty
  // windows get a marker too, so "no rows" is distinguishable from incomplete.
  rollupWindows: defineTable({
    orgId: v.id("organizations"),
    windowKey: v.string(),
    schemaVersion: v.number(),
    completedAt: v.number(),
    sampleRunId: v.optional(v.id("rollupMigrationRuns")),
  }).index("by_org_windowKey", ["orgId", "windowKey"]),

  rollupMigrationRuns: defineTable({
    orgId: v.id("organizations"),
    windowKey: v.string(),
    phase: v.union(
      v.literal("existing"), v.literal("orders"), v.literal("recaps"),
      v.literal("messages"), v.literal("products"), v.literal("publish"),
      v.literal("complete"),
    ),
    dirty: v.optional(v.boolean()),
    cursor: v.optional(v.string()),
    documentsProcessed: v.number(),
    sampleCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org_window", ["orgId", "windowKey"])
    .index("by_org_window_phase", ["orgId", "windowKey", "phase"]),

  rollupMigrationAgents: defineTable({
    runId: v.id("rollupMigrationRuns"),
    orgId: v.id("organizations"),
    windowKey: v.string(),
    csKey: v.string(),
    csName: v.string(),
    csNameCount: v.number(),
    leadOrders: v.number(), leadsCust: v.number(), closings: v.number(), closedCust: v.number(),
    cancelled: v.number(), manualClosings: v.number(), delivered: v.number(),
    revenue: v.number(), discount: v.number(), fuClosings: v.number(), fuH1: v.number(),
    fuH2: v.number(), fuH3: v.number(), cod: v.number(), transfer: v.number(),
    productLeads: v.number(), productClosings: v.number(), productLeadOrders: v.number(),
    productRevenue: v.number(), productDiscount: v.number(), productCod: v.number(),
    productTransfer: v.number(),
    productsFinalized: v.boolean(),
    productCursor: v.optional(v.string()),
    topProducts: v.optional(v.array(rollupProduct)),
    updatedAt: v.number(),
  })
    .index("by_run_cs", ["runId", "csKey"])
    .index("by_run_productsFinalized", ["runId", "productsFinalized"])
    .index("by_run", ["runId"]),

  rollupMigrationNameCounts: defineTable({
    runId: v.id("rollupMigrationRuns"), csKey: v.string(), rawName: v.string(), count: v.number(),
  }).index("by_run_cs_name", ["runId", "csKey", "rawName"]),

  rollupMigrationProducts: defineTable({
    runId: v.id("rollupMigrationRuns"), csKey: v.string(), product: v.string(),
    leads: v.number(), closings: v.number(), leadOrders: v.number(), revenue: v.number(),
    discount: v.number(), cod: v.number(), transfer: v.number(),
  })
    .index("by_run_cs_product", ["runId", "csKey", "product"])
    .index("by_run_cs", ["runId", "csKey"]),

  rollupMigrationDistinctClaims: defineTable({
    runId: v.id("rollupMigrationRuns"), claimKey: v.string(), count: v.number(),
  }).index("by_run_claim", ["runId", "claimKey"]),

  rollupMigrationLatestOrders: defineTable({
    runId: v.id("rollupMigrationRuns"), csKey: v.string(), phone: v.string(),
    createdAt: v.number(), product: v.string(),
  }).index("by_run_cs_phone", ["runId", "csKey", "phone"]),

  rollupMigrationClosingClaims: defineTable({
    runId: v.id("rollupMigrationRuns"), csKey: v.string(), identity: v.string(), closedAt: v.number(),
    phone: v.string(), product: v.string(), revenue: v.number(), discount: v.number(),
    manual: v.boolean(), delivered: v.boolean(), touchCount: v.number(),
    paymentMethod: v.string(),
  }).index("by_run_cs_identity", ["runId", "csKey", "identity"]),

  rollupMigrationConversationStates: defineTable({
    runId: v.id("rollupMigrationRuns"), conversationId: v.id("conversations"),
    csKey: v.string(), csName: v.string(), pendingInboundAt: v.optional(v.number()),
  }).index("by_run_conversation", ["runId", "conversationId"]),

  rollupMigrationSamples: defineTable({
    runId: v.id("rollupMigrationRuns"), orgId: v.id("organizations"),
    csKey: v.string(), csName: v.string(), conversationId: v.id("conversations"),
    sourceMessageId: v.optional(v.id("messages")),
    deltaMs: v.number(), inboundAt: v.number(), slaBreach: v.boolean(), createdAt: v.number(),
  })
    .index("by_run_createdAt", ["runId", "createdAt"])
    .index("by_run_cs_createdAt", ["runId", "csKey", "createdAt"])
    .index("by_run_sourceMessage", ["runId", "sourceMessageId"]),

  // Tiny fact row per detected reply pair. NO first/ongoing tag: "first" is
  // window-dependent (earliest pair per conversation WITHIN the queried window),
  // so readers derive it — exactly reproducing pairResponseEvents semantics.
  responseSamples: defineTable({
    orgId: v.id("organizations"), // B1: REQUIRED — every row belongs to an org (spec §3.4)
    csKey: v.string(),
    csName: v.string(),
    conversationId: v.id("conversations"),
    deltaMs: v.number(),
    inboundAt: v.number(),
    slaBreach: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_org_createdAt", ["orgId", "createdAt"])
    .index("by_org_cs_createdAt", ["orgId", "csKey", "createdAt"]),

  messages: defineTable({
    orgId: v.id("organizations"), // B1: REQUIRED — every row belongs to an org (spec §3.4)
    conversationId: v.id("conversations"),
    orderId: v.string(),
    customerPhone: v.string(),
    role: v.union(v.literal("customer"), v.literal("ai"), v.literal("cs"), v.literal("system")),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    content: v.string(),
    messageType: v.union(v.literal("text"), v.literal("image"), v.literal("template"), v.literal("button")),
    source: v.union(v.literal("kirimchat"), v.literal("panel"), v.literal("n8n"), v.literal("ingest")),
    externalMessageId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_conversation_createdAt", ["conversationId", "createdAt"])
    .index("by_conversation_direction_createdAt", ["conversationId", "direction", "createdAt"])
    .index("by_org_createdAt", ["orgId", "createdAt"])
    .index("by_org_customerPhone_createdAt", ["orgId", "customerPhone", "createdAt"])
    .index("by_org_externalMessageId", ["orgId", "externalMessageId"]),

  events: defineTable({
    orgId: v.id("organizations"), // B1: REQUIRED — every row belongs to an org (spec §3.4)
    conversationId: v.optional(v.id("conversations")),
    orderId: v.optional(v.string()),
    customerPhone: v.optional(v.string()),
    type: v.union(
      v.literal("order_upserted"),
      v.literal("message_inbound"),
      v.literal("ai_reply_sent"),
      v.literal("handover"),
      v.literal("pause_ai"),
      v.literal("resume_ai"),
      v.literal("closed"),
      v.literal("reactivated"),
      v.literal("closing_detected"),
      v.literal("order_deleted"),
      v.literal("order_cancelled"),
      v.literal("cancel_undone"),
      v.literal("global_ai_changed"),
      v.literal("shipping_recap_upserted"),
      v.literal("shipping_recap_exported"),
      v.literal("shipping_recap_delivered"),
      v.literal("shipping_recap_cancelled"),
      v.literal("shipping_recap_cancel_undone"),
      v.literal("shipping_recap_marked_ready"),
    ),
    actor: v.union(v.literal("system"), v.literal("ai"), v.literal("cs"), v.literal("n8n")),
    metadata: v.any(),
    createdAt: v.number(),
  })
    .index("by_conversation_createdAt", ["conversationId", "createdAt"])
    .index("by_org_createdAt", ["orgId", "createdAt"])
    .index("by_org_type_createdAt", ["orgId", "type", "createdAt"]),

  dailyStats: defineTable({
    date: v.string(),
    orders: v.number(),
    closings: v.number(),
    aiClosings: v.optional(v.number()),
    manualClosings: v.optional(v.number()),
    cancelled: v.optional(v.number()),
    handovers: v.number(),
    closedToday: v.number(),
    orderKeys: v.array(v.string()),
    closingKeys: v.array(v.string()),
    aiClosingKeys: v.optional(v.array(v.string())),
    manualClosingKeys: v.optional(v.array(v.string())),
    cancelledKeys: v.optional(v.array(v.string())),
    handoverKeys: v.array(v.string()),
    closedKeys: v.array(v.string()),
    updatedAt: v.number(),
  }).index("by_date", ["date"]),

  shippingRecaps: defineTable({
    orgId: v.id("organizations"), // B1: REQUIRED — every row belongs to an org (spec §3.4)
    orderIdBerdu: v.optional(v.string()),
    conversationId: v.optional(v.id("conversations")),
    customerPhone: v.string(),
    customerName: v.string(),
    csName: v.string(),
    csKey: v.optional(v.string()), // = csKey(csName); powers by_csKey_closedAt (rollup per-CS slice reads)
    csPhone: v.optional(v.string()),
    orderedAt: v.optional(v.number()),
    closedAt: v.number(),
    recipientName: v.string(),
    recipientPhone: v.string(),
    recipientAddress: v.string(),
    recipientDistrict: v.string(),
    recipientCity: v.string(),
    packageContent: v.string(),
    paymentMethod: v.union(v.literal("cod"), v.literal("transfer"), v.literal("unknown")),
    nonCodItemPrice: v.optional(v.number()),
    codValue: v.optional(v.number()),
    shippingCost: v.optional(v.number()),
    total: v.optional(v.number()),
    discount: v.optional(v.number()),
    inferredDiscount: v.optional(v.number()),
    bumpOrder: v.optional(v.string()),
    upsell: v.optional(v.string()),
    specialBonus: v.optional(v.string()),
    shippingInstruction: v.optional(v.string()),
    status: v.union(
      v.literal("ready"),
      v.literal("needs_review"),
      v.literal("exported"),
      v.literal("delivered"),
      v.literal("cancelled"),
      v.literal("cancelled_after_export"),
    ),
    flags: v.array(v.string()),
    sourceMessageId: v.optional(v.string()),
    sourceMessageText: v.string(),
    version: v.number(),
    exportedAt: v.optional(v.number()),
    exportBatchId: v.optional(v.string()),
    deliveredAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    cancelReason: v.optional(v.string()),
    followUpTouchesAtClose: v.optional(v.number()), // count of follow-up touches that preceded this closing
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org_orderIdBerdu", ["orgId", "orderIdBerdu"])
    .index("by_org_customerPhone", ["orgId", "customerPhone"])
    .index("by_org_closedAt", ["orgId", "closedAt"])
    .index("by_org_status_closedAt", ["orgId", "status", "closedAt"])
    .index("by_org_csKey_closedAt", ["orgId", "csKey", "closedAt"]),

  settings: defineTable({
    orgId: v.id("organizations"), // B1: REQUIRED — every row belongs to an org (spec §3.4)
    key: v.string(),
    value: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_org_key", ["orgId", "key"]),

  // Single-doc org config (key "default") — Fase A anchor for multi-tenant.
  // Values here override the in-code DEFAULT_ORG_SETTINGS fallback (empty table
  // = fallback = pre-Fase-A behavior). Phones stored normalized (62…).
  orgSettings: defineTable({
    orgId: v.id("organizations"), // B1: REQUIRED — every row belongs to an org (spec §3.4)
    key: v.string(), // "default" — becomes a per-org lookup in Fase B
    orgName: v.string(),
    internalPhones: v.array(v.string()),
    updatedAt: v.number(),
  })
    .index("by_org_key", ["orgId", "key"]),

  // Tenant identity — Fase B1. Single row (slug "pustakaislam") until multi-org.
  organizations: defineTable({
    slug: v.string(),
    name: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_slug", ["slug"]),

  closingRules: defineTable({
    orgId: v.id("organizations"), // B1: REQUIRED — every row belongs to an org (spec §3.4)
    phrase: v.string(),
    active: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_org_active", ["orgId", "active"]),

  users: defineTable({
    orgId: v.id("organizations"), // B1: REQUIRED — every row belongs to an org (spec §3.4)
    email: v.string(),
    name: v.string(),
    passwordHash: v.string(),
    role: v.union(v.literal("admin"), v.literal("cs")),
    // For role "cs": which CS this account represents (e.g. "Azelia"). The panel scopes
    // Laporan + Follow-up to this CS so the staffer only sees their own data.
    csName: v.optional(v.string()),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastLoginAt: v.optional(v.number()),
  }).index("by_email", ["email"]),
});
