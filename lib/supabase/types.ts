export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type FileEventDirection = "drive_to_discord" | "discord_to_drive";

export interface Database {
  public: {
    Tables: {
      channel_mappings: {
        Row: {
          channel_id: string;
          folder_id: string;
          folder_name: string | null;
          linked_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          channel_id: string;
          folder_id: string;
          folder_name?: string | null;
          linked_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          channel_id?: string;
          folder_id?: string;
          folder_name?: string | null;
          linked_by?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      drive_sync_state: {
        Row: {
          id: string;
          page_token: string;
          last_synced_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          page_token: string;
          last_synced_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          page_token?: string;
          last_synced_at?: string;
          updated_at?: string;
        };
      };
      drive_watches: {
        Row: {
          channel_id: string;
          resource_id: string | null;
          token: string;
          expiration: string;
          created_at: string;
        };
        Insert: {
          channel_id: string;
          resource_id?: string | null;
          token: string;
          expiration: string;
          created_at?: string;
        };
        Update: {
          channel_id?: string;
          resource_id?: string | null;
          token?: string;
          expiration?: string;
          created_at?: string;
        };
      };
      drive_folder_cache: {
        Row: {
          folder_id: string;
          name: string;
          parent_id: string | null;
          is_trashed: boolean;
          updated_at: string;
          expires_at: string;
        };
        Insert: {
          folder_id: string;
          name: string;
          parent_id?: string | null;
          is_trashed?: boolean;
          updated_at?: string;
          expires_at?: string;
        };
        Update: {
          folder_id?: string;
          name?: string;
          parent_id?: string | null;
          is_trashed?: boolean;
          updated_at?: string;
          expires_at?: string;
        };
      };
      file_events: {
        Row: {
          id: number;
          file_id: string;
          modified_time: string;
          version: string;
          direction: FileEventDirection;
          discord_message_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          file_id: string;
          modified_time: string;
          version?: string;
          direction: FileEventDirection;
          discord_message_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          file_id?: string;
          modified_time?: string;
          version?: string;
          direction?: FileEventDirection;
          discord_message_id?: string | null;
          created_at?: string;
        };
      };
    };
  };
}

export type ChannelMappingRow = Database["public"]["Tables"]["channel_mappings"]["Row"];
export type DriveSyncStateRow = Database["public"]["Tables"]["drive_sync_state"]["Row"];
export type DriveWatchRow = Database["public"]["Tables"]["drive_watches"]["Row"];
export type DriveFolderCacheRow = Database["public"]["Tables"]["drive_folder_cache"]["Row"];
export type FileEventRow = Database["public"]["Tables"]["file_events"]["Row"];

