import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { agentChats } from "./agent_chats.js";
import { agents } from "./agents.js";

export const agentChatMessages = pgTable(
  "agent_chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: uuid("chat_id").notNull().references(() => agentChats.id),
    authorType: text("author_type").notNull(), // "user" | "agent"
    authorUserId: text("author_user_id"),
    authorAgentId: uuid("author_agent_id").references(() => agents.id),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    chatCreatedAtIdx: index("agent_chat_messages_chat_created_at_idx").on(table.chatId, table.createdAt),
  }),
);
