/**
 * SAWARA - Supabase Database Client Initialization
 * Supports live Supabase credentials and seamless local storage sync
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface AnalysisLogRow {
  log_id: string;
  session_id: string;
  target_pitch: number;
  actual_pitch: number;
  pitch_deviation?: number;
  ai_tip?: string;
  created_at?: string;
}

// Environment variables or localStorage config
const getStoredConfig = () => {
  if (typeof window === 'undefined') {
    return { url: '', key: '' };
  }
  const url =
    localStorage.getItem('sawara_supabase_url') ||
    (import.meta.env.VITE_SUPABASE_URL as string) ||
    '';
  const key =
    localStorage.getItem('sawara_supabase_anon_key') ||
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ||
    '';
  return { url, key };
};

const initialConfig = getStoredConfig();

const isValidSupabaseUrl = (url: string): boolean => {
  return Boolean(url && url.startsWith('https://') && !url.includes('<your-supabase-project-id>'));
};

let realClient: SupabaseClient | null = null;

if (isValidSupabaseUrl(initialConfig.url) && initialConfig.key) {
  try {
    realClient = createClient(initialConfig.url, initialConfig.key);
  } catch (err) {
    console.warn('Could not initialize live Supabase client, using fallback storage:', err);
  }
}

/**
 * Local simulation buffer for analysis_log table
 */
const LOCAL_STORAGE_KEY = 'sawara_analysis_logs_v1';

export function getLocalLogs(): AnalysisLogRow[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLocalLogs(logs: AnalysisLogRow[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(logs.slice(0, 100)));
  } catch {
    // Ignore storage quota
  }
}

/**
 * Unified Supabase wrapper matching the exact Supabase query interface:
 * supabase.from('analysis_log').insert([...]).select()
 */
export const supabase = {
  from(tableName: string) {
    if (tableName === 'analysis_log') {
      return {
        insert(rows: AnalysisLogRow[]) {
          const execute = async () => {
            const processedRows = rows.map((row) => {
              const dev = Number((row.actual_pitch - row.target_pitch).toFixed(2));
              let tip = 'Pitch Perfect! Hold current note posture.';
              if (row.actual_pitch < row.target_pitch - 2.0) {
                tip = 'Pitch Flat. Increase breath support and lift soft palate.';
              } else if (row.actual_pitch > row.target_pitch + 2.0) {
                tip = 'Pitch Sharp. Relax vocal cord tension and lower larynx slightly.';
              }
              return {
                ...row,
                pitch_deviation: dev,
                ai_tip: tip,
                created_at: new Date().toISOString(),
              };
            });

            // Save to local reactive cache for instant UI feedback
            const currentLogs = getLocalLogs();
            const updatedLogs = [...processedRows, ...currentLogs].slice(0, 50);
            saveLocalLogs(updatedLogs);

            // If live Supabase client is connected, execute remote insert
            if (realClient) {
              try {
                const res = await realClient
                  .from('analysis_log')
                  .insert(rows)
                  .select();
                if (res.error) {
                  console.warn('Supabase remote insert warning:', res.error);
                  return {
                    data: processedRows,
                    error: null,
                    remoteError: res.error.message,
                    isLive: false,
                  };
                }
                return {
                  data: (res.data as AnalysisLogRow[]) || processedRows,
                  error: null,
                  isLive: true,
                };
              } catch (networkErr: any) {
                console.warn('Supabase remote error:', networkErr);
                return {
                  data: processedRows,
                  error: null,
                  remoteError: networkErr?.message || 'Network warning',
                  isLive: false,
                };
              }
            }

            return {
              data: processedRows,
              error: null,
              isLive: false,
            };
          };

          return {
            select: async () => {
              return execute();
            },
            then: (onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any) => {
              return execute().then(onfulfilled, onrejected);
            },
          };
        },

        async select(query = '*') {
          if (realClient) {
            try {
              const res = await realClient
                .from('analysis_log')
                .select(query)
                .order('created_at', { ascending: false })
                .limit(20);
              if (!res.error && res.data) {
                return { data: (res.data as unknown as AnalysisLogRow[]), error: null };
              }
            } catch {
              // fallback to local logs
            }
          }
          return { data: getLocalLogs(), error: null };
        },
      };
    }

    if (realClient) {
      return realClient.from(tableName);
    }

    return {
      insert: (_data: any) => ({
        select: async () => ({ data: [], error: null }),
        then: (fn: any) => Promise.resolve({ data: [], error: null }).then(fn),
      }),
      select: async () => ({ data: [], error: null }),
    };
  },
};

/**
 * Configure or reconfigure Supabase credentials at runtime
 */
export function configureSupabase(url: string, anonKey: string): { success: boolean; message: string } {
  if (!url || !anonKey) {
    localStorage.removeItem('sawara_supabase_url');
    localStorage.removeItem('sawara_supabase_anon_key');
    realClient = null;
    return { success: true, message: 'Switched to local offline cache mode.' };
  }

  if (!url.startsWith('https://')) {
    return { success: false, message: 'Supabase URL must start with https://' };
  }

  try {
    realClient = createClient(url, anonKey);
    localStorage.setItem('sawara_supabase_url', url);
    localStorage.setItem('sawara_supabase_anon_key', anonKey);
    return { success: true, message: 'Supabase credentials saved & connected!' };
  } catch (err: any) {
    return { success: false, message: err?.message || 'Failed to initialize Supabase client.' };
  }
}

export function getSupabaseStatus(): {
  isConfigured: boolean;
  url: string;
  isMock: boolean;
} {
  const cfg = getStoredConfig();
  const configured = Boolean(isValidSupabaseUrl(cfg.url) && !!cfg.key && !!realClient);
  return {
    isConfigured: configured,
    url: cfg.url || 'Local In-Memory / Hypertable Stream',
    isMock: !configured,
  };
}
