import { COMPANY_TIMEZONE } from "@/lib/date";

/**
 * Email templates in the product's editorial style.
 *
 * Written as inline-styled tables rather than with the app's Tailwind classes,
 * because email clients support neither stylesheets nor modern CSS. The palette
 * and the type hierarchy follow the app's — obsidian header, gold accents,
 * generous space, hairline rules instead of shadows — so a message looks like
 * it came from the same product. Emails keep a light canvas deliberately:
 * dark-themed HTML is what email clients mangle most.
 *
 * Everything interpolated goes through `escape()`. A member's name is not a
 * trusted source of markup.
 */

const INK = "#022313"; // green-950
const ON_BRAND = "#FFFFFF";
const PAPER = "#E7F4EB"; // green-50 page
const CREAM = "#F8F8FB"; // surface-2
const BRAND = "#0E5B37"; // brand green — 8.2:1 on white
const BRAND_TINT = "#E7F4EB";
const LINE = "#CEE4D9"; // green-100
const DANGER = "#DC2626";
const DANGER_TINT = "#FCEEEE"; // danger at 8% on white
const WARN = "#D97706";

export function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type ShellOptions = {
  eyebrow: string;
  title: string;
  intro?: string;
  body: string;
  cta?: { label: string; href: string };
  footnote?: string;
};

/** The dark-header frame every message shares. */
function shell({ eyebrow, title, intro, body, cta, footnote }: ShellOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escape(title)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPER};font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;border:1px solid ${LINE};border-radius:14px;overflow:hidden;background:#ffffff;">

        <tr><td style="background:${INK};padding:28px 32px;">
          <p style="margin:0 0 18px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:#CBCBCD;">${escape(eyebrow)}</p>
          <h1 style="margin:0;font-size:26px;line-height:1.15;font-weight:800;letter-spacing:-0.02em;color:${ON_BRAND};">${escape(title)}</h1>
          ${intro ? `<p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:#CBCBCD;">${escape(intro)}</p>` : ""}
        </td></tr>

        <tr><td style="padding:28px 32px;">${body}</td></tr>

        ${
          cta
            ? `<tr><td style="padding:0 32px 28px;">
                 <a href="${escape(cta.href)}" style="display:inline-block;background:${BRAND};color:${ON_BRAND};text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:999px;">${escape(cta.label)}</a>
               </td></tr>`
            : ""
        }

        <tr><td style="border-top:1px solid ${LINE};background:${CREAM};padding:18px 32px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#656565;">
            Advertise X${footnote ? ` · ${escape(footnote)}` : ""}<br />
            All times ${COMPANY_TIMEZONE.replace("/", " / ")}.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** A labelled row inside the body. */
function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid ${LINE};font-size:14px;color:#656565;">${escape(label)}</td>
    <td style="padding:10px 0;border-bottom:1px solid ${LINE};font-size:14px;font-weight:600;text-align:right;">${escape(value)}</td>
  </tr>`;
}

function table(rows: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
}

function listItem(primary: string, secondary: string, tone?: "danger" | "warn"): string {
  const colour = tone === "danger" ? DANGER : tone === "warn" ? WARN : "#656565";
  return `<tr><td style="padding:10px 0;border-bottom:1px solid ${LINE};">
    <p style="margin:0;font-size:14px;font-weight:600;">${escape(primary)}</p>
    <p style="margin:3px 0 0;font-size:13px;color:${colour};">${escape(secondary)}</p>
  </td></tr>`;
}

export type Email = { subject: string; html: string; text: string };

// ---------------------------------------------------------------------------

export function welcomeEmail(input: {
  name: string;
  email: string;
  password: string;
  jobTitle: string;
  signInUrl: string;
}): Email {
  const body = `
    <p style="margin:0 0 18px;font-size:15px;line-height:1.65;">
      You've been added to Advertise X as <strong>${escape(input.jobTitle)}</strong>.
      This is where your milestones, deadlines and monthly performance live.
    </p>
    <div style="background:${BRAND_TINT};border:1px solid rgba(14,91,55,0.20);border-radius:10px;padding:16px 18px;margin:0 0 18px;">
      ${table(row("Email", input.email) + row("Temporary password", input.password))}
    </div>
    <p style="margin:0;font-size:13px;line-height:1.65;color:#656565;">
      Change your password once you're in. If you weren't expecting this, tell your administrator.
    </p>`;

  return {
    subject: "Your Advertise X account",
    html: shell({
      eyebrow: "Welcome",
      title: `Hello ${input.name.split(" ")[0]}`,
      intro: "Your workspace is ready.",
      body,
      cta: { label: "Sign in", href: input.signInUrl },
    }),
    text: [
      `Hello ${input.name.split(" ")[0]},`,
      "",
      `You've been added to Advertise X as ${input.jobTitle}.`,
      "",
      `Email: ${input.email}`,
      `Temporary password: ${input.password}`,
      "",
      `Sign in: ${input.signInUrl}`,
      "",
      "Change your password once you're in.",
    ].join("\n"),
  };
}

export function weeklyDigestEmail(input: {
  name: string;
  score: number;
  bandLabel: string;
  dueThisWeek: { title: string; clientName: string; dueLabel: string; overdue: boolean }[];
  appUrl: string;
}): Email {
  const items =
    input.dueThisWeek.length === 0
      ? `<p style="margin:0;font-size:14px;color:#656565;">Nothing is due in the next seven days.</p>`
      : table(
          input.dueThisWeek
            .map((item) =>
              listItem(
                item.title,
                `${item.clientName} · ${item.overdue ? `overdue — was due ${item.dueLabel}` : `due ${item.dueLabel}`}`,
                item.overdue ? "danger" : undefined,
              ),
            )
            .join(""),
        );

  const body = `
    <div style="background:${CREAM};border:1px solid ${LINE};border-radius:10px;padding:18px;margin:0 0 22px;">
      <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:#656565;">Your score</p>
      <p style="margin:0;font-size:34px;font-weight:800;letter-spacing:-0.03em;line-height:1;">${input.score}<span style="font-size:15px;color:#656565;"> / 100</span></p>
      <p style="margin:8px 0 0;font-size:13px;font-weight:600;color:${BRAND};">${escape(input.bandLabel)}</p>
    </div>
    <p style="margin:0 0 12px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:#656565;">Due this week</p>
    ${items}`;

  return {
    subject: `Your week ahead — ${input.dueThisWeek.length} item${input.dueThisWeek.length === 1 ? "" : "s"} due`,
    html: shell({
      eyebrow: "Weekly digest",
      title: `Good morning, ${input.name.split(" ")[0]}`,
      intro: "Where your score stands, and what's due in the next seven days.",
      body,
      cta: { label: "Open your tasks", href: `${input.appUrl}/my-tasks` },
    }),
    text: [
      `Good morning, ${input.name.split(" ")[0]}.`,
      "",
      `Score: ${input.score}/100 (${input.bandLabel})`,
      "",
      "Due this week:",
      ...(input.dueThisWeek.length === 0
        ? ["  Nothing due in the next seven days."]
        : input.dueThisWeek.map(
            (item) =>
              `  - ${item.title} (${item.clientName}) — ${item.overdue ? "OVERDUE, was due" : "due"} ${item.dueLabel}`,
          )),
      "",
      `${input.appUrl}/my-tasks`,
    ].join("\n"),
  };
}

export function reportReadyEmail(input: {
  name: string;
  periodLabel: string;
  typeLabel: string;
  narrative: string;
  score: number;
  reportUrl: string;
}): Email {
  const body = `
    <p style="margin:0 0 18px;font-size:15px;line-height:1.65;">${escape(input.narrative)}</p>
    <div style="background:${CREAM};border:1px solid ${LINE};border-radius:10px;padding:16px 18px;">
      ${table(row("Period", input.periodLabel) + row("Score", `${input.score} / 100`))}
    </div>`;

  return {
    subject: `Your ${input.typeLabel.toLowerCase()} for ${input.periodLabel}`,
    html: shell({
      eyebrow: input.typeLabel,
      title: `${input.periodLabel} is ready`,
      intro: `A summary of how ${input.name.split(" ")[0]}'s period went.`,
      body,
      cta: { label: "Read the report", href: input.reportUrl },
      footnote: "Reports are a frozen snapshot of the period",
    }),
    text: [
      `${input.typeLabel} — ${input.periodLabel}`,
      "",
      input.narrative,
      "",
      `Score: ${input.score}/100`,
      "",
      `Read it: ${input.reportUrl}`,
    ].join("\n"),
  };
}

export function overdueAlertEmail(input: {
  overdue: { title: string; clientName: string; assigneeName: string; daysLate: number }[];
  appUrl: string;
}): Email {
  const body = `
    <div style="background:${DANGER_TINT};border:1px solid rgba(220,38,38,0.2);border-radius:10px;padding:14px 16px;margin:0 0 20px;">
      <p style="margin:0;font-size:14px;font-weight:600;color:${DANGER};">
        ${input.overdue.length} milestone${input.overdue.length === 1 ? "" : "s"} past deadline
      </p>
    </div>
    ${table(
      input.overdue
        .map((item) =>
          listItem(
            item.title,
            `${item.clientName} · ${item.assigneeName} · ${item.daysLate} day${item.daysLate === 1 ? "" : "s"} late`,
            "danger",
          ),
        )
        .join(""),
    )}`;

  return {
    subject: `${input.overdue.length} overdue milestone${input.overdue.length === 1 ? "" : "s"}`,
    html: shell({
      eyebrow: "Needs attention",
      title: "Work has slipped",
      intro: "These deadlines have passed without an approval.",
      body,
      cta: { label: "Open the board", href: `${input.appUrl}/board` },
    }),
    text: [
      `${input.overdue.length} overdue milestone(s):`,
      "",
      ...input.overdue.map(
        (item) =>
          `  - ${item.title} (${item.clientName}) — ${item.assigneeName}, ${item.daysLate} day(s) late`,
      ),
      "",
      `${input.appUrl}/board`,
    ].join("\n"),
  };
}

export function renewalDigestEmail(input: {
  renewed: {
    clientName: string;
    title: string;
    milestones: number;
    carriedOver: number;
    unassigned: number;
    previousUnpaid?: boolean;
  }[];
  skipped: { clientName: string; reason: string }[];
  totalCarriedOver: number;
  appUrl: string;
}): Email {
  const attention =
    input.renewed.filter((entry) => entry.unassigned > 0).length + input.skipped.length;

  const body = `
    <div style="background:${BRAND_TINT};border:1px solid rgba(14,91,55,0.20);border-radius:10px;padding:14px 16px;margin:0 0 20px;">
      <p style="margin:0;font-size:14px;font-weight:600;color:${BRAND};">
        ${input.renewed.length} cycle${input.renewed.length === 1 ? "" : "s"} opened${
          input.totalCarriedOver > 0
            ? ` · ${input.totalCarriedOver} item${input.totalCarriedOver === 1 ? "" : "s"} carried over`
            : ""
        }
      </p>
    </div>
    ${
      input.renewed.length > 0
        ? table(
            input.renewed
              .map((entry) =>
                listItem(
                  `${entry.clientName} — ${entry.title}`,
                  `${entry.milestones} milestone${entry.milestones === 1 ? "" : "s"}${
                    entry.carriedOver > 0 ? ` · ${entry.carriedOver} carried over` : ""
                  }${entry.unassigned > 0 ? ` · ${entry.unassigned} unassigned` : ""}${
                    entry.previousUnpaid ? " · last cycle unpaid" : ""
                  }`,
                  entry.unassigned > 0 || entry.previousUnpaid ? "warn" : undefined,
                ),
              )
              .join(""),
          )
        : ""
    }
    ${
      input.skipped.length > 0
        ? `<p style="margin:24px 0 8px;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#656565;">Not renewed</p>
           ${table(
             input.skipped
               .map((entry) => listItem(entry.clientName, entry.reason, "warn"))
               .join(""),
           )}`
        : ""
    }`;

  return {
    subject:
      input.renewed.length === 0
        ? "Renewals ran — nothing to open"
        : `${input.renewed.length} retainer cycle${input.renewed.length === 1 ? "" : "s"} renewed`,
    html: shell({
      eyebrow: "Overnight",
      title: "Renewals ran",
      intro:
        attention > 0
          ? "Next month's plans are live. A few need a decision from you."
          : "Next month's plans are live. Nothing needs your attention.",
      body,
      cta: { label: "Open clients", href: `${input.appUrl}/clients` },
    }),
    text: [
      `${input.renewed.length} cycle(s) renewed, ${input.totalCarriedOver} item(s) carried over.`,
      "",
      ...input.renewed.map(
        (entry) =>
          `  - ${entry.clientName}: ${entry.title}, ${entry.milestones} milestone(s)` +
          `${entry.carriedOver > 0 ? `, ${entry.carriedOver} carried over` : ""}` +
          `${entry.unassigned > 0 ? `, ${entry.unassigned} unassigned` : ""}`,
      ),
      ...(input.skipped.length > 0
        ? ["", "Not renewed:", ...input.skipped.map((e) => `  - ${e.clientName}: ${e.reason}`)]
        : []),
      "",
      `${input.appUrl}/clients`,
    ].join("\n"),
  };
}
