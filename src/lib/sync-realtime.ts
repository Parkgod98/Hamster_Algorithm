import { createAdminClient } from "./supabase";
import type { SyncObserver } from "./sync-stream";

type Client = ReturnType<typeof createAdminClient>;
type Feed = {
  client: Client;
  channel: ReturnType<Client["channel"]>;
  observers: Set<SyncObserver>;
  ready: boolean;
  readyTimer?: ReturnType<typeof setTimeout>;
};

// Concurrent foreground tabs served by one warm instance share the upstream
// socket. Only the server knows the private channel and opaque routing keys.
const feeds = new Map<string, Feed>();

export function observeSync(topic: string, observer: SyncObserver) {
  let feed = feeds.get(topic);
  if (!feed) {
    const client = createAdminClient();
    const channel = client.channel(topic,{ config: { private: true, broadcast: { replication_ready: true } } });
    const created: Feed = { client, channel, observers: new Set([observer]), ready: false };
    feeds.set(topic,created);
    feed = created;
    function confirmDelivery() {
      clearTimeout(created.readyTimer);
      created.readyTimer = undefined;
      created.ready = true;
      for (const item of created.observers) item.ready();
    }
    channel.on("broadcast",{ event: "invalidate" },({ payload }) => {
      const routes = payload?.all === true ? null : new Set<string>(Array.isArray(payload?.routes) ? payload.routes : []);
      for (const item of created.observers) item.wake(routes);
    }).on("system", {}, (message) => {
      if (message.extension === "system" && message.status === "ok") confirmDelivery();
    }).subscribe(status => {
      if (status === "SUBSCRIBED") {
        // Older Realtime servers acknowledge the socket but do not announce
        // WAL readiness. Reconcile the journal once after their cold start.
        if (!created.ready && !created.readyTimer) created.readyTimer = setTimeout(confirmDelivery, 2000);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        clearTimeout(created.readyTimer);
        created.readyTimer = undefined;
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
      clearTimeout(joined.readyTimer);
      feeds.delete(topic);
      void joined.client.removeChannel(joined.channel).catch(() => {}).finally(() => joined.client.realtime.disconnect());
    }
  };
}
