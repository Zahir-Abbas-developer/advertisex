"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import type { ProjectPayload, ProjectViewer } from "@/components/projects/types";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/safe-fetch";

type Person = { id: string; name: string; jobTitle: string | null; avatarColor: string; isAgent: boolean; skills: { id: string; name: string; proficiency: number }[] };
type Service = { id: string; name: string; skills: { id: string; name: string }[] };
type Skill = { id: string; name: string; category: string };

/**
 * The team, the services, and the skills the project needs — derived from
 * its services and editable. Each person shows which required skills they
 * hold, so gaps are visible before they become delays.
 */
export function ProjectTeam({ project, viewer, onChanged }: { project: ProjectPayload; viewer: ProjectViewer; onChanged: () => void }) {
  const toast = useToast();
  const [people, setPeople] = useState<Person[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [members, setMembers] = useState(project.team.map((m) => m.id));
  const [serviceIds, setServiceIds] = useState(project.services.map((s) => s.id));
  const [skillIds, setSkillIds] = useState(project.skills.map((s) => s.id));

  // After any save the project is refetched; the selections follow it, so a
  // later save never sends a list from before the last one.
  useEffect(() => {
    setMembers(project.team.map((m) => m.id));
    setServiceIds(project.services.map((s) => s.id));
    setSkillIds(project.skills.map((s) => s.id));
  }, [project]);

  useEffect(() => {
    if (!viewer.canShape) return;
    void Promise.all([
      safeFetch("/api/projects/people").then((r) => (r.ok ? r.json() : { people: [] })),
      safeFetch("/api/services").then((r) => (r.ok ? r.json() : { services: [] })),
      safeFetch("/api/skills").then((r) => (r.ok ? r.json() : { skills: [] })),
    ]).then(([p, s, k]) => {
      setPeople(p.people);
      setServices(s.services);
      setSkills((k.skills ?? []).filter((x: Skill & { isActive?: boolean }) => x.isActive !== false));
    });
  }, [viewer.canShape]);

  const required = new Set(project.skills.map((s) => s.id));
  const coverage = useMemo(() => {
    const byPerson = new Map(people.map((p) => [p.id, p.skills]));
    return project.skills.map((s) => ({ ...s, holders: project.team.filter((m) => byPerson.get(m.id)?.some((k) => k.id === s.id)).length }));
  }, [people, project.skills, project.team]);

  const put = async (url: string, body: unknown, done: string) => {
    const res = await safeFetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(data.error ?? "That didn't save");
    toast.success(done);
    onChanged();
  };

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card padded={false}>
        <CardHeader title="Team" description={viewer.canShape ? "Pick who works on this project. People with the required skills are listed first." : undefined} />
        <CardBody className="space-y-4">
          {viewer.canShape && people.length > 0 ? (
            <>
              <ul className="max-h-96 space-y-1 overflow-y-auto">
                {[...people]
                  .map((p) => ({ ...p, match: p.skills.filter((k) => required.has(k.id)).length }))
                  .sort((a, b) => Number(members.includes(b.id)) - Number(members.includes(a.id)) || b.match - a.match || a.name.localeCompare(b.name))
                  .map((p) => (
                    <li key={p.id}>
                      <label className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2", members.includes(p.id) && "bg-brand-tint")}>
                        <input type="checkbox" className="accent-brand" checked={members.includes(p.id)} onChange={() => toggle(members, setMembers, p.id)} disabled={p.id === project.owner?.id} />
                        <Avatar name={p.name} color={p.avatarColor} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-[13px] text-ink">
                            {p.name}
                            {p.isAgent && <Bot className="h-3.5 w-3.5 text-data-2" aria-label="AI agent" />}
                          </span>
                          <span className="block truncate text-[11px] text-ink/45">{p.jobTitle ?? ""}</span>
                        </span>
                        {p.match > 0 && <span className="text-[11px] text-data-1">{p.match} of {required.size} skills</span>}
                      </label>
                    </li>
                  ))}
              </ul>
              <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line pt-4">
                <div className="w-56">
                  <Select
                    label="Owner"
                    value={project.owner?.id ?? ""}
                    onChange={async (e) => {
                      const res = await safeFetch(`/api/projects/${project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ownerId: e.target.value || null }) });
                      if (!res.ok) return toast.error("Couldn't change the owner");
                      toast.success("Owner changed");
                      onChanged();
                    }}
                    options={[{ value: "", label: "No owner" }, ...people.filter((p) => !p.isAgent).map((p) => ({ value: p.id, label: p.name }))]}
                  />
                </div>
                <Button size="sm" onClick={() => void put(`/api/projects/${project.id}/team`, { memberIds: members }, "Team saved")}>
                  Save team
                </Button>
              </div>
            </>
          ) : (
            <ul className="space-y-3">
              {project.team.map((m) => (
                <li key={m.id} className="flex items-center gap-3 text-[13px]">
                  <Avatar name={m.name} color={m.avatarColor} size="sm" />
                  <span className="text-ink">{m.name}</span>
                  {m.projectRole === "LEAD" && <Badge size="sm" tone="info">Lead</Badge>}
                  <span className="text-ink/45">{m.jobTitle}</span>
                </li>
              ))}
              {project.team.length === 0 && <p className="text-[13px] text-ink/45">No one yet.</p>}
            </ul>
          )}
        </CardBody>
      </Card>

      <div className="space-y-6">
        <Card padded={false}>
          <CardHeader title="Required skills" description="Derived from the services; add or remove as the work needs." />
          <CardBody className="space-y-4">
            <ul className="flex flex-wrap gap-1.5">
              {coverage.map((s) => (
                <li key={s.id}>
                  <Badge size="sm" tone={people.length && s.holders === 0 ? "warning" : "neutral"}>
                    {s.name}
                    {people.length > 0 && <span className="ml-1 text-ink/45">· {s.holders === 0 ? "no one on the team" : `${s.holders} on team`}</span>}
                    {s.source === "MANUAL" && <span className="ml-1 text-ink/40">(added)</span>}
                  </Badge>
                </li>
              ))}
              {coverage.length === 0 && <li className="text-[13px] text-ink/45">None listed.</li>}
            </ul>
            {viewer.canShape && skills.length > 0 && (
              <>
                <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto border-t border-line pt-4">
                  {skills.map((k) => (
                    <button key={k.id} type="button" aria-pressed={skillIds.includes(k.id)} onClick={() => toggle(skillIds, setSkillIds, k.id)} className={cn("rounded-pill border px-2.5 py-1 text-[12px]", skillIds.includes(k.id) ? "border-brand bg-brand-tint text-ink" : "border-line text-ink/55 hover:border-ink/25")}>
                      {k.name}
                    </button>
                  ))}
                </div>
                <div className="flex justify-end">
                  <Button size="sm" variant="secondary" onClick={() => void put(`/api/projects/${project.id}/skills`, { skillIds }, "Skills saved")}>
                    Save skills
                  </Button>
                </div>
              </>
            )}
          </CardBody>
        </Card>

        {viewer.canShape && services.length > 0 && (
          <Card padded={false}>
            <CardHeader title="Services" description="Adding a service adds its stages and skills; removing one removes its stages." />
            <CardBody className="space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {services.map((s) => (
                  <button key={s.id} type="button" aria-pressed={serviceIds.includes(s.id)} onClick={() => toggle(serviceIds, setServiceIds, s.id)} className={cn("rounded-pill border px-2.5 py-1 text-[12px]", serviceIds.includes(s.id) ? "border-brand bg-brand-tint text-ink" : "border-line text-ink/55 hover:border-ink/25")}>
                    {s.name}
                  </button>
                ))}
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const removing = project.services.filter((s) => !serviceIds.includes(s.id));
                    if (removing.length && !window.confirm(`Remove ${removing.map((r) => r.name).join(", ")} and its stages? Milestones in them stay, unstaged.`)) return;
                    void put(`/api/projects/${project.id}/services`, { serviceIds }, "Services updated");
                  }}
                >
                  Save services
                </Button>
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
