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
  scheduled_at: string;
  status: 'pending' | 'posted' | 'failed';
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
