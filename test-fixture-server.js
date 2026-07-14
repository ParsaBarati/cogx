"use strict";

const fs = require("fs");
const http = require("http");
const { randomUUID } = require("crypto");

const port = Number(process.env.COGX_TEST_PORT);
const logPath = process.env.COGX_TEST_LOG;
const readyPath = process.env.COGX_TEST_READY;
const agents = new Map();
const teams = [];
const messages = [];

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

function messageResponse(sender, body) {
  const message = {
    id: randomUUID(),
    sender_agent_id: randomUUID(),
    sender_slug: sender,
    recipient_agent_id: body.recipient_slug ? randomUUID() : null,
    recipient_team_id: body.recipient_team_id || null,
    thread_id: body.thread_id || randomUUID(),
    in_reply_to_message_id: body.in_reply_to_message_id || null,
    content: body.content,
    context_explanation: body.context_explanation,
    referenced_memory_ids: body.referenced_memory_ids || [],
    referenced_message_ids: body.referenced_message_ids || [],
    message_kind: body.message_kind || "message",
    delivery_status: "unread",
    sent_at: new Date().toISOString(),
    delivered_at: null,
    read_at: null,
  };
  Object.defineProperty(message, "_recipient_slug", {
    value: body.recipient_slug || null,
    enumerable: false,
  });
  messages.push(message);
  return message;
}

http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? JSON.parse(raw) : null;
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    fs.appendFileSync(logPath, JSON.stringify({ method: req.method, path: url.pathname, body }) + "\n");

    if (req.method === "POST" && url.pathname === "/api/agents/register") {
      const slug = String(body.name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const created = !agents.has(slug);
      const agent = {
        slug,
        name: body.name,
        agent_type: body.agent_type === "orchestrator" ? "tool" : body.agent_type,
        description: body.description || null,
        current_task: body.current_task || null,
        context_summary: null,
        last_active_at: null,
        created_at: new Date().toISOString(),
      };
      agents.set(slug, agent);
      return send(res, 200, { slug, name: body.name, agent_type: agent.agent_type, created });
    }
    if (req.method === "GET" && url.pathname === "/api/agents") {
      return send(res, 200, [...agents.values()]);
    }
    const agentGet = url.pathname.match(/^\/api\/agents\/([^/]+)$/);
    if (req.method === "GET" && agentGet) {
      const agent = agents.get(agentGet[1]);
      return agent ? send(res, 200, agent) : send(res, 404, { detail: "not found" });
    }
    if (req.method === "POST" && url.pathname === "/api/consciousness/remember") {
      return send(res, 200, { memory_id: randomUUID() });
    }
    if (req.method === "POST" && url.pathname.match(/^\/api\/memories\/[^/]+\/share$/)) {
      return send(res, 200, { memory_id: url.pathname.split("/")[3], shared_with: body.target_agent_slug, event_id: randomUUID() });
    }
    if (req.method === "POST" && url.pathname === "/api/consciousness/recall") {
      return send(res, 200, { memories: [], count: 0 });
    }
    if (req.method === "POST" && url.pathname === "/api/consciousness/talk") {
      return send(res, 200, { response: "ok", context_used: 0 });
    }
    if (req.method === "POST" && url.pathname === "/notify-hook") {
      return send(res, 200, { received: true });
    }
    if (req.method === "POST" && url.pathname === "/pmp/events") {
      return send(res, 200, { ok: true, event_id: 42, decision: "raise_hand", orb_notified: true, duplicate: false });
    }
    if (req.method === "POST" && url.pathname === "/legacy/pmp/events") {
      return send(res, 404, { detail: "not found" });
    }
    if (req.method === "POST" && url.pathname === "/legacy/events") {
      return send(res, 200, { ok: true, id: 44 });
    }
    if (req.method === "POST" && url.pathname === "/legacy/orb/state") {
      return send(res, 200, { ok: true, clients: 1 });
    }
    if (req.method === "POST" && url.pathname === "/events") {
      return send(res, 200, { ok: true, id: 43 });
    }
    if (req.method === "POST" && url.pathname === "/orb/state") {
      return send(res, 200, { ok: true, clients: 1 });
    }
    if (req.method === "GET" && url.pathname === "/api/teams") return send(res, 200, teams);
    if (req.method === "POST" && url.pathname === "/api/teams") {
      const team = { id: randomUUID(), name: body.name, owner_user_id: "test", member_slugs: body.member_slugs, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      teams.push(team);
      return send(res, 200, team);
    }
    const teamMembers = url.pathname.match(/^\/api\/teams\/([^/]+)\/members$/);
    if (req.method === "PUT" && teamMembers) {
      const team = teams.find((item) => item.id === teamMembers[1]);
      team.member_slugs = body.member_slugs;
      return send(res, 200, team);
    }
    const sendMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/message$/);
    if (req.method === "POST" && sendMatch) return send(res, 200, messageResponse(sendMatch[1], body));
    const handoffMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/handoff$/);
    if (req.method === "POST" && handoffMatch) {
      return send(res, 200, messageResponse(handoffMatch[1], {
        recipient_slug: body.to_slug,
        content: body.active_task_summary,
        context_explanation: body.context_explanation,
        referenced_memory_ids: body.referenced_memory_ids,
        message_kind: "handoff",
      }));
    }
    const inboxMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/inbox$/);
    if (req.method === "GET" && inboxMatch) {
      const addressed = messages.filter((item) => item._recipient_slug === inboxMatch[1]);
      const unread = addressed.filter((item) => item.delivery_status === "unread");
      return send(res, 200, { slug: inboxMatch[1], unread_count: unread.length, messages: addressed, has_more: false, cursor: null });
    }
    const ackMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/inbox\/([^/]+)\/ack$/);
    if (req.method === "POST" && ackMatch) {
      const message = messages.find((item) => item.id === ackMatch[2] && item._recipient_slug === ackMatch[1]);
      if (!message) return send(res, 404, { detail: "not found" });
      message.delivery_status = "acknowledged";
      message.read_at = new Date().toISOString();
      return send(res, 200, { message_id: ackMatch[2], delivery_status: "acknowledged" });
    }
    const threadMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/threads\/([^/]+)$/);
    if (req.method === "GET" && threadMatch) {
      return send(res, 200, { thread_id: threadMatch[2], messages: messages.filter((item) => item.thread_id === threadMatch[2]) });
    }
    return send(res, 404, { detail: `${req.method} ${url.pathname} not mocked` });
  });
}).listen(port, "127.0.0.1", () => {
  if (readyPath) fs.writeFileSync(readyPath, String(process.pid));
});
