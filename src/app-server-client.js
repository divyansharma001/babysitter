import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export class CodexAppServer {
  static async create(cwd) {
    const client = new CodexAppServer(cwd);
    await client.request("initialize", { clientInfo: { name: "jev-auto", title: "Jev Auto", version: "0.1.0" } });
    client.notify("initialized", {});
    const started = await client.request("thread/start", { cwd, model: "gpt-5.6-terra", approvalPolicy: "never" });
    client.threadId = started.thread.id;
    return client;
  }

  constructor(cwd) {
    this.cwd = cwd;
    this.nextId = 1;
    this.pending = new Map();
    this.activeJob = null;
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

  async startTurn(prompt, route) {
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    const job = { id: crypto.randomUUID(), status: "running", output: "", startedAt: new Date().toISOString(), model: route.model, effort: route.effort, done, resolveDone };
    this.activeJob = job;
    const result = await this.request("turn/start", {
      threadId: this.threadId,
      input: [{ type: "text", text: prompt }],
      cwd: this.cwd,
      model: route.model,
      effort: route.effort,
      approvalPolicy: "never",
    });
    job.turnId = result.turn.id;
    return job;
  }

  close() {
    this.child.kill();
  }
}
