import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export class CodexAppServer {
  static async connect(cwd) {
    const client = new CodexAppServer(cwd);
    await client.request("initialize", { clientInfo: { name: "babysitter", title: "Babysitter", version: "0.1.0" } });
    client.notify("initialized", {});
    return client;
  }

  static async create(cwd) {
    const client = await CodexAppServer.connect(cwd);
    const started = await client.request("thread/start", { cwd, model: "gpt-5.6-terra", approvalPolicy: "never" });
    client.threadId = started.thread.id;
    return client;
  }

  static async resume(cwd, threadId) {
    const client = await CodexAppServer.connect(cwd);
    const resumed = await client.request("thread/resume", {
      threadId,
      cwd,
      approvalPolicy: "never",
      excludeTurns: true,
    });
    client.threadId = resumed.thread.id;
    return client;
  }

  static async listThreads(cwd, limit = 30) {
    const client = await CodexAppServer.connect(cwd);
    try {
      const result = await client.request("thread/list", {
        limit,
        sortKey: "updated_at",
        sortDirection: "desc",
      });
      return [...new Map((result.data || []).map((thread) => [thread.id, thread])).values()];
    } finally {
      client.close();
    }
  }

  constructor(cwd) {
    this.cwd = cwd;
    this.nextId = 1;
    this.pending = new Map();
    this.activeJob = null;
    this.compaction = null;
    this.listeners = new Set();
    this.child = spawn("codex", ["app-server"], {
      cwd,
      env: { ...process.env, JEV_AUTO_BYPASS: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => this.receive(line));
    createInterface({ input: this.child.stderr }).on("line", (line) => this.append(`[server] ${line}\n`));
    this.child.on("error", (error) => this.append(`[server] ${error.message}\n`));
    this.child.on("exit", (code) => {
      const error = new Error(`Codex app-server exited (${code})`);
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
      if (this.activeJob?.status === "running") {
        this.activeJob.status = "failed";
        this.activeJob.completedAt = new Date().toISOString();
        this.activeJob.resolveDone(this.activeJob);
      }
      if (this.compaction) {
        this.compaction.reject(error);
        this.compaction = null;
      }
      this.append(`[server] exited (${code})\n`);
    });
  }

  append(text) {
    if (this.activeJob) this.activeJob.output = (this.activeJob.output + text).slice(-50_000);
    for (const listener of this.listeners) listener(text);
  }

  receive(line) {
    let message;
    try { message = JSON.parse(line); } catch { this.append(`${line}\n`); return; }
    if (message.id !== undefined && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || "Codex app-server request failed"));
      else resolve(message.result);
      return;
    }
    if (message.method === "item/agentMessage/delta") this.append(message.params?.delta || "");
    else if (message.method === "item/completed" && message.params?.item?.type === "contextCompaction" && this.compaction) {
      this.compaction.resolve();
      this.compaction = null;
    }
    else if (message.method === "turn/completed" && this.compaction && !this.activeJob) {
      this.compaction.resolve();
      this.compaction = null;
    }
    else if (message.method === "turn/completed" && this.activeJob) {
      this.activeJob.status = message.params?.turn?.status === "completed" ? "complete" : "failed";
      this.activeJob.completedAt = new Date().toISOString();
      this.activeJob.resolveDone(this.activeJob);
    }
  }

  request(method, params) {
    const id = this.nextId++;
    this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  notify(method, params) {
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  onText(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async startTurn(prompt, route, imagePaths = []) {
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    const job = { id: crypto.randomUUID(), status: "running", output: "", startedAt: new Date().toISOString(), model: route.model, effort: route.effort, done, resolveDone };
    this.activeJob = job;
    const result = await this.request("turn/start", {
      threadId: this.threadId,
      input: [
        ...imagePaths.map((path) => ({ type: "localImage", path })),
        { type: "text", text: prompt },
      ],
      cwd: this.cwd,
      model: route.model,
      effort: route.effort,
      approvalPolicy: "never",
    });
    job.turnId = result.turn.id;
    return job;
  }

  async compact() {
    if (this.compaction) return this.compaction.done;
    let resolve;
    let reject;
    const done = new Promise((doneResolve, doneReject) => {
      resolve = doneResolve;
      reject = doneReject;
    });
    this.compaction = { done, resolve, reject };
    try {
      await this.request("thread/compact/start", { threadId: this.threadId });
    } catch (error) {
      this.compaction = null;
      reject(error);
    }
    return done;
  }

  close() {
    this.child.kill();
  }
}
