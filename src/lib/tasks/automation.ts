import { ensureDefaultTaskTemplates } from "@/lib/tasks/defaults";
import type { SupabaseClient } from "@supabase/supabase-js";

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mapSpaceType(raw: string): "office" | "hot_desk" | "meeting_room" | "venue" {
  const v = (raw || "").toLowerCase();
  if (v === "desk" || v === "hot_desk") return "hot_desk";
  if (v === "conference_room" || v === "meeting_room") return "meeting_room";
  if (v === "venue") return "venue";
  return "office";
}

export async function createOnboardingTasksFromContract(params: {
  supabase: SupabaseClient;
  contractId: string;
  tenantId: string;
  leadId: string | null;
  propertyId: string;
  roomId: string | null;
  contractStartDate: string;
}): Promise<{ created: number }> {
  const { supabase, contractId, tenantId, leadId, propertyId, roomId, contractStartDate } = params;
  await ensureDefaultTaskTemplates(supabase, tenantId);

  const [{ data: room }, { data: existing }, { data: templateRows }, { data: members }] = await Promise.all([
    roomId
      ? supabase.from("bookable_spaces").select("id,space_type").eq("id", roomId).maybeSingle()
      : Promise.resolve({ data: null } as { data: null }),
    supabase.from("client_tasks").select("id").eq("contract_id", contractId).limit(1).maybeSingle(),
    supabase.from("task_templates").select("id,space_type").eq("tenant_id", tenantId).eq("is_default", true),
    supabase.from("memberships").select("user_id,role").eq("tenant_id", tenantId),
  ]);
  if (existing?.id) return { created: 0 };

  const spaceType = mapSpaceType(String(room?.space_type ?? "office"));
  const template = (templateRows ?? []).find((t) => String(t.space_type) === spaceType);
  if (!template) return { created: 0 };

  const { data: items } = await supabase
    .from("task_template_items")
    .select("title,description,category,default_assignee_role,due_days_after_start,order_index,is_required")
    .eq("template_id", template.id)
    .order("order_index", { ascending: true });
  if (!items?.length) return { created: 0 };

  const assigneeByRole = new Map<string, string>();
  for (const m of members ?? []) {
    const role = String(m.role ?? "").toLowerCase();
    if (!assigneeByRole.has(role) && m.user_id) assigneeByRole.set(role, m.user_id);
  }

  const rows = items.map((it) => ({
    tenant_id: tenantId,
    contract_id: contractId,
    contact_id: leadId,
    property_id: propertyId,
    room_id: roomId,
    template_id: template.id,
    title: it.title,
    description: it.description,
    category: it.category,
    status: "todo",
    assigned_to_user_id: assigneeByRole.get(String(it.default_assignee_role)) ?? null,
    due_date: addDays(contractStartDate, Number(it.due_days_after_start || 0)),
    order_index: Number(it.order_index || 0),
    notes: it.is_required ? "Required onboarding task" : "Optional onboarding task",
  }));

  const { data: inserted, error } = await supabase
    .from("client_tasks")
    .insert(rows)
    .select("id,tenant_id");
  if (error) return { created: 0 };
  if (inserted?.length) {
    await supabase.from("task_activities").insert(
      inserted.map((r) => ({
        task_id: r.id,
        tenant_id: r.tenant_id,
        actor_user_id: null,
        activity_type: "created",
        message: "Task created from onboarding template",
      })),
    );
  }
  return { created: (inserted ?? []).length };
}

