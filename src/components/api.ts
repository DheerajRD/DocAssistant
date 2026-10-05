export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data as T;
}
export interface SettingsData {
  email: string;
  profile: { display_name: string; timezone: string; deleting_at: string | null };
  preferences: { reminder_offsets: number[]; whatsapp_reminders: boolean };
  whatsapp: { phone: string; verified_at: string } | null;
  reminders: {
    id: string;
    label: string;
    deadline: string;
    offset_days: number;
    scheduled_date: string;
    state: string;
  }[];
  history: { id: string; outcome: string; created_at: string }[];
}
