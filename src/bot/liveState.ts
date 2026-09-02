import { getMyChannelCached } from "../kick/api.js";
import { lookupPublicChannel } from "../kick/publicChannel.js";
import { getSettings } from "./settings.js";

export async function channelLiveStatus(
  slug: string,
  broadcasterUserId: number,
): Promise<{
  isHome: boolean;
  live: boolean;
  chatterOk: boolean;
  title?: string;
  game?: string;
  startedAt?: number;
}> {
  const settings = getSettings();
  try {
    const home = await getMyChannelCached();
    if (home.broadcaster_user_id === broadcasterUserId) {
      const live = Boolean(home.stream?.is_live);
      const startedAt = home.stream?.start_time ? Date.parse(home.stream.start_time) : undefined;
      return {
        isHome: true,
        live,
        chatterOk: live || settings.engageOffline,
        title: home.stream_title,
        game: home.category?.name,
        startedAt: Number.isFinite(startedAt) ? startedAt : undefined,
      };
    }
  } catch {
    // extra channel
  }
  try {
    const pub = await lookupPublicChannel(slug);
    return {
      isHome: false,
      live: pub.live,
      chatterOk: pub.live,
      title: pub.title,
      game: pub.game,
      startedAt: pub.startedAt,
    };
  } catch {
    return { isHome: false, live: false, chatterOk: false };
  }
}
