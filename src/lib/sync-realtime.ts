import { createAdminClient } from "./supabase";
import type { SyncObserver } from "./sync-stream";

type Client = ReturnType<typeof createAdminClient>;
type Feed = {
  client: Client;
  channel: ReturnType<Client["channel"]>;
  observers: Set<SyncObserver>;
  ready: boolean;
};

// Concurrent foreground tabs served by one warm instance share the upstream
// socket. Only the server knows the private channel and opaque routing keys.
const feeds = new Map<string, Feed>();

export function observeSync(topic: string, observer: SyncObserver) {
  let feed = feeds.get(topic);
  if (!feed) {
    const client = createAdminClient();
    const channel = client.channel(topic,{ config: { private: true } });
    const created: Feed = { client, channel, observers: new Set([observer]), ready: false };
    feeds.set(topic,created);
    feed = created;
    channel.on("broadcast",{ event: "invalidate" },({ payload }) => {
      const routes = payload?.all === true ? null : new Set<string>(Array.isArray(payload?.routes) ? payload.routes : []);
      for (const item of created.observers) item.wake(routes);
    }).subscribe(status => {
      if (status === "SUBSCRIBED") {
        created.ready = true;
        for (const item of created.observers) item.ready();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        created.ready = false;
        for (const item of [...created.observers]) item.disconnect();
      }
    });
  } else {
    feed.observers.add(observer);
    if (feed.ready) observer.ready();
  }
  const joined = feed;
  return () => {
    joined.observers.delete(observer);
    if (!joined.observers.size && feeds.get(topic) === joined) {
      feeds.delete(topic);
      void joined.client.removeChannel(joined.channel).catch(() => {}).finally(() => joined.client.realtime.disconnect());
    }
  };
}
