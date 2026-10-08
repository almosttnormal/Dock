// Shared Discord Application Command Definitions
// Application Command Types:
// 1 = CHAT_INPUT (Slash commands)
// 3 = MESSAGE (Message context menu commands)

export const COMMANDS = [
  {
    name: "link",
    description: "Link this Discord channel to a Google Drive folder via Dock (Admin only)",
    type: 1, // CHAT_INPUT
    options: [
      {
        name: "folder_id",
        description: "Google Drive Folder ID to map to this channel",
        type: 3, // STRING
        required: true,
      },
      {
        name: "folder_name",
        description: "Human-readable label for this folder (optional)",
        type: 3, // STRING
        required: false,
      },
    ],
  },
  {
    name: "unlink",
    description: "Unlink this Discord channel from its Google Drive folder in Dock (Admin only)",
    type: 1, // CHAT_INPUT
  },
  {
    name: "Save to Drive",
    type: 3, // MESSAGE context menu
  },
];
