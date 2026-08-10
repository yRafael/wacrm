import { describe, expect, it } from "vitest";

import {
  buildQueue,
  classifyConversation,
  type QueueBucketKey,
} from "./queue";
import type { Conversation } from "@/types";

/** Fixture mínimo — só os campos que a classificação consome. */
function conv(overrides: Partial<Conversation>): Conversation {
  return {
    id: "conv-1",
    user_id: "user-1",
    contact_id: "contact-1",
    status: "open",
    unread_count: 0,
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}

describe("classifyConversation", () => {
  it("retorna null para conversas fechadas ou pending", () => {
    expect(classifyConversation(conv({ status: "closed" }))).toBeNull();
    expect(classifyConversation(conv({ status: "pending" }))).toBeNull();
  });

  it("retorna 'unassigned' para conversa aberta sem agente, mesmo com não-lidas", () => {
    const c = conv({ assigned_agent_id: undefined, unread_count: 3 });
    expect(classifyConversation(c)).toBe("unassigned");
  });

  it("retorna 'waiting' para conversa aberta assumida com não-lidas", () => {
    const c = conv({ assigned_agent_id: "agent-1", unread_count: 1 });
    expect(classifyConversation(c)).toBe("waiting");
  });

  it("retorna null para conversa aberta assumida sem não-lidas", () => {
    const c = conv({ assigned_agent_id: "agent-1", unread_count: 0 });
    expect(classifyConversation(c)).toBeNull();
  });

  it("unassigned tem prioridade sobre waiting", () => {
    // Sem agente + não-lidas → unassigned (não waiting).
    const c = conv({ assigned_agent_id: undefined, unread_count: 5 });
    expect(classifyConversation(c)).toBe("unassigned");
  });
});

describe("buildQueue", () => {
  const recent = conv({
    id: "recent",
    assigned_agent_id: "agent-1",
    unread_count: 1,
    last_message_at: "2026-08-10T09:00:00Z",
  });
  const older = conv({
    id: "older",
    assigned_agent_id: "agent-1",
    unread_count: 1,
    last_message_at: "2026-08-09T09:00:00Z",
  });
  const oldest = conv({
    id: "oldest",
    assigned_agent_id: "agent-1",
    unread_count: 1,
    last_message_at: "2026-08-08T09:00:00Z",
  });
  const unassignedNew = conv({
    id: "unassigned-new",
    assigned_agent_id: undefined,
    last_message_at: "2026-08-10T11:00:00Z",
  });
  const unassignedOld = conv({
    id: "unassigned-old",
    assigned_agent_id: undefined,
    last_message_at: "2026-08-10T08:00:00Z",
  });
  const idle = conv({ id: "idle", assigned_agent_id: "agent-1" });
  const closed = conv({ id: "closed", status: "closed" });

  it("separa unassigned de waiting e descarta o resto", () => {
    const { unassigned, waiting } = buildQueue([
      closed,
      idle,
      unassignedNew,
      older,
      unassignedOld,
      recent,
      oldest,
    ]);

    expect(unassigned.map((c) => c.id)).toEqual([
      "unassigned-new",
      "unassigned-old",
    ]);
    expect(waiting.map((c) => c.id)).toEqual(["recent", "older", "oldest"]);
  });

  it("conversas sem mensagem caem para o fim do bucket", () => {
    const { waiting } = buildQueue([recent, idle, oldest]);
    expect(waiting.map((c) => c.id)).toEqual(["recent", "oldest"]);
  });

  it("lista vazia produz buckets vazios", () => {
    const { unassigned, waiting } = buildQueue([]);
    expect(unassigned).toEqual([]);
    expect(waiting).toEqual([]);
  });

  it("resultado respeita a união dos tipos de bucket", () => {
    const buckets: Record<QueueBucketKey, Conversation[]> = buildQueue([
      recent,
      unassignedNew,
    ]);
    expect(buckets.unassigned).toHaveLength(1);
    expect(buckets.waiting).toHaveLength(1);
  });
});
