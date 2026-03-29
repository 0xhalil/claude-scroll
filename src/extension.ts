import * as vscode from 'vscode';
import { ClaudeMonitor } from './claudeMonitor';
import { BrowserOverlay } from './browserOverlay';
import { ClaudeState } from './types';

let statusBarItem: vscode.StatusBarItem;
let monitor: ClaudeMonitor;
let overlay: BrowserOverlay;
let enabled = true;

export function activate(context: vscode.ExtensionContext) {
  overlay = new BrowserOverlay(context.extensionUri);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'claude-scroll.toggle';
  statusBarItem.show();
  updateStatusBar(ClaudeState.IDLE);

  const toggleCommand = vscode.commands.registerCommand('claude-scroll.toggle', () => {
    if (overlay.isOpen) {
      overlay.hide();
    } else {
      enabled = !enabled;
      if (!enabled) { overlay.hide(); }
      updateStatusBar(monitor?.getState() ?? ClaudeState.IDLE);
    }
  });

  context.subscriptions.push(statusBarItem, toggleCommand);

  monitor = new ClaudeMonitor();
  monitor.onStateChange((state) => {
    updateStatusBar(state);
    if (!enabled) { return; }
    switch (state) {
      case ClaudeState.THINKING: overlay.show(); break;
      case ClaudeState.IDLE:
      case ClaudeState.PERMISSION_NEEDED: overlay.hide(); break;
    }
  });
  monitor.start();

  console.log('Claude Scroll: Extension activated');
}

function updateStatusBar(state: ClaudeState): void {
  const green = new vscode.ThemeColor('charts.green');
  const red = new vscode.ThemeColor('charts.red');

  if (!enabled) {
    statusBarItem.text = '$(eye) Claude Scroll';
    statusBarItem.tooltip = 'Inactive — click to activate';
    statusBarItem.color = red;
    statusBarItem.backgroundColor = undefined;
    return;
  }

  switch (state) {
    case ClaudeState.THINKING:
      statusBarItem.text = '$(loading~spin) Claude Scroll';
      statusBarItem.tooltip = 'Claude is working — click to close window';
      statusBarItem.color = green;
      statusBarItem.backgroundColor = undefined;
      break;
    case ClaudeState.IDLE:
      statusBarItem.text = '$(eye) Claude Scroll';
      statusBarItem.tooltip = 'Active — Shorts will open when Claude works. Click to deactivate';
      statusBarItem.color = green;
      statusBarItem.backgroundColor = undefined;
      break;
    case ClaudeState.PERMISSION_NEEDED:
      statusBarItem.text = '$(alert) Claude Scroll';
      statusBarItem.tooltip = 'Claude is waiting for permission';
      statusBarItem.color = green;
      statusBarItem.backgroundColor = undefined;
      break;
  }
}

export function deactivate() {
  monitor?.dispose();
  overlay?.dispose();
  statusBarItem?.dispose();
}
