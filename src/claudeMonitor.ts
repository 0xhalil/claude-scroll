import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ClaudeState, JournalEntry } from './types';

export class ClaudeMonitor {
  private state: ClaudeState = ClaudeState.IDLE;
  private fileOffset: number = 0;
  private watcher: fs.FSWatcher | null = null;
  private sessionWatcher: fs.FSWatcher | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private jsonlPath: string | null = null;
  private toolUseTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;

  private readonly _onStateChange = new vscode.EventEmitter<ClaudeState>();
  readonly onStateChange = this._onStateChange.event;

  private readonly claudeDir: string;

  constructor() {
    this.claudeDir = path.join(os.homedir(), '.claude');
  }

  start(): void {
    this.findAndWatchLatestJsonl();
    this.watchSessionsDir();
    this.pollTimer = setInterval(() => this.findAndWatchLatestJsonl(), 5000);
  }

  dispose(): void {
    this.watcher?.close();
    this.sessionWatcher?.close();
    this._onStateChange.dispose();
    if (this.pollTimer) { clearInterval(this.pollTimer); }
    if (this.toolUseTimer) { clearTimeout(this.toolUseTimer); }
    if (this.idleTimer) { clearTimeout(this.idleTimer); }
    if (this.watchdogTimer) { clearTimeout(this.watchdogTimer); }
  }

  getState(): ClaudeState {
    return this.state;
  }

  private watchSessionsDir(): void {
    const sessionsDir = path.join(this.claudeDir, 'sessions');
    if (!fs.existsSync(sessionsDir)) { return; }

    this.sessionWatcher = fs.watch(sessionsDir, (_eventType, filename) => {
      if (filename?.endsWith('.json')) {
        setTimeout(() => this.findAndWatchLatestJsonl(), 1000);
      }
    });
  }

  private findMostRecentJsonl(): string | null {
    const projectsDir = path.join(this.claudeDir, 'projects');
    if (!fs.existsSync(projectsDir)) { return null; }

    let mostRecentPath: string | null = null;
    let mostRecentTime = 0;

    try {
      const projectDirs = fs.readdirSync(projectsDir);
      for (const dir of projectDirs) {
        const dirPath = path.join(projectsDir, dir);
        try {
          const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl'));
          for (const file of files) {
            const filePath = path.join(dirPath, file);
            const stats = fs.statSync(filePath);
            if (stats.mtimeMs > mostRecentTime) {
              mostRecentTime = stats.mtimeMs;
              mostRecentPath = filePath;
            }
          }
        } catch {}
      }
    } catch {}

    return mostRecentPath;
  }

  private findAndWatchLatestJsonl(): void {
    const jsonlPath = this.findMostRecentJsonl();
    if (!jsonlPath || jsonlPath === this.jsonlPath) { return; }

    this.watcher?.close();
    this.jsonlPath = jsonlPath;

    const stats = fs.statSync(jsonlPath);
    this.fileOffset = stats.size;

    this.watcher = fs.watch(jsonlPath, (eventType) => {
      if (eventType === 'change') { this.readNewEntries(); }
    });

    console.log(`Claude Scroll: Watching ${jsonlPath}`);
  }

  private readNewEntries(): void {
    if (!this.jsonlPath) { return; }

    try {
      const stats = fs.statSync(this.jsonlPath);

      if (stats.size < this.fileOffset) {
        this.fileOffset = 0;
      }

      if (stats.size <= this.fileOffset) { return; }

      const fd = fs.openSync(this.jsonlPath, 'r');
      const buffer = Buffer.alloc(stats.size - this.fileOffset);
      fs.readSync(fd, buffer, 0, buffer.length, this.fileOffset);
      fs.closeSync(fd);

      this.fileOffset = stats.size;

      const lines = buffer.toString('utf-8').split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const entry: JournalEntry = JSON.parse(line);
          this.processEntry(entry);
        } catch {}
      }
    } catch {}
  }

  private resetWatchdog(): void {
    if (this.watchdogTimer) { clearTimeout(this.watchdogTimer); }
    this.watchdogTimer = setTimeout(() => {
      if (this.state === ClaudeState.THINKING || this.state === ClaudeState.PERMISSION_NEEDED) {
        this.setState(ClaudeState.IDLE);
      }
    }, 10000);
  }

  private processEntry(entry: JournalEntry): void {
    this.resetWatchdog();
    const role = entry.message?.role;
    const stopReason = entry.message?.stop_reason;

    if (role === 'assistant') {
      if (stopReason === 'end_turn') {
        this.clearToolUseTimer();
        this.idleTimer = setTimeout(() => {
          this.setState(ClaudeState.IDLE);
        }, 2000);
      } else if (stopReason === 'tool_use') {
        this.clearToolUseTimer();
        this.toolUseTimer = setTimeout(() => {
          if (this.state === ClaudeState.THINKING) {
            this.setState(ClaudeState.PERMISSION_NEEDED);
          }
        }, 3000);
        this.setState(ClaudeState.THINKING);
      } else {
        this.setState(ClaudeState.THINKING);
      }
    }

    if (role === 'user') {
      this.clearToolUseTimer();
      if (this.idleTimer) {
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
      }
      this.setState(ClaudeState.THINKING);
    }

    if (entry.type === 'queue-operation' && entry.operation === 'enqueue') {
      this.setState(ClaudeState.THINKING);
    }
  }

  private setState(newState: ClaudeState): void {
    if (this.state !== newState) {
      this.state = newState;
      this._onStateChange.fire(newState);
    }
  }

  private clearToolUseTimer(): void {
    if (this.toolUseTimer) {
      clearTimeout(this.toolUseTimer);
      this.toolUseTimer = null;
    }
  }
}
