import { notFound } from "next/navigation";

import { Showcase } from "./Showcase";

export const metadata = { title: "Design system · Advertise X" };

/**
 * The living render of docs/DESIGN_SYSTEM.md — every token and primitive on
 * one page, so a drift between doctrine and code is something you can *see*.
 *
 * Development-only by contract (CLAUDE.md Phase 1, scope 7): in production
 * this route does not exist. It sits outside the (app) shell so it needs no
 * session — there is nothing here an unauthenticated developer shouldn't see,
 * because nothing here is data.
 */
export default function DesignSystemPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Showcase />;
}
