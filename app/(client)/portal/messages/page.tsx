import { MessagesView } from "@/components/messages/MessagesView";
import { requireClientPage } from "@/modules/rbac/server";

export const metadata = { title: "Messages · Advertise X" };

/** Conversations with the team, and privately with the founders (Phase 6 scope 6). */
export default async function PortalMessages() {
  await requireClientPage();
  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow text-brand">Messages</p>
        <h1 className="mt-2 font-display text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">Talk to us</h1>
        <p className="mt-2 max-w-xl text-sm text-ink/60">Message the team working on your projects, or write privately to the founders.</p>
      </header>
      <MessagesView audience="client" />
    </div>
  );
}
