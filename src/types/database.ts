export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          username: string | null
          display_name: string | null
          created_at: string
          week_starts_on: number
          theme: string | null
          personal_context: string | null
          ai_tone: 'stoic' | 'friendly' | 'wise'
          claude_api_key: string | null
        }
        Insert: {
          id: string
          username?: string | null
          display_name?: string | null
          created_at?: string
          week_starts_on?: number
          theme?: string | null
          personal_context?: string | null
          ai_tone?: 'stoic' | 'friendly' | 'wise'
          claude_api_key?: string | null
        }
        Update: {
          id?: string
          username?: string | null
          display_name?: string | null
          created_at?: string
          week_starts_on?: number
          theme?: string | null
          personal_context?: string | null
          ai_tone?: 'stoic' | 'friendly' | 'wise'
          claude_api_key?: string | null
        }
        Relationships: []
      }
      habits: {
        Row: {
          id: string
          user_id: string
          label: string
          description: string | null
          category: 'health' | 'work' | 'family' | 'learning' | 'other'
          emoji: string | null
          sort_order: number
          created_at: string
          archived_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          label: string
          description?: string | null
          category?: 'health' | 'work' | 'family' | 'learning' | 'other'
          emoji?: string | null
          sort_order?: number
          created_at?: string
          archived_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          label?: string
          description?: string | null
          category?: 'health' | 'work' | 'family' | 'learning' | 'other'
          emoji?: string | null
          sort_order?: number
          created_at?: string
          archived_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'habits_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      daily_entries: {
        Row: {
          id: string
          user_id: string
          date: string
          focus: string | null
          reflection: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          date: string
          focus?: string | null
          reflection?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          date?: string
          focus?: string | null
          reflection?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'daily_entries_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      habit_completions: {
        Row: {
          id: string
          user_id: string
          habit_id: string
          date: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          habit_id: string
          date: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          habit_id?: string
          date?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'habit_completions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'habit_completions_habit_id_fkey'
            columns: ['habit_id']
            isOneToOne: false
            referencedRelation: 'habits'
            referencedColumns: ['id']
          }
        ]
      }
      tasks: {
        Row: {
          id: string
          user_id: string
          date: string
          category: 'work' | 'self' | 'family'
          text: string
          completed: boolean
          first_step: string | null
          sort_order: number
          created_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          date: string
          category?: 'work' | 'self' | 'family'
          text: string
          completed?: boolean
          first_step?: string | null
          sort_order?: number
          created_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          date?: string
          category?: 'work' | 'self' | 'family'
          text?: string
          completed?: boolean
          first_step?: string | null
          sort_order?: number
          created_at?: string
          completed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'tasks_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      year_themes: {
        Row: {
          id: string
          user_id: string
          year: number
          theme: string
        }
        Insert: {
          id?: string
          user_id: string
          year: number
          theme: string
        }
        Update: {
          id?: string
          user_id?: string
          year?: number
          theme?: string
        }
        Relationships: [
          {
            foreignKeyName: 'year_themes_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      friendships: {
        Row: {
          id: string
          requester_id: string
          addressee_id: string
          status: 'pending' | 'accepted' | 'declined' | 'blocked'
          created_at: string
          responded_at: string | null
        }
        Insert: {
          id?: string
          requester_id: string
          addressee_id: string
          status?: 'pending' | 'accepted' | 'declined' | 'blocked'
          created_at?: string
          responded_at?: string | null
        }
        Update: {
          id?: string
          requester_id?: string
          addressee_id?: string
          status?: 'pending' | 'accepted' | 'declined' | 'blocked'
          created_at?: string
          responded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'friendships_requester_id_fkey'
            columns: ['requester_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'friendships_addressee_id_fkey'
            columns: ['addressee_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      activities: {
        Row: {
          id: string
          user_id: string
          type: 'task_completed' | 'habit_completed' | 'focus_set' | 'streak_achieved' | 'reflection_written'
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: 'task_completed' | 'habit_completed' | 'focus_set' | 'streak_achieved' | 'reflection_written'
          metadata?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          type?: 'task_completed' | 'habit_completed' | 'focus_set' | 'streak_achieved' | 'reflection_written'
          metadata?: Json | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'activities_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      tower_items: {
        Row: {
          id: string
          user_id: string
          text: string
          status: 'active' | 'waiting' | 'someday' | 'done'
          waiting_on: string | null
          expects_by: string | null
          effort: 'quick' | 'medium' | 'deep' | null
          is_event: boolean
          last_touched: string
          created_at: string
          done_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          text: string
          status?: 'active' | 'waiting' | 'someday' | 'done'
          waiting_on?: string | null
          expects_by?: string | null
          effort?: 'quick' | 'medium' | 'deep' | null
          is_event?: boolean
          last_touched?: string
          created_at?: string
          done_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          text?: string
          status?: 'active' | 'waiting' | 'someday' | 'done'
          waiting_on?: string | null
          expects_by?: string | null
          effort?: 'quick' | 'medium' | 'deep' | null
          is_event?: boolean
          last_touched?: string
          created_at?: string
          done_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'tower_items_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      packs: {
        Row: {
          id: string
          user_id: string
          label: string
          total: number
          created_at: string
          archived_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          label: string
          total: number
          created_at?: string
          archived_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          label?: string
          total?: number
          created_at?: string
          archived_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'packs_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      pack_sessions: {
        Row: {
          id: string
          pack_id: string
          date: string
          note: string | null
          created_at: string
        }
        Insert: {
          id?: string
          pack_id: string
          date: string
          note?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          pack_id?: string
          date?: string
          note?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'pack_sessions_pack_id_fkey'
            columns: ['pack_id']
            isOneToOne: false
            referencedRelation: 'packs'
            referencedColumns: ['id']
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Helper types for easier usage
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type InsertTables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type UpdateTables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']

// Convenience type aliases
export type Profile = Tables<'profiles'>
export type Habit = Tables<'habits'>
export type DailyEntry = Tables<'daily_entries'>
export type HabitCompletion = Tables<'habit_completions'>
export type Task = Tables<'tasks'>
export type YearTheme = Tables<'year_themes'>
export type Friendship = Tables<'friendships'>
export type Activity = Tables<'activities'>
export type TowerItemRow = Tables<'tower_items'>
export type Pack = Tables<'packs'>
export type PackSession = Tables<'pack_sessions'>
