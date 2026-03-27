import type { SupabaseClient } from "@supabase/supabase-js";

type SpaceType = "office" | "hot_desk" | "meeting_room" | "venue" | "virtual_office";
type Role = "manager" | "maintenance" | "accounting" | "customer_service";
type Category = "access" | "it" | "furniture" | "admin" | "welcome" | "invoicing" | "portal" | "orientation";

type Item = {
  title: string;
  description: string;
  category: Category;
  role: Role;
  due: number;
  required: boolean;
};

const DEFAULTS: Array<{ name: string; spaceType: SpaceType; items: Item[] }> = [
  {
    name: "Office onboarding",
    spaceType: "office",
    items: [
      { title: "Access cards and security setup", description: "Prepare access cards and security profile.", category: "access", role: "manager", due: 0, required: true },
      { title: "Key handover to tenant", description: "Hand over keys and verify receipt.", category: "access", role: "manager", due: 0, required: true },
      { title: "IT and internet setup", description: "Verify internet and IT readiness.", category: "it", role: "manager", due: -2, required: true },
      { title: "Furniture delivery and setup", description: "Arrange furniture delivery and placement.", category: "furniture", role: "maintenance", due: -1, required: false },
      { title: "Parking space setup", description: "Configure parking permissions if applicable.", category: "access", role: "manager", due: 0, required: false },
      { title: "Welcome package sent", description: "Send onboarding welcome package.", category: "welcome", role: "customer_service", due: 0, required: true },
      { title: "Building orientation done", description: "Walk through building orientation checklist.", category: "orientation", role: "manager", due: 1, required: true },
      { title: "Tenant portal access created", description: "Create and validate portal credentials.", category: "portal", role: "manager", due: -1, required: true },
      { title: "Contract filed and archived", description: "File signed contract in archive.", category: "admin", role: "manager", due: 1, required: true },
      { title: "Invoicing setup in accounting", description: "Set up recurring invoice profile.", category: "invoicing", role: "accounting", due: 0, required: true },
    ],
  },
  {
    name: "Hot desk onboarding",
    spaceType: "hot_desk",
    items: [
      { title: "Access card setup", description: "Prepare card access.", category: "access", role: "manager", due: 0, required: true },
      { title: "Welcome package sent", description: "Send welcome package.", category: "welcome", role: "customer_service", due: 0, required: true },
      { title: "Tenant portal access created", description: "Create portal account.", category: "portal", role: "manager", due: -1, required: true },
      { title: "Invoicing setup", description: "Configure invoice profile.", category: "invoicing", role: "accounting", due: 0, required: true },
    ],
  },
  {
    name: "Meeting room onboarding",
    spaceType: "meeting_room",
    items: [
      { title: "Room setup confirmed", description: "Confirm room readiness.", category: "access", role: "manager", due: 0, required: true },
      { title: "IT and AV equipment checked", description: "Verify AV and peripherals.", category: "it", role: "maintenance", due: -1, required: true },
      { title: "Welcome information sent", description: "Send room usage instructions.", category: "welcome", role: "customer_service", due: 0, required: true },
      { title: "Invoicing setup", description: "Configure invoicing details.", category: "invoicing", role: "accounting", due: 0, required: true },
    ],
  },
  {
    name: "Venue onboarding",
    spaceType: "venue",
    items: [
      { title: "Room setup confirmed", description: "Confirm venue setup and cleaning.", category: "access", role: "manager", due: 0, required: true },
      { title: "IT and AV equipment checked", description: "Verify AV systems.", category: "it", role: "maintenance", due: -1, required: true },
      { title: "Welcome information sent", description: "Share venue onboarding info.", category: "welcome", role: "customer_service", due: 0, required: true },
      { title: "Invoicing setup", description: "Set invoicing parameters.", category: "invoicing", role: "accounting", due: 0, required: true },
    ],
  },
  {
    name: "Virtual office onboarding",
    spaceType: "virtual_office",
    items: [
      { title: "Address registered", description: "Register business address services.", category: "admin", role: "manager", due: 0, required: true },
      { title: "Mail handling setup", description: "Configure mail handling workflow.", category: "admin", role: "customer_service", due: 0, required: true },
      { title: "Phone answering briefed", description: "Brief phone answering script if enabled.", category: "admin", role: "customer_service", due: 0, required: false },
      { title: "Welcome package sent (email)", description: "Send digital welcome package.", category: "welcome", role: "customer_service", due: 0, required: true },
      { title: "Invoicing setup", description: "Create recurring invoicing profile.", category: "invoicing", role: "accounting", due: 0, required: true },
    ],
  },
];

export async function ensureDefaultTaskTemplates(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<void> {
  const { data: existing } = await supabase
    .from("task_templates")
    .select("id,space_type")
    .eq("tenant_id", tenantId)
    .eq("is_default", true);

  const bySpace = new Set((existing ?? []).map((r) => String(r.space_type)));
  for (const t of DEFAULTS) {
    if (bySpace.has(t.spaceType)) continue;
    const { data: tpl, error } = await supabase
      .from("task_templates")
      .insert({
        tenant_id: tenantId,
        name: t.name,
        space_type: t.spaceType,
        is_default: true,
      })
      .select("id")
      .maybeSingle();
    if (error || !tpl) continue;
    await supabase.from("task_template_items").insert(
      t.items.map((it, idx) => ({
        template_id: tpl.id,
        title: it.title,
        description: it.description,
        category: it.category,
        default_assignee_role: it.role,
        due_days_after_start: it.due,
        order_index: idx + 1,
        is_required: it.required,
      })),
    );
  }
}

