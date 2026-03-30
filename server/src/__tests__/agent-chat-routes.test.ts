import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { agentChatRoutes } from "../routes/agent-chats.js";

// ── DB mocks ──────────────────────────────────────────────────────────────────

const mockAgentRow = {
  id: "agent-1",
  companyId: "company-1",
  name: "Dev",
  role: "general",
};

const mockChatRow = {
  id: "chat-1",
  companyId: "company-1",
  agentId: "agent-1",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const mockMessageRow = {
  id: "msg-1",
  chatId: "chat-1",
  authorType: "user",
  authorUserId: "user-1",
  authorAgentId: null,
  body: "Hello agent",
  createdAt: new Date("2026-01-01T00:00:01Z"),
};

// We track calls to the mock DB query builder chain
const mockReturning = vi.fn();
const mockValues = vi.fn(() => ({ returning: mockReturning }));
const mockInsert = vi.fn(() => ({ values: mockValues }));
const mockLimit = vi.fn();
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
const mockWhere = vi.fn(() => ({ limit: mockLimit, orderBy: mockOrderBy }));
const mockFrom = vi.fn(() => ({ where: mockWhere, orderBy: mockOrderBy }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

const mockDb = {
  select: mockSelect,
  insert: mockInsert,
};

// ── Heartbeat service mock ────────────────────────────────────────────────────

const mockHeartbeat = vi.hoisted(() => ({
  wakeup: vi.fn().mockResolvedValue({ id: "run-1" }),
}));

vi.mock("../services/index.js", () => ({
  heartbeatService: () => mockHeartbeat,
}));

// ── App factory ───────────────────────────────────────────────────────────────

function createBoardApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "user-1",
      companyIds: ["company-1"],
      source: "session",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", agentChatRoutes(mockDb as any));
  app.use(errorHandler);
  return app;
}

function createAgentApp(agentId = "agent-1") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "agent",
      agentId,
      companyId: "company-1",
      runId: "run-1",
      source: "agent_key",
    };
    next();
  });
  app.use("/api", agentChatRoutes(mockDb as any));
  app.use(errorHandler);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/agents/:agentId/chats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns existing chat when one exists", async () => {
    // select().from().where().limit() → existing chat
    mockSelect.mockReturnValueOnce({ from: mockFrom });
    mockFrom.mockReturnValueOnce({ where: mockWhere });
    mockWhere.mockReturnValueOnce({ limit: mockLimit });
    // First limit call: find agent
    mockLimit.mockResolvedValueOnce([mockAgentRow]);
    // Second select chain: find existing chat
    mockSelect.mockReturnValueOnce({ from: mockFrom });
    mockFrom.mockReturnValueOnce({ where: mockWhere });
    mockWhere.mockReturnValueOnce({ limit: mockLimit });
    mockLimit.mockResolvedValueOnce([mockChatRow]);

    const res = await request(createBoardApp()).get("/api/agents/agent-1/chats");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("chat-1");
  });

  it("creates and returns new chat when none exists", async () => {
    // Find agent
    mockSelect.mockReturnValueOnce({ from: mockFrom });
    mockFrom.mockReturnValueOnce({ where: mockWhere });
    mockWhere.mockReturnValueOnce({ limit: mockLimit });
    mockLimit.mockResolvedValueOnce([mockAgentRow]);

    // No existing chat
    mockSelect.mockReturnValueOnce({ from: mockFrom });
    mockFrom.mockReturnValueOnce({ where: mockWhere });
    mockWhere.mockReturnValueOnce({ limit: mockLimit });
    mockLimit.mockResolvedValueOnce([]);

    // Insert new chat
    mockReturning.mockResolvedValueOnce([mockChatRow]);

    const res = await request(createBoardApp()).get("/api/agents/agent-1/chats");
    expect(res.status).toBe(201);
    expect(res.body.agentId).toBe("agent-1");
    expect(mockInsert).toHaveBeenCalled();
  });

  it("returns 404 for unknown agent", async () => {
    mockSelect.mockReturnValueOnce({ from: mockFrom });
    mockFrom.mockReturnValueOnce({ where: mockWhere });
    mockWhere.mockReturnValueOnce({ limit: mockLimit });
    mockLimit.mockResolvedValueOnce([]);

    const res = await request(createBoardApp()).get("/api/agents/no-such-agent/chats");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/agents/:agentId/chats/:chatId/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns message history newest-first", async () => {
    // Find agent
    mockSelect.mockReturnValueOnce({ from: mockFrom });
    mockFrom.mockReturnValueOnce({ where: mockWhere });
    mockWhere.mockReturnValueOnce({ limit: mockLimit });
    mockLimit.mockResolvedValueOnce([mockAgentRow]);

    // Find chat
    mockSelect.mockReturnValueOnce({ from: mockFrom });
    mockFrom.mockReturnValueOnce({ where: mockWhere });
    mockWhere.mockReturnValueOnce({ limit: mockLimit });
    mockLimit.mockResolvedValueOnce([mockChatRow]);

    // Fetch messages (select → from → where → orderBy → limit)
    mockSelect.mockReturnValueOnce({ from: mockFrom });
    mockFrom.mockReturnValueOnce({ where: mockWhere });
    mockWhere.mockReturnValueOnce({ orderBy: mockOrderBy });
    mockOrderBy.mockReturnValueOnce({ limit: mockLimit });
    mockLimit.mockResolvedValueOnce([mockMessageRow]);

    const res = await request(createBoardApp()).get("/api/agents/agent-1/chats/chat-1/messages");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].id).toBe("msg-1");
  });
});

describe("POST /api/agents/:agentId/chats/:chatId/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupAgentAndChatLookups() {
    // Find agent
    mockSelect.mockReturnValueOnce({ from: mockFrom });
    mockFrom.mockReturnValueOnce({ where: mockWhere });
    mockWhere.mockReturnValueOnce({ limit: mockLimit });
    mockLimit.mockResolvedValueOnce([mockAgentRow]);

    // Find chat
    mockSelect.mockReturnValueOnce({ from: mockFrom });
    mockFrom.mockReturnValueOnce({ where: mockWhere });
    mockWhere.mockReturnValueOnce({ limit: mockLimit });
    mockLimit.mockResolvedValueOnce([mockChatRow]);
  }

  it("stores user message and triggers agent heartbeat", async () => {
    setupAgentAndChatLookups();

    // Insert message
    mockReturning.mockResolvedValueOnce([mockMessageRow]);

    // Context messages fetch (for heartbeat payload)
    mockSelect.mockReturnValueOnce({ from: mockFrom });
    mockFrom.mockReturnValueOnce({ where: mockWhere });
    mockWhere.mockReturnValueOnce({ orderBy: mockOrderBy });
    mockOrderBy.mockReturnValueOnce({ limit: mockLimit });
    mockLimit.mockResolvedValueOnce([mockMessageRow]);

    const res = await request(createBoardApp())
      .post("/api/agents/agent-1/chats/chat-1/messages")
      .send({ body: "Hello agent" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe("msg-1");
    expect(res.body.authorType).toBe("user");

    // Give the async heartbeat fire a tick to run
    await new Promise((r) => setTimeout(r, 10));

    expect(mockHeartbeat.wakeup).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({
        reason: "direct_chat_message",
        contextSnapshot: expect.objectContaining({ wakeReason: "direct_chat_message" }),
      }),
    );
  });

  it("stores agent reply without triggering another heartbeat", async () => {
    setupAgentAndChatLookups();

    const agentMsgRow = { ...mockMessageRow, id: "msg-2", authorType: "agent", authorAgentId: "agent-1", authorUserId: null };
    mockReturning.mockResolvedValueOnce([agentMsgRow]);

    const res = await request(createAgentApp("agent-1"))
      .post("/api/agents/agent-1/chats/chat-1/messages")
      .send({ body: "Hello human" });

    expect(res.status).toBe(201);
    expect(res.body.authorType).toBe("agent");

    await new Promise((r) => setTimeout(r, 10));
    expect(mockHeartbeat.wakeup).not.toHaveBeenCalled();
  });

  it("rejects agent posting to another agent's chat", async () => {
    setupAgentAndChatLookups();

    const res = await request(createAgentApp("other-agent"))
      .post("/api/agents/agent-1/chats/chat-1/messages")
      .send({ body: "sneaky message" });

    expect(res.status).toBe(403);
  });

  it("validates body is required", async () => {
    setupAgentAndChatLookups();

    const res = await request(createBoardApp())
      .post("/api/agents/agent-1/chats/chat-1/messages")
      .send({});

    expect(res.status).toBe(400);
  });
});
