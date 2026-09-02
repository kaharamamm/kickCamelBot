export type KickBadge = {
  text: string;
  type: string;
  count?: number;
};

export type KickIdentity = {
  username_color?: string;
  badges: KickBadge[];
};

export type KickActor = {
  is_anonymous?: boolean;
  user_id: number;
  username: string;
  is_verified?: boolean;
  profile_picture?: string;
  channel_slug?: string;
  identity?: KickIdentity | null;
};

export type ChatMessageEvent = {
  message_id: string;
  content: string;
  created_at?: string;
  emotes?: unknown[];
  replies_to?: {
    message_id: string;
    content: string;
    sender: KickActor;
  } | null;
  broadcaster: KickActor;
  sender: KickActor;
};

export type KickUser = {
  user_id: number;
  name: string;
  email?: string;
  profile_picture?: string;
};

export type KickChannel = {
  broadcaster_user_id: number;
  slug: string;
  stream_title: string;
  channel_description?: string;
  category?: { id: number; name: string; thumbnail?: string };
  stream?: { is_live?: boolean; viewer_count?: number; start_time?: string };
};

export type KicksLeaderboardEntry = {
  user_id: number;
  username: string;
  gifted_amount: number;
  rank: number;
};

export type KicksLeaderboard = {
  lifetime: KicksLeaderboardEntry[];
  month: KicksLeaderboardEntry[];
  week: KicksLeaderboardEntry[];
};

export type ChannelReward = {
  id: string;
  title: string;
  cost: number;
  description?: string;
  is_enabled: boolean;
  is_paused?: boolean;
  is_user_input_required?: boolean;
  background_color?: string;
};

export type TokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  user?: KickUser;
};

export type IncomingChat = {
  messageId: string;
  content: string;
  sender: KickActor;
  broadcaster: KickActor;
  replyToId?: string;
  replyToName?: string;
  replyToContent?: string;
  emotes?: unknown;
};
