// CUSTOM: agent-chat — direct agent chat UI (SETA-56/57)
import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentsApi } from "../../ui/src/api/agents";
import { useBreadcrumbs } from "../../ui/src/context/BreadcrumbContext";
import { useCompany } from "../../ui/src/context/CompanyContext";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Send } from "lucide-react";
import { cn, agentRouteRef, agentUrl } from "../../ui/src/lib/utils";
import { agentChatApi, type AgentChatMessage } from "./api";

const POLL_INTERVAL_MS = 2500;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function MessageBubble({ msg, agentName }: { msg: AgentChatMessage; agentName: string }) {
  const isUser = msg.authorType === "user";
  return (
    <div className={cn("flex gap-2 max-w-[80%]", isUser ? "ml-auto flex-row-reverse" : "mr-auto")}>
      {!isUser && (
        <div className="flex-shrink-0 h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary">
          {initials(agentName)}
        </div>
      )}
      <div
        className={cn(
          "px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words",
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-muted text-foreground rounded-tl-sm",
        )}
      >
        {msg.body}
        <div className={cn("text-[10px] mt-1 opacity-60", isUser ? "text-right" : "text-left")}>
          {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-2 mr-auto max-w-[80%]">
      <div className="flex-shrink-0 h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary opacity-60">
        …
      </div>
      <div className="px-3 py-3 rounded-2xl rounded-tl-sm bg-muted flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

export function AgentChatPage() {
  const { agentId, companyPrefix } = useParams<{ agentId: string; companyPrefix?: string }>();
  const navigate = useNavigate();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { companies, selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();

  const routeCompanyId = companyPrefix
    ? companies.find((c) => c.issuePrefix.toUpperCase() === companyPrefix.toUpperCase())?.id ?? null
    : null;
  const lookupCompanyId = routeCompanyId ?? selectedCompanyId ?? undefined;

  const agentRef = agentId ?? "";

  // Load agent info
  const { data: agent } = useQuery({
    queryKey: ["agents", "detail", agentRef, lookupCompanyId],
    queryFn: () => agentsApi.get(agentRef, lookupCompanyId),
    enabled: !!agentRef,
  });

  // Get or create chat session
  const { data: chat } = useQuery({
    queryKey: ["agent-chat", agentRef],
    queryFn: () => agentChatApi.getOrCreateChat(agent?.id ?? agentRef),
    enabled: !!(agent?.id ?? agentRef),
  });

  // Load messages (newest first from API, we reverse for display)
  const { data: rawMessages, dataUpdatedAt } = useQuery({
    queryKey: ["agent-chat-messages", chat?.id],
    queryFn: () => agentChatApi.getMessages(agent?.id ?? agentRef, chat!.id),
    enabled: !!chat?.id,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const messages: AgentChatMessage[] = rawMessages ? [...rawMessages].reverse() : [];

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [optimisticPending, setOptimisticPending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [dataUpdatedAt, optimisticPending]);

  // Breadcrumbs
  useEffect(() => {
    if (agent) {
      setBreadcrumbs([
        { label: "Agents", href: "/agents/all" },
        { label: agent.name, href: agentUrl(agent) },
        { label: "Chat" },
      ]);
    }
  }, [agent, setBreadcrumbs]);

  const sendMutation = useMutation({
    mutationFn: ({ body }: { body: string }) =>
      agentChatApi.postMessage(agent?.id ?? agentRef, chat!.id, body),
    onMutate: () => {
      setSending(true);
      setOptimisticPending(true);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-chat-messages", chat?.id] });
    },
    onSettled: () => {
      setSending(false);
      // Keep the typing indicator until next poll delivers agent reply
      setTimeout(() => setOptimisticPending(false), POLL_INTERVAL_MS * 2);
    },
  });

  const handleSend = useCallback(() => {
    const body = input.trim();
    if (!body || !chat?.id || sending) return;
    setInput("");
    sendMutation.mutate({ body });
    textareaRef.current?.focus();
  }, [input, chat, sending, sendMutation]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const agentName = agent?.name ?? "Agent";

  return (
    <div className="flex flex-col h-[calc(100vh-var(--header-height,56px))] max-h-screen">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => navigate(agent ? agentUrl(agent) : "/agents/all")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-semibold text-primary shrink-0">
          {initials(agentName)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-none truncate">{agentName}</p>
          {agent?.title && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{agent.title}</p>
          )}
        </div>
      </div>

      {/* Message thread */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {messages.length === 0 && !optimisticPending && (
          <p className="text-sm text-muted-foreground text-center mt-8">
            No messages yet. Say hello!
          </p>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} agentName={agentName} />
        ))}
        {optimisticPending && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t border-border bg-card px-4 py-3 flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Message ${agentName}…`}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm placeholder:text-muted-foreground outline-none min-h-[36px] max-h-[160px] leading-relaxed py-1.5"
          style={{ fieldSizing: "content" } as React.CSSProperties}
          disabled={sending}
        />
        <Button
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={handleSend}
          disabled={!input.trim() || sending || !chat}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
