import { redirect } from "next/navigation";
import { CONNECTABLE_PROVIDERS } from "@distribution/publishing";
import { getSession } from "@/lib/auth";
import { getOrCreateConnection, listChannels } from "@/lib/publishing";
import { AppShell, PageHeader } from "@/components/AppShell";
import { ChannelsManager } from "@/components/ChannelsManager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Channels · Distribution" };

export default async function ChannelsPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/channels");
  const connection = await getOrCreateConnection(session.accountId);
  const channels = connection ? await listChannels(session.accountId) : [];
  return (
    <AppShell email={session.email}>
      <PageHeader
        title="Channels"
        description="The accounts your promos and clips publish to. Connect once; every product in this workspace can use them."
      />
      <ChannelsManager
        // A new connection replaces the key form with the manager; remount so
        // its channel state starts from what the server just cached.
        key={connection?.id ?? "no-connection"}
        connectionId={connection?.id ?? null}
        channels={channels}
        checkedAt={connection?.checkedAt ?? null}
        providers={CONNECTABLE_PROVIDERS.map((p) => ({ id: p.id, label: p.label }))}
      />
    </AppShell>
  );
}
