export interface UserData {
  id: string;
  username: string;
  displayName: string;
  profileImage: string;
  authMethod?: 'x' | 'email';
}

export interface ScheduledPost {
  id: number;
  content: string;
  /** Always ISO-8601 UTC. Canonicalised on write so SQLite's text comparison is chronological. */
  scheduled_at: string;
  /**
   * 'posting' is the in-flight claim that keeps publishing idempotent across a crash.
   * 'skipped' means the slot passed its lateness window and was deliberately not
   * published — distinct from 'failed', which is an error returned by the X API.
   */
  status: 'pending' | 'posting' | 'posted' | 'failed' | 'skipped';
  /** Discriminates real tweets from the Instagram/Substack reminders sharing this table. */
  kind?: 'tweet' | 'instagram' | 'substack';
  last_error?: string | null;
  posted_tweet_id?: string | null;
  source_url?: string | null;
  attempts?: number;
}

export interface ReportSchedule {
  id: number;
  report_type: string;
  custom_topic?: string;
  schedule_time: string;
  days: string;
  enabled: number;
  last_run?: string;
}

export interface SocialAccount {
  platform: string;
  handle: string;
}
