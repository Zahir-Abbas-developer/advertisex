import type { Metadata } from "next";

import { MessagesView } from "@/components/messages/MessagesView";
import { PageHeader } from "@/components/ui/PageHeader";
import { requirePage } from "@/modules/rbac/server";

export const metadata: Metadata = { title: "Messages" };

/**
 * Client conversations for the team (Phase 6 scope 6): the founder sees
 * every thread, including each client's private founder channel; everyone
 * else sees the team threads of clients they're permitted to.
 */
export default async function MessagesPage(props: { searchParams: Promise<{ client?: string }> }) {
  const searchParams = await props.searchParams;
  const principal = await requirePage("read", "message");
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Clients"
        title="Messages"
        description={principal.role === "FOUNDER" ? "Every client conversation, including private founder channels." : "Conversations with the clients you work for."}
      />
      <MessagesView audience="team" clientId={searchParams.client} />
    </div>
  );
}
