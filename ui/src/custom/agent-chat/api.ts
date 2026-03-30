// CUSTOM: agent-chat — typed API client for direct agent chat routes (SETA-55/57)
import { api } from "../../api/client";

export interface AgentChat {
  id: string;
  companyId: string;
  agentId: string;
  createdAt: string;
}

export type AuthorType = "user" | "agent";

export interface AgentChatMessage {
  id: string;
  chatId: string;
  authorType: AuthorType;
  authorUserId: string | null;
  authorAgentId: string | null;
  body: string;
  createdAt: string;
}

export const agentChatApi = {
  /** Get or create the company-scoped chat for an agent. */
  getOrCreateChat(agentId: string): Promise<AgentChat> {
    return api.get<AgentChat>(`/agents/${agentId}/chats`);
  },

  /** Fetch paginated message history (newest first). */
  getMessages(
    agentId: string,
    chatId: string,
    opts?: { limit?: number; before?: string },
  ): Promise<AgentChatMessage[]> {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.before) params.set("before", opts.before);
    const qs = params.toString();
    return api.get<AgentChatMessage[]>(
      `/agents/${agentId}/chats/${chatId}/messages${qs ? `?${qs}` : ""}`,
    );
  },

  /** Post a message to the chat. Triggers agent heartbeat when called by a board user. */
  postMessage(agentId: string, chatId: string, body: string): Promise<AgentChatMessage> {
    return api.post<AgentChatMessage>(
      `/agents/${agentId}/chats/${chatId}/messages`,
      { body },
    );
  },
};
