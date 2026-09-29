import type { DefaultSession } from "next-auth";
import type { Role } from "@/config/permissions";

/**
 * The session carries role, jobTitle and avatarColor so the shell can render
 * the sidebar identity and gate admin UI without an extra database round trip.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      jobTitle: string;
      avatarColor: string;
      /** The password version the session was issued with (ms; 0 = never changed). */
      pwv?: number;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    role: Role;
    jobTitle: string;
    avatarColor: string;
    pwv?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    jobTitle: string;
    avatarColor: string;
    pwv?: number;
  }
}
