export enum ClaudeState {
  IDLE = 'idle',
  THINKING = 'thinking',
  PERMISSION_NEEDED = 'permission_needed'
}

export interface JournalEntry {
  type?: string;
  message?: {
    role?: string;
    stop_reason?: string;
    content?: Array<{
      type: string;
    }>;
  };
  operation?: string;
  userType?: string;
}
