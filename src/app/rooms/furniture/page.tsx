"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/browser";
import { loadScopedPropertiesForUser } from "@/lib/properties/scoped";
import { formatPropertyLabel } from "@/lib/properties/label";

type FurnitureItem = {
  id: string;
  tenant_id: string;
  property_id: string;
  room_id: string | null;
  name: string;
  category: string;
  quantity: number;
  condition: string;
  purchase_price: number | null;
  status: string;
};
type FurnitureRental = {
  id: string;
  furniture_item_id: string;
  contract_id: string | null;
  rental_type: "included" | "extra_rental" | "sold";
  monthly_fee: number;
  sale_price: number | null;
  status: "active" | "ended";
};
type Property = { id: string; name: string | null; tenant_id: string };
type Room = { id: string; name: string | null; property_id: string };
type Contract = { id: string; tenant_id: string; monthly_rent: number; status: string };

export default function FurniturePage() {
  const [items, setItems] = useState<FurnitureItem[]>([]);
  const [rentals, setRentals] = useState<FurnitureRental[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [filters, setFilters] = useState({ property: "", room: "", category: "", status: "", q: "" });
  const [form, setForm] = useState<Record<string, string>>({
    property_id: "",
    room_id: "",
    name: "",
    category: "chair",
    quantity: "1",
    condition: "good",
    purchase_price: "",
    status: "available",
  });
  const [assign, setAssign] = useState<Record<string, string>>({
    furniture_item_id: "",
    contract_id: "",
    rental_type: "included",
    monthly_fee: "0",
    sale_price: "0",
    start_date: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  async function load() {
    const supabase = getSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const scoped = await loadScopedPropertiesForUser(supabase, user.id);
    const isSuperAdmin = scoped.isSuperAdmin;
    const tenantIds = scoped.tenantIds;
    const p = scoped.properties;
    if (!isSuperAdmin && !tenantIds.length) return;
    const propertyIds = ((p ?? []) as Property[]).map((x) => x.id);
    const furnitureItemsQuery = supabase.from("furniture_items").select("*").order("created_at", { ascending: false });
    const furnitureRentalsQuery = supabase.from("furniture_rentals").select("*").order("created_at", { ascending: false });
    const contractsQuery = supabase.from("room_contracts").select("id,tenant_id,monthly_rent,status").order("created_at", { ascending: false });
    const [{ data: i }, { data: r }, { data: s }, { data: c }] = await Promise.all([
      isSuperAdmin ? furnitureItemsQuery : furnitureItemsQuery.in("tenant_id", tenantIds),
      isSuperAdmin ? furnitureRentalsQuery : furnitureRentalsQuery.in("tenant_id", tenantIds),
      supabase.from("bookable_spaces").select("id,name,property_id").in("property_id", propertyIds.length ? propertyIds : ["00000000-0000-0000-0000-000000000000"]),
      isSuperAdmin ? contractsQuery : contractsQuery.in("tenant_id", tenantIds),
    ]);
    setItems((i ?? []) as FurnitureItem[]);
    setRentals((r ?? []) as FurnitureRental[]);
    setProperties((p ?? []) as Property[]);
    setRooms((s ?? []) as Room[]);
    setContracts((c ?? []) as Contract[]);
  }

  useEffect(() => {
    void load();
  }, []);

  const visible = useMemo(
    () =>
      items.filter((x) => {
        if (filters.property && x.property_id !== filters.property) return false;
        if (filters.room && (x.room_id ?? "") !== filters.room) return false;
        if (filters.category && x.category !== filters.category) return false;
        if (filters.status && x.status !== filters.status) return false;
        if (filters.q.trim() && !x.name.toLowerCase().includes(filters.q.trim().toLowerCase())) return false;
        return true;
      }),
    [items, filters],
  );

  async function saveItem() {
    setMsg(null);
    const propertyId = form.property_id;
    const prop = properties.find((p) => p.id === propertyId);
    if (!prop) {
      setMsg("Select property");
      return;
    }
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("furniture_items").insert({
      tenant_id: prop.tenant_id,
      property_id: propertyId,
      room_id: form.room_id || null,
      name: form.name.trim(),
      category: form.category,
      quantity: Number(form.quantity || 1),
      condition: form.condition,
      purchase_price: form.purchase_price ? Number(form.purchase_price) : null,
      status: form.status,
    });
    if (error) {
      setMsg(error.message);
      return;
    }
    setMsg("Furniture item saved.");
    await load();
  }

  async function assignFurniture() {
    setMsg(null);
    const item = items.find((x) => x.id === assign.furniture_item_id);
    if (!item) {
      setMsg("Select furniture item");
      return;
    }
    const supabase = getSupabaseClient();
    const rentalType = assign.rental_type as "included" | "extra_rental" | "sold";
    const { error } = await supabase.from("furniture_rentals").insert({
      tenant_id: item.tenant_id,
      furniture_item_id: item.id,
      contract_id: assign.contract_id || null,
      rental_type: rentalType,
      monthly_fee: Number(assign.monthly_fee || 0),
      sale_price: rentalType === "sold" ? Number(assign.sale_price || 0) : null,
      start_date: assign.start_date,
      status: "active",
      notes: assign.notes || null,
    });
    if (error) {
      setMsg(error.message);
      return;
    }

    if (rentalType === "sold") {
      await supabase.from("furniture_items").update({ status: "sold" }).eq("id", item.id);
    } else {
      await supabase.from("furniture_items").update({ status: "in_use" }).eq("id", item.id);
    }

    if (assign.contract_id && rentalType === "extra_rental") {
      const c = contracts.find((x) => x.id === assign.contract_id);
      if (c) {
        const original = Number(c.monthly_rent || 0);
        const delta = Number(assign.monthly_fee || 0);
        await supabase.from("contract_amendments").insert({
          tenant_id: c.tenant_id,
          contract_id: c.id,
          amendment_type: "furniture_addition",
          effective_date: assign.start_date,
          original_monthly_rent: original,
          delta_monthly_rent: delta,
          new_monthly_rent: original + delta,
          notes: assign.notes || null,
        });
      }
    }

    setMsg("Furniture assignment saved.");
    await load();
  }

  return (
    <main style={{ display: "grid", gap: 12 }}>
      <h1 className="vw-admin-page-title" style={{ margin: 0 }}>Furniture</h1>
      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 12, display: "grid", gap: 8 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Inventory</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input placeholder="Search name" value={filters.q} onChange={(e) => setFilters((s) => ({ ...s, q: e.target.value }))} />
          <select value={filters.property} onChange={(e) => setFilters((s) => ({ ...s, property: e.target.value }))}>
            <option value="">All properties</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{formatPropertyLabel(p, { includeCity: true })}</option>)}
          </select>
          <select value={filters.room} onChange={(e) => setFilters((s) => ({ ...s, room: e.target.value }))}>
            <option value="">All rooms</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name ?? r.id}</option>)}
          </select>
          <select value={filters.category} onChange={(e) => setFilters((s) => ({ ...s, category: e.target.value }))}>
            <option value="">All categories</option>
            {["chair", "desk", "table", "sofa", "cabinet", "whiteboard", "monitor", "other"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filters.status} onChange={(e) => setFilters((s) => ({ ...s, status: e.target.value }))}>
            <option value="">All status</option>
            {["available", "in_use", "sold", "disposed"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr>{["Name", "Category", "Room", "Condition", "Status", "Monthly fee"].map((h) => <th key={h} style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #e5e7eb" }}>{h}</th>)}</tr></thead>
          <tbody>
            {visible.map((x) => {
              const room = rooms.find((r) => r.id === x.room_id);
              const activeRental = rentals.find((r) => r.furniture_item_id === x.id && r.status === "active");
              return (
                <tr key={x.id}>
                  <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>{x.name}</td>
                  <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>{x.category}</td>
                  <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>{room?.name ?? "—"}</td>
                  <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>{x.condition}</td>
                  <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>{x.status}</td>
                  <td style={{ padding: 6, borderBottom: "1px solid #f1f5f9" }}>{activeRental ? `EUR ${Number(activeRental.monthly_fee || 0).toFixed(2)}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 12, display: "grid", gap: 8 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Add furniture item</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8 }}>
          <label>Property<select value={form.property_id} onChange={(e) => setForm((s) => ({ ...s, property_id: e.target.value }))}><option value="">Select...</option>{properties.map((p) => <option key={p.id} value={p.id}>{formatPropertyLabel(p, { includeCity: true })}</option>)}</select></label>
          <label>Room<select value={form.room_id} onChange={(e) => setForm((s) => ({ ...s, room_id: e.target.value }))}><option value="">None</option>{rooms.filter((r) => !form.property_id || r.property_id === form.property_id).map((r) => <option key={r.id} value={r.id}>{r.name ?? r.id}</option>)}</select></label>
          <label>Name<input value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} /></label>
          <label>Category<select value={form.category} onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}>{["chair", "desk", "table", "sofa", "cabinet", "whiteboard", "monitor", "other"].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label>Quantity<input type="number" min={1} value={form.quantity} onChange={(e) => setForm((s) => ({ ...s, quantity: e.target.value }))} /></label>
          <label>Condition<select value={form.condition} onChange={(e) => setForm((s) => ({ ...s, condition: e.target.value }))}>{["new", "good", "fair", "poor"].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label>Purchase price EUR<input type="number" min={0} step="0.01" value={form.purchase_price} onChange={(e) => setForm((s) => ({ ...s, purchase_price: e.target.value }))} /></label>
          <label>Status<select value={form.status} onChange={(e) => setForm((s) => ({ ...s, status: e.target.value }))}>{["available", "in_use", "sold", "disposed"].map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        </div>
        <button type="button" onClick={() => void saveItem()} style={{ width: "fit-content" }}>Save furniture</button>
      </section>

      <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 12, display: "grid", gap: 8 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Add furniture to contract</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8 }}>
          <label>Furniture<select value={assign.furniture_item_id} onChange={(e) => setAssign((s) => ({ ...s, furniture_item_id: e.target.value }))}><option value="">Select...</option>{items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label>Contract<select value={assign.contract_id} onChange={(e) => setAssign((s) => ({ ...s, contract_id: e.target.value }))}><option value="">None</option>{contracts.map((c) => <option key={c.id} value={c.id}>{c.id.slice(0, 8)}… ({c.status})</option>)}</select></label>
          <label>Rental type<select value={assign.rental_type} onChange={(e) => setAssign((s) => ({ ...s, rental_type: e.target.value }))}>{["included", "extra_rental", "sold"].map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
          <label>Monthly fee EUR<input type="number" min={0} step="0.01" value={assign.monthly_fee} onChange={(e) => setAssign((s) => ({ ...s, monthly_fee: e.target.value }))} /></label>
          <label>Sale price EUR<input type="number" min={0} step="0.01" value={assign.sale_price} onChange={(e) => setAssign((s) => ({ ...s, sale_price: e.target.value }))} /></label>
          <label>Start date<input type="date" value={assign.start_date} onChange={(e) => setAssign((s) => ({ ...s, start_date: e.target.value }))} /></label>
        </div>
        <label>Notes<textarea rows={2} value={assign.notes} onChange={(e) => setAssign((s) => ({ ...s, notes: e.target.value }))} /></label>
        <button type="button" onClick={() => void assignFurniture()} style={{ width: "fit-content" }}>Save assignment / amendment</button>
        {msg ? <p style={{ margin: 0, color: "#1e3a8a" }}>{msg}</p> : null}
      </section>
    </main>
  );
}

