import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const SHORTS_URL = 'https://www.youtube.com/shorts';
const PLATFORM = process.platform;

const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/opt/google/chrome/chrome',
    '/usr/bin/brave-browser',
    '/opt/brave.com/brave/brave',
  ],
};

const LOCK_FILE = path.join(os.homedir(), '.claude', 'claude-scroll.lock');

export class BrowserOverlay {
  private active = false;
  private owner = false;
  private raiseTimer: NodeJS.Timeout | null = null;
  private readonly extensionUri: vscode.Uri;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  get isOpen(): boolean { return this.active; }

  async show(): Promise<void> {
    if (this.active) { return; }
    this.active = true;

    if (!this.acquireLock()) { return; }

    const chromePath = this.findChrome();
    if (!chromePath) {
      this.openFallback();
      return;
    }

    const bounds = await this.getVSCodeBounds();
    const config = vscode.workspace.getConfiguration('claude-scroll');
    const winW = config.get<number>('windowWidth', 400);
    const side = config.get<string>('windowSide', 'right');
    const winX = side === 'left' ? bounds.x : bounds.x + bounds.w - winW;
    const winY = bounds.y;
    const winH = bounds.h;

    child_process.spawn(chromePath, [
      `--app=${SHORTS_URL}`,
      '--new-window',
      '--disable-extensions',
    ], { detached: true, stdio: 'ignore' });

    const delay = PLATFORM === 'win32' ? 2000 : 1200;
    setTimeout(() => {
      if (!this.active) { return; }
      this.resizeChromeWindow(winX, winY, winW, winH);
      this.raiseTimer = setInterval(() => {
        if (!this.active) { return; }
        this.raiseShortsWindow();
      }, 5000);
    }, delay);
  }

  hide(): void {
    if (!this.active) { return; }
    this.active = false;
    if (this.raiseTimer) { clearInterval(this.raiseTimer); this.raiseTimer = null; }
    if (this.owner) {
      this.closeChromeWindow();
      this.releaseLock();
    }
  }

  private acquireLock(): boolean {
    try {
      // Check if existing lock is stale (process no longer running)
      try {
        const existingPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'));
        if (!isNaN(existingPid) && existingPid !== process.pid) {
          try {
            process.kill(existingPid, 0); // throws if process doesn't exist
          } catch (e: any) {
            if (e.code === 'ESRCH') {
              fs.unlinkSync(LOCK_FILE); // stale lock, remove it
            } else {
              this.owner = false;
              return false; // process exists (EPERM), lock is valid
            }
          }
        }
      } catch {}

      fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
      this.owner = true;
      return true;
    } catch {
      this.owner = false;
      return false;
    }
  }

  private releaseLock(): void {
    try {
      const content = fs.readFileSync(LOCK_FILE, 'utf8');
      if (content === String(process.pid)) {
        fs.unlinkSync(LOCK_FILE);
      }
    } catch {}
    this.owner = false;
  }

  private raiseShortsWindow(): void {
    if (PLATFORM === 'win32') {
      const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
"@
$HWND_TOPMOST = [IntPtr](-1)
$procs = Get-Process -Name "chrome","brave" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match "YouTube|Shorts" }
foreach ($proc in $procs) {
    [WinAPI]::SetWindowPos($proc.MainWindowHandle, $HWND_TOPMOST, 0, 0, 0, 0, 0x0003)
}
`;
      this.runPowerShell(script);
    } else if (PLATFORM === 'linux') {
      child_process.exec(`xdotool search --name "YouTube" windowactivate 2>/dev/null`);
    } else {
      this.runAppleScript(`
tell application "Google Chrome"
  set winIndex to 0
  set windowList to every window
  repeat with i from 1 to count of windowList
    set win to item i of windowList
    try
      if URL of active tab of win starts with "https://www.youtube.com/shorts" then
        set winIndex to i
      end if
    end try
  end repeat
end tell
if winIndex > 0 then
  tell application "System Events"
    tell process "Google Chrome"
      perform action "AXRaise" of window winIndex
    end tell
  end tell
end if
`);
    }
  }

  private openFallback(): void {
    if (PLATFORM === 'win32') {
      child_process.exec(`start "" "${SHORTS_URL}"`);
    } else if (PLATFORM === 'linux') {
      child_process.exec(`xdg-open "${SHORTS_URL}"`);
    } else {
      child_process.exec(`open "${SHORTS_URL}"`);
    }
  }

  private getVSCodeBounds(): Promise<{ x: number; y: number; w: number; h: number }> {
    if (PLATFORM === 'win32') {
      return this.getVSCodeBoundsWindows();
    } else if (PLATFORM === 'linux') {
      return this.getVSCodeBoundsLinux();
    } else {
      return this.getVSCodeBoundsMac();
    }
  }

  private getVSCodeBoundsMac(): Promise<{ x: number; y: number; w: number; h: number }> {
    return new Promise((resolve) => {
      const scriptPath = path.join(
        this.extensionUri.fsPath,
        'resources', 'scripts', 'vscode-bounds.swift'
      );
      child_process.exec(`which swift && swift "${scriptPath}"`, { timeout: 10000 }, (err, stdout) => {
        if (!err && stdout.trim()) {
          const parts = stdout.trim().split(',').map(Number);
          if (parts.length === 4 && parts.every(n => !isNaN(n))) {
            resolve({ x: parts[0], y: parts[1], w: parts[2], h: parts[3] });
            return;
          }
        }
        resolve({ x: 0, y: 30, w: 2304, h: 1208 });
      });
    });
  }

  private getVSCodeBoundsWindows(): Promise<{ x: number; y: number; w: number; h: number }> {
    return new Promise((resolve) => {
      const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)]
public struct RECT { public int Left, Top, Right, Bottom; }
public class WinAPI {
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
}
"@
$proc = Get-Process -Name "Code" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($proc) {
    $rect = New-Object RECT
    [WinAPI]::GetWindowRect($proc.MainWindowHandle, [ref]$rect)
    Write-Output "$($rect.Left),$($rect.Top),$($rect.Right - $rect.Left),$($rect.Bottom - $rect.Top)"
}
`;
      this.runPowerShell(script, (_err, stdout) => {
        if (stdout && stdout.trim()) {
          const parts = stdout.trim().split(',').map(Number);
          if (parts.length === 4 && parts.every(n => !isNaN(n))) {
            resolve({ x: parts[0], y: parts[1], w: parts[2], h: parts[3] });
            return;
          }
        }
        resolve({ x: 0, y: 0, w: 1920, h: 1080 });
      });
    });
  }

  private getVSCodeBoundsLinux(): Promise<{ x: number; y: number; w: number; h: number }> {
    return new Promise((resolve) => {
      child_process.exec(
        `xdotool search --name "Visual Studio Code" getwindowgeometry --shell 2>/dev/null | head -4`,
        (err, stdout) => {
          if (!err && stdout) {
            const x = stdout.match(/X=(\d+)/)?.[1];
            const y = stdout.match(/Y=(\d+)/)?.[1];
            const w = stdout.match(/WIDTH=(\d+)/)?.[1];
            const h = stdout.match(/HEIGHT=(\d+)/)?.[1];
            if (x && y && w && h) {
              resolve({ x: Number(x), y: Number(y), w: Number(w), h: Number(h) });
              return;
            }
          }
          resolve({ x: 0, y: 0, w: 1920, h: 1080 });
        }
      );
    });
  }

  private resizeChromeWindow(x: number, y: number, w: number, h: number): void {
    if (PLATFORM === 'win32') {
      const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
"@
$procs = Get-Process -Name "chrome","brave" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match "YouTube|Shorts" }
foreach ($proc in $procs) {
    [WinAPI]::SetWindowPos($proc.MainWindowHandle, [IntPtr]::Zero, ${x}, ${y}, ${w}, ${h}, 0x0040)
}
`;
      this.runPowerShell(script);
    } else if (PLATFORM === 'linux') {
      child_process.exec(
        `xdotool search --name "YouTube" set_window --name "claude-scroll-shorts" windowmove ${x} ${y} windowsize ${w} ${h} 2>/dev/null`
      );
    } else {
      this.runAppleScript(`
tell application "Google Chrome"
  set windowList to every window
  repeat with win in windowList
    try
      if URL of active tab of win starts with "https://www.youtube.com/shorts" then
        set bounds of win to {${x}, ${y}, ${x + w}, ${y + h}}
      end if
    end try
  end repeat
end tell
`);
    }
  }

  private closeChromeWindow(): void {
    if (PLATFORM === 'win32') {
      const script = `
$procs = Get-Process -Name "chrome","brave" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match "YouTube|Shorts" }
foreach ($proc in $procs) { $proc.CloseMainWindow() | Out-Null }
Start-Sleep -Milliseconds 200
$code = Get-Process -Name "Code" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($code) {
    Add-Type @"
using System.Runtime.InteropServices;
public class Win { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); }
"@
    [Win]::SetForegroundWindow($code.MainWindowHandle)
}
`;
      this.runPowerShell(script);
    } else if (PLATFORM === 'linux') {
      child_process.exec(`xdotool search --name "YouTube" windowclose 2>/dev/null`);
    } else {
      this.runAppleScript(`
try
  tell application "Visual Studio Code" to activate
end try
try
  tell application "Code" to activate
end try
delay 0.1
tell application "Google Chrome"
  set windowList to every window
  repeat with win in windowList
    try
      if URL of active tab of win starts with "https://www.youtube.com/shorts" then
        close win
      end if
    end try
  end repeat
end tell
`);
    }
  }

  private runPowerShell(script: string, callback?: (err: Error | null, stdout: string) => void): void {
    const tmpFile = path.join(os.tmpdir(), `claude-scroll-${Date.now()}.ps1`);
    fs.writeFileSync(tmpFile, script, 'utf8');
    child_process.exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`, (err, stdout) => {
      fs.unlink(tmpFile, () => {});
      if (callback) { callback(err, stdout); }
    });
  }

  private runAppleScript(script: string, callback?: (err: Error | null, stdout: string) => void): void {
    const tmpFile = path.join(os.tmpdir(), `claude-scroll-${Date.now()}.applescript`);
    fs.writeFileSync(tmpFile, script, 'utf8');
    child_process.exec(`osascript "${tmpFile}"`, (err, stdout) => {
      fs.unlink(tmpFile, () => {});
      if (callback) { callback(err, stdout); }
    });
  }

  private findChrome(): string | null {
    const paths = CHROME_PATHS[PLATFORM] ?? CHROME_PATHS['linux'];
    for (const p of paths) {
      if (fs.existsSync(p)) { return p; }
    }
    return null;
  }

  dispose(): void {
    this.hide();
    this.releaseLock();
  }
}
