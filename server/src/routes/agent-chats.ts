import { Router } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentChats, agentChatMessages, agents as agentsTable } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { heartbeatService } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

const MAX_HISTORY_LIMIT = 100;
const CHAT_CONTEXT_MESSAGE_COUNT = 20;

const postMessageSchema = z.object({
  body: z.string().min(1).max(50_000),
});


export function agentChatRoutes(db: Db) {
  const router = Router();
  const heartbeat = heartbeatService(db);

  async function resolveAgent(agentId: string) {
    const rows = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId))
      .limit(1);
    return rows[0] ?? null;
  }

  async function resolveChat(chatId: string, agentId: string) {
    const rows = await db
      .select()
      .from(agentChats)
      .where(and(eq(agentChats.id, chatId), eq(agentChats.agentId, agentId)))
      .limit(1);
    return rows[0] ?? null;
  }

  // GET /api/agents/:agentId/chats
  // Returns the company-scoped chat for this agent, creating it if it doesn't exist.
  router.get("/agents/:agentId/chats", async (req, res) => {
    const agentId = req.params.agentId as string;
    const agent = await resolveAgent(agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    assertCompanyAccess(req, agent.companyId);

    const existing = await db
      .select()
      .from(agentChats)
      .where(and(eq(agentChats.agentId, agentId), eq(agentChats.companyId, agent.companyId)))
      .limit(1);

    if (existing[0]) {
      res.json(existing[0]);
      return;
    }

    const [created] = await db
      .insert(agentChats)
      .values({ companyId: agent.companyId, agentId })
      .returning();

    res.status(201).json(created);
  });

  // GET /api/agents/:agentId/chats/:chatId/messages
  // Returns message history, newest first, paginated.
  router.get(
    "/agents/:agentId/chats/:chatId/messages",
    async (req, res) => {
      const agentId = req.params.agentId as string;
      const chatId = req.params.chatId as string;

      const agent = await resolveAgent(agentId);
      if (!agent) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      assertCompanyAccess(req, agent.companyId);

      const chat = await resolveChat(chatId, agentId);
      if (!chat) {
        res.status(404).json({ error: "Chat not found" });
        return;
      }

      const { limit, before } = req.query as { limit?: string; before?: string };
      const limitNum = limit ? Math.min(parseInt(limit, 10), MAX_HISTORY_LIMIT) : 50;

      let query = db
        .select()
        .from(agentChatMessages)
        .where(eq(agentChatMessages.chatId, chatId))
        .orderBy(desc(agentChatMessages.createdAt))
        .limit(limitNum);

      if (before) {
        // Cursor-based pagination: fetch messages older than the given message id
        const cursorRows = await db
          .select({ createdAt: agentChatMessages.createdAt })
          .from(agentChatMessages)
          .where(eq(agentChatMessages.id, before))
          .limit(1);
        if (cursorRows[0]) {
          const { lt } = await import("drizzle-orm");
          query = db
            .select()
            .from(agentChatMessages)
            .where(and(eq(agentChatMessages.chatId, chatId), lt(agentChatMessages.createdAt, cursorRows[0].createdAt)))
            .orderBy(desc(agentChatMessages.createdAt))
            .limit(limitNum) as typeof query;
        }
      }

      const messages = await query;
      res.json(messages);
    },
  );

  // POST /api/agents/:agentId/chats/:chatId/messages
  // Board users post as "user"; agent API keys post as "agent".
  // When a user posts, triggers a heartbeat on the target agent.
  router.post(
    "/agents/:agentId/chats/:chatId/messages",
    validate(postMessageSchema),
    async (req, res) => {
      const agentId = req.params.agentId as string;
      const chatId = req.params.chatId as string;

      const agent = await resolveAgent(agentId);
      if (!agent) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }
      assertCompanyAccess(req, agent.companyId);

      const chat = await resolveChat(chatId, agentId);
      if (!chat) {
        res.status(404).json({ error: "Chat not found" });
        return;
      }

      const actor = getActorInfo(req);
      const isAgentActor = actor.actorType === "agent";

      // Agents can only post to their own chat
      if (isAgentActor && actor.agentId !== agentId) {
        res.status(403).json({ error: "Agent can only post to its own chat" });
        return;
      }

      const [message] = await db
        .insert(agentChatMessages)
        .values({
          chatId,
          authorType: isAgentActor ? "agent" : "user",
          authorUserId: isAgentActor ? null : (req.actor.type === "board" ? (req.actor.userId ?? null) : null),
          authorAgentId: isAgentActor ? (actor.agentId ?? null) : null,
          body: req.body.body,
        })
        .returning();

      // When a board user posts, wake the target agent with chat context
      if (!isAgentActor) {
        void (async () => {
          try {
            // Fetch last N messages as context for the agent
            const contextMessages = await db
              .select()
              .from(agentChatMessages)
              .where(eq(agentChatMessages.chatId, chatId))
              .orderBy(desc(agentChatMessages.createdAt))
              .limit(CHAT_CONTEXT_MESSAGE_COUNT);

            await heartbeat.wakeup(agentId, {
              source: "automation",
              triggerDetail: "system",
              reason: "direct_chat_message",
              payload: {
                chatId,
                messageId: message.id,
                recentMessages: contextMessages.reverse(),
              },
              requestedByActorType: "user",
              requestedByActorId: actor.actorId,
              contextSnapshot: {
                wakeReason: "direct_chat_message",
                chatId,
                messageId: message.id,
                source: "agent_chat.message",
              },
            });
          } catch {
            // Heartbeat trigger failure should not fail the message post
          }
        })();
      }

      res.status(201).json(message);
    },
  );

  return router;
}
