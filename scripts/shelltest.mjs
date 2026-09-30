#!/usr/bin/env node
/**
 * shelltest — the Phase 1 login acceptance, over real HTTP.
 *
 *   "Login works for FOUNDER, MANAGER, EMPLOYEE, CLIENT; each lands in its
 *    correct shell; cross-shell access is refused server-side."
 *
 * For each role it signs in with a real session and checks where the person
 * lands, which experience renders, and that every door into another shell is
 * shut — pages by redirect, APIs by 401/403 from the handler itself. Then the
 * refusals that have no shell at all: an AI agent and an unrecognised role
 * cannot sign in, and a deactivated account is cut off on its next request.
 *
 * Needs the demo tenant (npm run db:seed) and a running server:
 *   SMOKE_BASE=http://localhost:3000 npm run shelltest
 */

import { loadEnv, Session, waitForServer } from "./smoke.mjs";

loadEnv();

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "advertisex-change-me";

const FOUNDER = "coachd@bwm.local";
const MANAGER = "rajazain@bwm.local";
const EMPLOYEE = "tayyaba@bwm.local";
const CLIENTS = [
  { email: "marco@osterianonna.example", account: "Osteria Nonna" },
  { email: "jenny@baosociety.example", account: "Bao Society" },
  { email: "sam@grindcoffee.example", account: "Grind Coffee Co." },
];
const AGENT = "atlas.agent@advertisex.example";

let failures = 0;
let checks = 0;

function check(ok, label, detail = "") {
  checks += 1;
  if (ok) {
    console.log(`  ✓ ${label}`);
    return true;
  }
  failures += 1;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  return false;
}

/** Where a page request goes: its redirect target path, or "200". */
async function landing(session, path) {
  const res = await session.fetch(path);
  if (res.status >= 300 && res.status < 400) {
    const to = new URL(res.headers.get("location"), session.base);
    return `${to.pathname}${to.search}`;
  }
  return String(res.status);
}

async function html(session, path) {
  const res = await session.fetch(path);
  return { status: res.status, body: await res.text() };
}

async function signIn(label, email) {
  const session = new Session(label);
  await session.signIn(email, SEED_PASSWORD);
  return session;
}

async function canSignIn(email) {
  try {
    await new Session("probe").signIn(email, SEED_PASSWORD);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await waitForServer();

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  const everyone = [FOUNDER, MANAGER, EMPLOYEE, ...CLIENTS.map((c) => c.email)];
  const present = await prisma.user.count({ where: { email: { in: everyone } } });
  if (present !== everyone.length) {
    console.error(`shelltest needs the demo tenant — found ${present}/${everyone.length} accounts. Run npm run db:seed.`);
    process.exit(1);
  }
  await prisma.user.updateMany({ where: { email: { in: everyone } }, data: { mustChangePassword: false } });

  try {
    // ---------------------------------------------------------------- founder
    console.log("\nFOUNDER");
    const founder = await signIn("founder", FOUNDER);
    check((await landing(founder, "/")) === "/dashboard", "lands on /dashboard");
    check((await html(founder, "/dashboard")).body.includes("Command center"), "renders the command center");
    check((await landing(founder, "/settings/departments")) === "200", "opens founder configuration");
    check((await founder.fetch("/api/team")).status === 200, "reads the team API");
    check((await landing(founder, "/portal")) === "/dashboard", "is kept out of the client portal");

    // ---------------------------------------------------------------- manager
    console.log("\nMANAGER");
    const manager = await signIn("manager", MANAGER);
    check((await landing(manager, "/")) === "/dashboard", "lands on /dashboard");
    check((await html(manager, "/dashboard")).body.includes("Command center"), "renders the command center");
    check((await landing(manager, "/admin/errors")) === "200", "opens the error log (ops)");
    check((await manager.fetch("/api/audit")).status === 403, "is refused the audit API (it spans every department — the founder's)");
    check((await landing(manager, "/settings/departments")).startsWith("/dashboard?denied"), "is refused founder configuration");
    check((await manager.fetch("/api/team")).status === 403, "is refused the team API", String((await manager.fetch("/api/team")).status));
    check((await manager.fetch("/api/settings")).status === 403, "is refused the settings API");
    check((await landing(manager, "/portal")) === "/dashboard", "is kept out of the client portal");

    // --------------------------------------------------------------- employee
    console.log("\nEMPLOYEE");
    const employee = await signIn("employee", EMPLOYEE);
    check((await landing(employee, "/")) === "/dashboard", "lands on /dashboard");
    const team = (await html(employee, "/dashboard")).body;
    check(team.includes("My work") && !team.includes("Command center"), "renders the team shell");
    check((await landing(employee, "/admin/errors")).startsWith("/dashboard?denied"), "is refused the error log");
    check((await landing(employee, "/clients")).startsWith("/dashboard?denied"), "is refused the client list");
    check((await employee.fetch("/api/clients")).status === 403, "is refused the clients API");
    check((await employee.fetch("/api/audit")).status === 403, "is refused the audit API");
    check((await employee.fetch("/api/tasks")).status === 200, "works the tasks API");
    check((await landing(employee, "/portal")) === "/dashboard", "is kept out of the client portal");

    // ----------------------------------------------------------------- clients
    for (const client of CLIENTS) {
      console.log(`\nCLIENT · ${client.account}`);
      const session = await signIn(client.email, client.email);
      check((await landing(session, "/dashboard")) === "/portal", "is sent from the team product to /portal");
      check((await landing(session, "/settings")) === "/portal", "cannot open founder configuration");
      const portal = await html(session, "/portal");
      check(portal.status === 200, "opens the portal", String(portal.status));
      check(portal.body.includes(client.account), "sees their own restaurant");
      const others = CLIENTS.filter((c) => c.account !== client.account && portal.body.includes(c.account));
      check(others.length === 0, "sees no other restaurant", others.map((o) => o.account).join(", "));

      for (const api of ["/api/leads", "/api/clients", "/api/tasks", "/api/pipeline", "/api/team", "/api/analytics", "/api/audit", "/api/service-leads", "/api/search?q=Osteria"]) {
        const status = (await session.fetch(api)).status;
        check(status === 403, `is refused ${api}`, String(status));
      }
      check((await session.fetch("/api/notifications")).status === 200, "reads their own notifications");
    }

    // ------------------------------------------------------------ no shell at all
    console.log("\nREFUSED SIGN-INS");
    check(!(await canSignIn(AGENT)), "an AI agent cannot sign in with a password");

    const stray = await prisma.user.create({
      data: {
        name: "Shelltest Unknown Role",
        email: "shelltest-unknown@advertisex.example",
        passwordHash: (await prisma.user.findUnique({ where: { email: EMPLOYEE }, select: { passwordHash: true } })).passwordHash,
        role: "ROOT",
        jobTitle: "None",
        isActive: true,
      },
    });
    try {
      check(!(await canSignIn(stray.email)), "an unrecognised role cannot sign in");
    } finally {
      await prisma.user.delete({ where: { id: stray.id } });
    }

    // A session outliving its account: the principal is read per request.
    const doomed = await signIn("deactivated", CLIENTS[0].email);
    await prisma.user.update({ where: { email: CLIENTS[0].email }, data: { isActive: false } });
    try {
      // 401 since Phase 10: the session itself ends with the account (it used to be a 403).
      check((await doomed.fetch("/api/notifications")).status === 401, "a deactivated account is refused on its next API call — its session has ended");
      check((await landing(doomed, "/portal")) === "/session-ended", "and on its next page, which clears the session");
      // The loop this replaced: /login forwarded the stale token on, the page
      // sent it back to /login. Follow every hop; it must end at the form.
      const hops = [];
      let at = "/login";
      while (hops.length < 8) {
        hops.push(at);
        const next = await landing(doomed, at);
        if (!next.startsWith("/")) break;
        at = next;
      }
      check(
        hops.length < 8 && hops.at(-1) === "/login?ended=1",
        "a stale session reaches the sign-in form in a few hops, never a loop",
        hops.join(" → "),
      );
      check((await landing(doomed, "/login")) === "200", "and the cleared session stays signed out");
    } finally {
      await prisma.user.update({ where: { email: CLIENTS[0].email }, data: { isActive: true } });
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log(`\n${checks} checks`);
  if (failures > 0) {
    console.error(`\n✗ ${failures} of ${checks} checks failed`);
    process.exit(1);
  }
  console.log("\n✓ every role landed in its own shell and no shell let anyone else in");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
