'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import EditLeadModal from '@/components/shared/EditLeadModal';

// ═══════════════════════════════════════════════════════════════
// VillageWorks Design Manual Tokens
// ═══════════════════════════════════════════════════════════════
const C = {
  darkGreen: '#21524F',
  darkGreenHover: '#1a4340',
  darkGreenLight: '#2a6b67',
  beige: '#F3DFC6',
  beigeLight: '#f9f1e5',
  white: '#FFFFFF',
  offWhite: '#faf8f5',
  textPrimary: '#1a1a1a',
  textSecondary: '#5a5550',
  textMuted: '#8a8580',
  border: '#e5e0da',
  borderLight: '#f0ebe5',
  red: '#c0392b',
  redLight: '#fdf0ee',
  yellow: '#d4a017',
  yellowLight: '#fef9e7',
  green: '#27ae60',
  greenLight: '#eafaf1',
  overlay: 'rgba(0,0,0,0.4)',
};

const F = {
  heading: "'Instrument Serif', Georgia, serif",
  body: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
};

// ═══════════════════════════════════════════════════════════════
// Pipeline Stages — VillageWorks sales flow
// ═══════════════════════════════════════════════════════════════
const STAGES = [
  { key: 'new', label: 'New', color: '#3498db', bg: '#ebf5fb' },
  { key: 'contacted', label: 'Contacted', color: '#9b59b6', bg: '#f4ecf7' },
  { key: 'viewing', label: 'Viewing', color: '#e67e22', bg: '#fef5e7' },
  { key: 'offer', label: 'Offer', color: '#2980b9', bg: '#eaf2f8' },
  { key: 'contract', label: 'Contract', color: C.yellow, bg: C.yellowLight },
  { key: 'won', label: 'Won', color: C.green, bg: C.greenLight },
  { key: 'lost', label: 'Lost', color: C.red, bg: C.redLight },
];

interface Lead {
  id: string;
  company_name: string;
  contact_first_name: string;
  contact_last_name: string;
  email: string;
  phone: string;
  stage: string;
  source: string;
  notes: string;
  created_at: string;
  updated_at: string;
  budget_eur_month: number | null;
  interested_space_type: string;
  next_action: string;
  next_action_date: string;
  pipeline_owner: string;
  assigned_agent_user_id: string | null;
  archived: boolean;
  property_id?: string | null;
  interested_property_id?: string | null;
  contact_person_name?: string | null;
}

interface Agent {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  display: string;
}

export default function SalesPipelinePage() {
  const supabase = createClient();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [offerStatuses, setOfferStatuses] = useState<Record<string, string>>({});
  const [contractStatuses, setContractStatuses] = useState<Record<string, string>>({});
  const [pipelineValue, setPipelineValue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  // User & agent filter
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string>('');
  const [currentTenantId, setCurrentTenantId] = useState<string>('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>('all');
  const [agentsLoaded, setAgentsLoaded] = useState(false);

  // Edit modal
  const [editLeadId, setEditLeadId] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Create modal
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    company_name: '',
    contact_first_name: '',
    contact_last_name: '',
    email: '',
    phone: '',
    y_tunnus: '',
    contact_status: '',
    stage: 'new',
    property_id: '',
    source: '',
    interested_space_type: '',
    company_size: '',
    industry: '',
    notes: '',
    assigned_agent_user_id: '',
  });
  const [creating, setCreating] = useState(false);

  // ── Fetch current user, role, and agent list ──
  useEffect(() => {
    const init = async () => {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      // Get role & tenant
      const { data: membership } = await supabase
        .from('memberships')
        .select('role, tenant_id')
        .eq('user_id', user.id)
        .single();

      const role = (membership?.role || '').trim().toLowerCase();
      setCurrentUserRole(role);
      setCurrentTenantId(membership?.tenant_id || '');

      // Default: super_admin sees all, others see own leads
      if (role === 'super_admin') {
        setSelectedAgent('all');
      } else {
        setSelectedAgent(user.id);
      }

      // Fetch agents from user_profiles joined with memberships
      if (role === 'super_admin' || role === 'manager' || role === 'owner') {
        const { data: members } = await supabase
          .from('memberships')
          .select('user_id, role');

        if (members && members.length > 0) {
          const userIds = [...new Set(members.map(m => m.user_id))];
          const { data: profiles } = await supabase
            .from('user_profiles')
            .select('user_id, first_name, last_name, email')
            .in('user_id', userIds);

          if (profiles) {
            const agentList: Agent[] = profiles.map(p => ({
              id: p.user_id,
              email: p.email || '',
              first_name: p.first_name || '',
              last_name: p.last_name || '',
              display: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || p.user_id.slice(0, 8),
            }));
            agentList.sort((a, b) => a.display.localeCompare(b.display));
            setAgents(agentList);
          }
        }
      }

      const { data: props } = await supabase
        .from('properties')
        .select('id, name')
        .order('name');
      if (props) setProperties(props);

      setAgentsLoaded(true);
    };
    init();
  }, []);

  // ── Fetch leads ──
  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false });

      if (!showArchived) {
        query = query.or('archived.is.null,archived.eq.false');
      }

      const { data, error } = await query;
      if (error) throw error;
      setLeads(data || []);

      // Fetch latest offer status per lead
      if (data && data.length > 0) {
        const leadIds = data.map((l) => l.id);
        const idList = leadIds.join(',');
        const { data: offers } = await supabase
          .from('offers')
          .select('lead_id, status, company_id')
          .or(`lead_id.in.(${idList}),company_id.in.(${idList})`)
          .order('created_at', { ascending: false });
        if (offers) {
          const statusMap: Record<string, string> = {};
          for (const o of offers) {
            const lid = o.lead_id || o.company_id;
            if (lid && !statusMap[lid]) {
              statusMap[lid] = o.status;
            }
          }
          setOfferStatuses(statusMap);
        }

        // Fetch latest contract status per lead
        const { data: contractRows } = await supabase
          .from('contracts')
          .select('lead_id, company_id, status')
          .order('created_at', { ascending: false });

        if (contractRows && contractRows.length > 0) {
          const contractMap: Record<string, string> = {};
          for (const row of contractRows) {
            const lid = row.lead_id || row.company_id;
            if (lid && !contractMap[lid]) {
              contractMap[lid] = row.status;
            }
          }
          setContractStatuses(contractMap);
        } else {
          setContractStatuses({});
        }
      } else {
        setOfferStatuses({});
        setContractStatuses({});
      }
    } catch (err) {
      console.error('Error fetching leads:', err);
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    if (agentsLoaded) fetchLeads();
  }, [fetchLeads, agentsLoaded]);

  // ── Filter leads by search + agent ──
  const filtered = useMemo(
    () =>
      leads.filter((l) => {
        // Agent filter
        if (selectedAgent !== 'all') {
          if (l.assigned_agent_user_id !== selectedAgent) return false;
        }
        // Search filter
        if (!search) return true;
        const s = search.toLowerCase();
        return (
          (l.company_name || '').toLowerCase().includes(s) ||
          (l.contact_first_name || '').toLowerCase().includes(s) ||
          (l.contact_last_name || '').toLowerCase().includes(s) ||
          (l.email || '').toLowerCase().includes(s)
        );
      }),
    [leads, search, selectedAgent],
  );

  const fetchPipelineValue = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('offers')
        .select('monthly_price, lead_id, company_id, status')
        .in('status', ['draft', 'sent', 'viewed', 'accepted']);

      if (error) throw error;
      if (data) {
        const leadIds = new Set(filtered.map((l) => l.id));
        const total = data
          .filter((o) => {
            const lid = o.lead_id ?? o.company_id;
            return lid != null && leadIds.has(lid);
          })
          .reduce((sum, o) => sum + (Number(o.monthly_price) || 0), 0);
        setPipelineValue(total);
      } else {
        setPipelineValue(0);
      }
    } catch (err) {
      console.error('Error fetching pipeline value:', err);
    }
  }, [filtered]);

  useEffect(() => {
    fetchPipelineValue();
  }, [fetchPipelineValue]);

  const getStageLeads = (stageKey: string) =>
    filtered.filter((l) => (l.stage || 'new') === stageKey);

  // ── Drag & Drop ──
  const handleDragStart = (leadId: string) => setDraggedLeadId(leadId);
  const handleDragOver = (e: React.DragEvent, stageKey: string) => {
    e.preventDefault();
    setDragOverStage(stageKey);
  };
  const handleDragLeave = () => setDragOverStage(null);
  const handleDrop = async (stageKey: string) => {
    if (!draggedLeadId) return;
    setDragOverStage(null);
    try {
      const { error } = await supabase
        .from('leads')
        .update({
          stage: stageKey,
          stage_changed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', draggedLeadId);
      if (error) throw error;
      setLeads((prev) =>
        prev.map((l) => (l.id === draggedLeadId ? { ...l, stage: stageKey } : l))
      );
      if (stageKey === 'offer') {
        setEditLeadId(draggedLeadId);
        setIsEditModalOpen(true);
      }
    } catch (err) {
      console.error('Error moving lead:', JSON.stringify(err, null, 2));
    }
    setDraggedLeadId(null);
  };

  // ── Create Lead ──
  const handleCreate = async () => {
    if (!createForm.company_name.trim()) return;
    setCreating(true);
    try {
      const insertData: any = {
        company_name: createForm.company_name.trim(),
        contact_person_name:
          [createForm.contact_first_name, createForm.contact_last_name].filter(Boolean).join(' ') ||
          createForm.company_name.trim(),
        email: createForm.email || '',
        source: createForm.source || 'other',
        stage: 'new',
        pipeline_owner: 'platform',
        tenant_id: currentTenantId,
        stage_changed_at: new Date().toISOString(),
        archived: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        contact_first_name: createForm.contact_first_name.trim() || null,
        contact_last_name: createForm.contact_last_name.trim() || null,
        phone: createForm.phone.trim() || null,
        y_tunnus: createForm.y_tunnus.trim() || null,
        property_id: createForm.property_id || null,
        interested_space_type: createForm.interested_space_type.trim() || null,
        company_size: createForm.company_size.trim() || null,
        industry_sector: createForm.industry.trim() || null,
        notes: createForm.notes.trim() || null,
        assigned_agent_user_id: createForm.assigned_agent_user_id || null,
      };
      if (createForm.contact_status === 'Inactive') insertData.archived = true;
      if (createForm.contact_status === 'Lost') insertData.stage = 'lost';

      const { error } = await supabase.from('leads').insert(insertData);
      if (error) throw error;
      setCreateForm({
        company_name: '',
        contact_first_name: '',
        contact_last_name: '',
        email: '',
        phone: '',
        y_tunnus: '',
        contact_status: '',
        stage: 'new',
        property_id: '',
        source: '',
        interested_space_type: '',
        company_size: '',
        industry: '',
        notes: '',
        assigned_agent_user_id: '',
      });
      setIsCreateModalOpen(false);
      fetchLeads();
    } catch (err) {
      console.error('Error creating lead:', JSON.stringify(err, null, 2));
    } finally {
      setCreating(false);
    }
  };

  // ── Stats ──
  const totalLeads = filtered.length;
  const wonLeads = filtered.filter((l) => l.stage === 'won').length;

  // ── Get agent name helper ──
  const getAgentName = (userId: string | null) => {
    if (!userId) return 'Unassigned';
    const agent = agents.find(a => a.id === userId);
    return agent ? agent.display : userId.slice(0, 8);
  };

  // ── Can user filter by agents? ──
  const canFilterAgents = currentUserRole === 'super_admin' || currentUserRole === 'manager' || currentUserRole === 'owner';

  // ── Shared styles ──
  const onInputFocus = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = C.darkGreen;
    e.target.style.boxShadow = '0 0 0 3px rgba(33,82,79,0.08)';
  };
  const onInputBlur = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = C.border;
    e.target.style.boxShadow = 'none';
  };

  const inputBase: React.CSSProperties = {
    fontFamily: F.body, fontSize: '14px', color: C.textPrimary,
    backgroundColor: C.white, border: `1px solid ${C.border}`, borderRadius: '8px',
    padding: '10px 14px', width: '100%', outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s', boxSizing: 'border-box',
  };

  const selectBase: React.CSSProperties = {
    ...inputBase, appearance: 'none' as const,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236b6560' d='M2 4l4 4 4-4'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 14px center', paddingRight: '36px',
  };

  const labelBase: React.CSSProperties = {
    fontFamily: F.body, fontSize: '13px', fontWeight: 500,
    color: C.textSecondary, display: 'block', marginBottom: '4px',
  };

  const gridTwo: React.CSSProperties = {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px',
  };

  return (
    <div style={{ backgroundColor: C.offWhite, minHeight: '100vh', fontFamily: F.body, color: C.textPrimary }}>

      {/* ── Page Header ── */}
      <div style={{ padding: '32px 32px 0' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div>
            <h1 style={{ fontFamily: F.heading, fontSize: '32px', fontWeight: 400, color: C.textPrimary, margin: 0, lineHeight: 1.1 }}>
              Sales Pipeline
            </h1>
            <p style={{ fontFamily: F.body, fontSize: '14px', color: C.textMuted, margin: '6px 0 0' }}>
              Manage leads from first contact to closed deal
            </p>
          </div>
          <button onClick={() => {
            setCreateForm({
              company_name: '',
              contact_first_name: '',
              contact_last_name: '',
              email: '',
              phone: '',
              y_tunnus: '',
              contact_status: '',
              stage: 'new',
              property_id: '',
              source: '',
              interested_space_type: '',
              company_size: '',
              industry: '',
              notes: '',
              assigned_agent_user_id: '',
            });
            setIsCreateModalOpen(true);
          }} style={{
            fontFamily: F.body, fontSize: '14px', fontWeight: 600, color: C.white,
            backgroundColor: C.darkGreen, border: 'none', borderRadius: '10px',
            padding: '11px 22px', cursor: 'pointer', transition: 'background-color 0.2s',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = C.darkGreenHover)}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = C.darkGreen)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" />
            </svg>
            New Lead
          </button>
        </div>

        {/* ── Stats Bar ── */}
        <div style={{ display: 'flex', gap: '16px', marginBottom: '20px' }}>
          {[
            { label: 'Total Leads', value: totalLeads },
            { label: 'Won', value: wonLeads },
            { label: 'Pipeline Value', value: `€${pipelineValue.toLocaleString()}/mo` },
          ].map((stat) => (
            <div key={stat.label} style={{
              backgroundColor: C.white, border: `1px solid ${C.border}`, borderRadius: '10px',
              padding: '14px 20px', flex: 1, maxWidth: '220px',
            }}>
              <p style={{
                fontFamily: F.body, fontSize: '12px', fontWeight: 500, color: C.textMuted,
                margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.04em',
              }}>{stat.label}</p>
              <p style={{ fontFamily: F.heading, fontSize: '22px', fontWeight: 400, color: C.darkGreen, margin: 0 }}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        {/* ── Toolbar ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '16px', paddingBottom: '20px', borderBottom: `1px solid ${C.border}`,
          flexWrap: 'wrap',
        }}>
          {/* Left side: Search + Agent filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, flexWrap: 'wrap' }}>
            {/* Search */}
            <div style={{ position: 'relative', minWidth: '220px', maxWidth: '320px', flex: 1 }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={C.textMuted} strokeWidth="1.5" strokeLinecap="round"
                style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }}>
                <circle cx="7" cy="7" r="5" /><line x1="11" y1="11" x2="14" y2="14" />
              </svg>
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search companies, contacts..."
                style={{ ...inputBase, paddingLeft: '36px' }}
                onFocus={onInputFocus} onBlur={onInputBlur} />
            </div>

            {/* Agent filter dropdown */}
            {canFilterAgents && agents.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={C.textMuted} strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="8" cy="5" r="3" /><path d="M2 14c0-3 2.5-5 6-5s6 2 6 5" />
                </svg>
                <select
                  value={selectedAgent}
                  onChange={(e) => setSelectedAgent(e.target.value)}
                  style={{
                    ...selectBase,
                    width: 'auto',
                    minWidth: '180px',
                    padding: '8px 36px 8px 12px',
                    fontSize: '13px',
                    fontWeight: 500,
                  }}
                  onFocus={onInputFocus}
                  onBlur={onInputBlur}
                >
                  <option value="all">All users</option>
                  <option value="unassigned">Unassigned leads</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.display}{agent.id === currentUserId ? ' (me)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Right side: Archive toggle + View toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <label style={{
              fontFamily: F.body, fontSize: '13px', color: C.textMuted,
              display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
            }}>
              <input type="checkbox" checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                style={{ accentColor: C.darkGreen }} />
              Show archived
            </label>

            <div style={{
              display: 'flex', backgroundColor: C.white,
              border: `1px solid ${C.border}`, borderRadius: '8px', overflow: 'hidden',
            }}>
              {(['kanban', 'list'] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} style={{
                  fontFamily: F.body, fontSize: '13px',
                  fontWeight: view === v ? 600 : 400,
                  color: view === v ? C.white : C.textSecondary,
                  backgroundColor: view === v ? C.darkGreen : 'transparent',
                  border: 'none', padding: '7px 16px', cursor: 'pointer',
                  transition: 'all 0.2s', textTransform: 'capitalize',
                }}>{v}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div style={{ padding: '20px 32px 32px' }}>
        {loading ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '80px 0', fontFamily: F.body, fontSize: '14px', color: C.textMuted,
          }}>
            <svg width="20" height="20" viewBox="0 0 20 20" style={{ marginRight: '10px', animation: 'spin 1s linear infinite' }}>
              <circle cx="10" cy="10" r="8" stroke={C.darkGreen} strokeWidth="2" fill="none" strokeDasharray="36 14" />
            </svg>
            Loading pipeline...
          </div>
        ) : view === 'kanban' ? (
          /* ═══ KANBAN VIEW ═══ */
          <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', paddingBottom: '16px' }}>
            {STAGES.filter((s) => showArchived || s.key !== 'lost').map((stage) => {
              const stageLeads = getStageLeads(stage.key);
              const isOver = dragOverStage === stage.key;
              return (
                <div key={stage.key}
                  onDragOver={(e) => handleDragOver(e, stage.key)}
                  onDragLeave={handleDragLeave}
                  onDrop={() => handleDrop(stage.key)}
                  style={{
                    minWidth: '260px', width: '260px', flexShrink: 0,
                    display: 'flex', flexDirection: 'column',
                    maxHeight: 'calc(100vh - 300px)',
                  }}
                >
                  {/* Column Header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: '12px', padding: '0 4px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: stage.color }} />
                      <span style={{ fontFamily: F.body, fontSize: '14px', fontWeight: 600, color: C.textPrimary }}>{stage.label}</span>
                    </div>
                    <span style={{
                      fontFamily: F.body, fontSize: '12px', fontWeight: 600, color: C.textMuted,
                      backgroundColor: C.white, border: `1px solid ${C.border}`,
                      borderRadius: '12px', padding: '2px 10px',
                    }}>{stageLeads.length}</span>
                  </div>

                  {/* Column Body */}
                  <div style={{
                    backgroundColor: isOver ? C.beigeLight : C.borderLight,
                    borderRadius: '12px', padding: '8px', flex: 1, overflowY: 'auto',
                    transition: 'background-color 0.2s',
                    border: isOver ? `2px dashed ${C.darkGreen}` : '2px solid transparent',
                    minHeight: '120px',
                  }}>
                    {stageLeads.length === 0 ? (
                      <div style={{ fontFamily: F.body, fontSize: '12px', color: C.textMuted, textAlign: 'center', padding: '32px 12px' }}>
                        No leads
                      </div>
                    ) : (
                      stageLeads.map((lead) => (
                        <div key={lead.id} draggable
                          onDragStart={() => handleDragStart(lead.id)}
                          onClick={() => { setEditLeadId(lead.id); setIsEditModalOpen(true); }}
                          style={{
                            backgroundColor: C.white, borderRadius: '10px',
                            padding: '14px 16px', marginBottom: '8px', cursor: 'grab',
                            border: `1px solid ${C.border}`,
                            transition: 'box-shadow 0.2s, transform 0.15s',
                            boxShadow: draggedLeadId === lead.id ? '0 8px 24px rgba(0,0,0,0.12)' : '0 1px 3px rgba(0,0,0,0.04)',
                            opacity: draggedLeadId === lead.id ? 0.6 : 1,
                          }}
                          onMouseEnter={(e) => {
                            if (draggedLeadId !== lead.id) {
                              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
                              e.currentTarget.style.transform = 'translateY(-1px)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)';
                            e.currentTarget.style.transform = 'none';
                          }}
                        >
                          <p style={{ fontFamily: F.body, fontSize: '14px', fontWeight: 600, color: C.textPrimary, margin: '0 0 6px', lineHeight: 1.3 }}>
                            {lead.company_name || 'Unnamed'}
                          </p>
                          <p style={{ fontFamily: F.body, fontSize: '12px', color: C.textSecondary, margin: '0 0 4px' }}>
                            {[lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(' ') || '—'}
                          </p>
                          {lead.email && (
                            <p style={{
                              fontFamily: F.body, fontSize: '11px', color: C.textMuted,
                              margin: '0 0 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>{lead.email}</p>
                          )}

                          {/* Tags */}
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                            {lead.interested_space_type && (
                              <span style={{
                                fontFamily: F.body, fontSize: '10px', fontWeight: 500,
                                color: C.darkGreen, backgroundColor: C.beigeLight,
                                borderRadius: '6px', padding: '2px 8px', textTransform: 'capitalize',
                              }}>{lead.interested_space_type.replace(/_/g, ' ')}</span>
                            )}
                            {lead.budget_eur_month && (
                              <span style={{
                                fontFamily: F.body, fontSize: '10px', fontWeight: 500,
                                color: C.darkGreenLight, backgroundColor: '#eaf5f4',
                                borderRadius: '6px', padding: '2px 8px',
                              }}>€{lead.budget_eur_month.toLocaleString()}/mo</span>
                            )}
                            {lead.source && (
                              <span style={{
                                fontFamily: F.body, fontSize: '10px', fontWeight: 500,
                                color: C.textMuted, backgroundColor: C.borderLight,
                                borderRadius: '6px', padding: '2px 8px', textTransform: 'capitalize',
                              }}>{lead.source.replace(/_/g, ' ')}</span>
                            )}
                          </div>

                          {offerStatuses[lead.id] && (
                            <div style={{
                              marginTop: '6px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}>
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke={
                                offerStatuses[lead.id] === 'accepted' ? '#27ae60' :
                                offerStatuses[lead.id] === 'sent' ? '#2980b9' :
                                offerStatuses[lead.id] === 'viewed' ? '#9b59b6' :
                                offerStatuses[lead.id] === 'declined' ? '#c0392b' :
                                '#8a8580'
                              } strokeWidth="1.5" strokeLinecap="round">
                                <rect x="1" y="2" width="8" height="6" rx="1" />
                                <path d="M1 3.5L5 6l4-2.5" />
                              </svg>
                              <span style={{
                                fontFamily: "'DM Sans', sans-serif",
                                fontSize: '10px',
                                fontWeight: 600,
                                color: offerStatuses[lead.id] === 'accepted' ? '#27ae60' :
                                  offerStatuses[lead.id] === 'sent' ? '#2980b9' :
                                  offerStatuses[lead.id] === 'viewed' ? '#9b59b6' :
                                  offerStatuses[lead.id] === 'declined' ? '#c0392b' :
                                  '#8a8580',
                                textTransform: 'capitalize',
                              }}>
                                Offer {offerStatuses[lead.id]}
                              </span>
                            </div>
                          )}

                          {contractStatuses[lead.id] && (
                            <div style={{
                              marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px',
                            }}>
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke={
                                contractStatuses[lead.id] === 'signed_digital' || contractStatuses[lead.id] === 'signed_paper' ? '#27ae60' :
                                contractStatuses[lead.id] === 'active' ? '#27ae60' :
                                contractStatuses[lead.id] === 'sent' ? '#2980b9' :
                                contractStatuses[lead.id] === 'draft' ? '#8a8580' :
                                '#8a8580'
                              } strokeWidth="1.5" strokeLinecap="round">
                                <path d="M2 2h6v7H2z M4 1v1 M6 1v1 M2 4h6" />
                              </svg>
                              <span style={{
                                fontFamily: F.body, fontSize: '10px', fontWeight: 500,
                                color: contractStatuses[lead.id] === 'signed_digital' || contractStatuses[lead.id] === 'signed_paper' ? '#27ae60' :
                                  contractStatuses[lead.id] === 'active' ? '#27ae60' :
                                  contractStatuses[lead.id] === 'sent' ? '#2980b9' :
                                  contractStatuses[lead.id] === 'draft' ? '#8a8580' :
                                  '#8a8580',
                              }}>
                                {contractStatuses[lead.id] === 'signed_digital' ? 'Contract Signed (Digital)' :
                                 contractStatuses[lead.id] === 'signed_paper' ? 'Contract Signed (Paper)' :
                                 contractStatuses[lead.id] === 'active' ? 'Contract Active' :
                                 contractStatuses[lead.id] === 'sent' ? 'Contract Sent' :
                                 contractStatuses[lead.id] === 'draft' ? 'Contract Draft' :
                                 `Contract: ${contractStatuses[lead.id]}`}
                              </span>
                            </div>
                          )}

                          {/* Assigned agent badge */}
                          {lead.assigned_agent_user_id && (
                            <div style={{
                              marginTop: '8px', display: 'flex', alignItems: 'center', gap: '4px',
                            }}>
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke={C.darkGreen} strokeWidth="1.2" strokeLinecap="round">
                                <circle cx="5" cy="3.5" r="2" /><path d="M1.5 9c0-2 1.5-3.5 3.5-3.5s3.5 1.5 3.5 3.5" />
                              </svg>
                              <span style={{ fontFamily: F.body, fontSize: '10px', color: C.darkGreen, fontWeight: 500 }}>
                                {getAgentName(lead.assigned_agent_user_id)}
                              </span>
                            </div>
                          )}

                          {/* Next action */}
                          {lead.next_action && (
                            <div style={{
                              marginTop: '6px', paddingTop: '6px', borderTop: `1px solid ${C.borderLight}`,
                              display: 'flex', alignItems: 'center', gap: '4px',
                            }}>
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke={C.yellow} strokeWidth="1.5" strokeLinecap="round">
                                <circle cx="5" cy="5" r="4" /><path d="M5 3v2l1.5 1" />
                              </svg>
                              <span style={{ fontFamily: F.body, fontSize: '10px', color: C.textMuted }}>
                                {lead.next_action}
                                {lead.next_action_date && ` · ${new Date(lead.next_action_date).toLocaleDateString('fi-FI')}`}
                              </span>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ═══ LIST VIEW ═══ */
          <div style={{ backgroundColor: C.white, borderRadius: '12px', border: `1px solid ${C.border}`, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: F.body, fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: C.beigeLight }}>
                  {['Company', 'Contact', 'Email', 'Stage', 'Offer', 'Contract', 'Assigned To', 'Space Type', 'Budget', 'Next Action'].map((h) => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '12px 16px', fontWeight: 600,
                      fontSize: '12px', color: C.textSecondary,
                      textTransform: 'uppercase', letterSpacing: '0.04em',
                      borderBottom: `1px solid ${C.border}`,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((lead, i) => {
                  const stage = STAGES.find((s) => s.key === lead.stage) || STAGES[0];
                  return (
                    <tr key={lead.id}
                      onClick={() => { setEditLeadId(lead.id); setIsEditModalOpen(true); }}
                      style={{
                        cursor: 'pointer',
                        borderBottom: i < filtered.length - 1 ? `1px solid ${C.borderLight}` : 'none',
                        transition: 'background-color 0.15s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = C.offWhite)}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <td style={{ padding: '12px 16px', fontWeight: 600, color: C.textPrimary }}>{lead.company_name || '—'}</td>
                      <td style={{ padding: '12px 16px', color: C.textSecondary }}>
                        {[lead.contact_first_name, lead.contact_last_name].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td style={{ padding: '12px 16px', color: C.textMuted }}>{lead.email || '—'}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          fontSize: '11px', fontWeight: 600, color: stage.color,
                          backgroundColor: stage.bg, borderRadius: '6px', padding: '3px 10px',
                        }}>{stage.label}</span>
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: '12px' }}>
                        {offerStatuses[lead.id] ? (
                          <span style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            color: offerStatuses[lead.id] === 'accepted' ? '#27ae60' :
                              offerStatuses[lead.id] === 'sent' ? '#2980b9' :
                              offerStatuses[lead.id] === 'viewed' ? '#9b59b6' :
                              offerStatuses[lead.id] === 'declined' ? '#c0392b' : '#8a8580',
                            textTransform: 'capitalize',
                          }}>
                            {offerStatuses[lead.id]}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: '12px' }}>
                        {contractStatuses[lead.id] ? (
                          <span style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            color: contractStatuses[lead.id] === 'signed_digital' || contractStatuses[lead.id] === 'signed_paper' ? '#27ae60' :
                              contractStatuses[lead.id] === 'active' ? '#27ae60' :
                              contractStatuses[lead.id] === 'sent' ? '#2980b9' :
                              contractStatuses[lead.id] === 'draft' ? '#8a8580' : '#8a8580',
                          }}>
                            {contractStatuses[lead.id] === 'signed_digital' ? 'Contract Signed (Digital)' :
                             contractStatuses[lead.id] === 'signed_paper' ? 'Contract Signed (Paper)' :
                             contractStatuses[lead.id] === 'active' ? 'Contract Active' :
                             contractStatuses[lead.id] === 'sent' ? 'Contract Sent' :
                             contractStatuses[lead.id] === 'draft' ? 'Contract Draft' :
                             `Contract: ${contractStatuses[lead.id]}`}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '12px 16px', color: C.textSecondary, fontSize: '12px' }}>
                        {getAgentName(lead.assigned_agent_user_id)}
                      </td>
                      <td style={{ padding: '12px 16px', color: C.textSecondary, textTransform: 'capitalize' }}>
                        {(lead.interested_space_type || '—').replace(/_/g, ' ')}
                      </td>
                      <td style={{ padding: '12px 16px', color: C.textSecondary }}>
                        {lead.budget_eur_month ? `€${lead.budget_eur_month.toLocaleString()}` : '—'}
                      </td>
                      <td style={{ padding: '12px 16px', color: C.textMuted, fontSize: '12px' }}>{lead.next_action || '—'}</td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{ padding: '48px 16px', textAlign: 'center', color: C.textMuted }}>
                      No leads found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ═══ CREATE LEAD MODAL ═══ */}
      {isCreateModalOpen && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: C.overlay,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 50, padding: '20px',
        }} onClick={() => setIsCreateModalOpen(false)}>
          <div style={{
            backgroundColor: C.offWhite, borderRadius: '16px', width: '100%',
            maxWidth: '640px', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 25px 60px rgba(0,0,0,0.15)', overflow: 'hidden',
          }} onClick={(e) => e.stopPropagation()}>

            {/* Header */}
            <div style={{
              padding: '28px 32px 20px', borderBottom: `1px solid ${C.border}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            }}>
              <div>
                <h2 style={{ fontFamily: F.heading, fontSize: '24px', fontWeight: 400, color: C.textPrimary, margin: 0 }}>
                  New Lead
                </h2>
                <p style={{ fontFamily: F.body, fontSize: '13px', color: C.textMuted, margin: '4px 0 0' }}>
                  Add a new company to your pipeline
                </p>
              </div>
              <button onClick={() => setIsCreateModalOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: '4px' }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="5" y1="5" x2="15" y2="15" /><line x1="15" y1="5" x2="5" y2="15" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '24px 32px', overflowY: 'auto', flex: 1 }}>
              <div style={{ marginBottom: '14px' }}>
                <label style={labelBase}>Company name <span style={{ color: C.red }}>*</span></label>
                <input value={createForm.company_name}
                  onChange={(e) => setCreateForm((p) => ({ ...p, company_name: e.target.value }))}
                  placeholder="e.g. Acme Oy" style={inputBase}
                  onFocus={onInputFocus} onBlur={onInputBlur} />
              </div>

              <div style={gridTwo}>
                <div style={{ marginBottom: '14px' }}>
                  <label style={labelBase}>Y-tunnus</label>
                  <input value={createForm.y_tunnus}
                    onChange={(e) => setCreateForm((p) => ({ ...p, y_tunnus: e.target.value }))}
                    placeholder="1234567-8" style={inputBase}
                    onFocus={onInputFocus} onBlur={onInputBlur} />
                </div>
                <div style={{ marginBottom: '14px' }}>
                  <label style={labelBase}>Industry</label>
                  <input value={createForm.industry}
                    onChange={(e) => setCreateForm((p) => ({ ...p, industry: e.target.value }))}
                    style={inputBase} onFocus={onInputFocus} onBlur={onInputBlur} />
                </div>
              </div>

              <div style={gridTwo}>
                <div style={{ marginBottom: '14px' }}>
                  <label style={labelBase}>First name</label>
                  <input value={createForm.contact_first_name}
                    onChange={(e) => setCreateForm((p) => ({ ...p, contact_first_name: e.target.value }))}
                    style={inputBase} onFocus={onInputFocus} onBlur={onInputBlur} />
                </div>
                <div style={{ marginBottom: '14px' }}>
                  <label style={labelBase}>Last name</label>
                  <input value={createForm.contact_last_name}
                    onChange={(e) => setCreateForm((p) => ({ ...p, contact_last_name: e.target.value }))}
                    style={inputBase} onFocus={onInputFocus} onBlur={onInputBlur} />
                </div>
              </div>

              <div style={gridTwo}>
                <div style={{ marginBottom: '14px' }}>
                  <label style={labelBase}>Email</label>
                  <input type="email" value={createForm.email}
                    onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))}
                    placeholder="name@company.com" style={inputBase}
                    onFocus={onInputFocus} onBlur={onInputBlur} />
                </div>
                <div style={{ marginBottom: '14px' }}>
                  <label style={labelBase}>Phone</label>
                  <input type="tel" value={createForm.phone}
                    onChange={(e) => setCreateForm((p) => ({ ...p, phone: e.target.value }))}
                    placeholder="+358" style={inputBase}
                    onFocus={onInputFocus} onBlur={onInputBlur} />
                </div>
              </div>

              <div style={gridTwo}>
                <div style={{ marginBottom: '14px' }}>
                  <label style={labelBase}>Property</label>
                  <select value={createForm.property_id}
                    onChange={(e) => setCreateForm((p) => ({ ...p, property_id: e.target.value }))}
                    style={selectBase} onFocus={onInputFocus} onBlur={onInputBlur}>
                    <option value="">— Select —</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>{p.name || p.id.slice(0, 8)}</option>
                    ))}
                  </select>
                </div>
                <div style={{ marginBottom: '14px' }}>
                  <label style={labelBase}>Space interest</label>
                  <select value={createForm.interested_space_type}
                    onChange={(e) => setCreateForm((p) => ({ ...p, interested_space_type: e.target.value }))}
                    style={selectBase} onFocus={onInputFocus} onBlur={onInputBlur}>
                    <option value="">— Select —</option>
                    <option value="office">Office</option>
                    <option value="meeting_room">Meeting Room</option>
                    <option value="venue">Venue</option>
                    <option value="hot_desk">Coworking / Hot Desk</option>
                  </select>
                </div>
              </div>

              <div style={gridTwo}>
                <div style={{ marginBottom: '14px' }}>
                  <label style={labelBase}>Contact Status</label>
                  <select value={createForm.contact_status}
                    onChange={(e) => setCreateForm((p) => ({ ...p, contact_status: e.target.value }))}
                    style={selectBase} onFocus={onInputFocus} onBlur={onInputBlur}>
                    <option value="">— Select —</option>
                    <option value="Lead">Lead</option>
                    <option value="Pipeline lead">Pipeline lead</option>
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Lost">Lost</option>
                  </select>
                </div>
                <div style={{ marginBottom: '14px' }}>
                  <label style={labelBase}>Stage</label>
                  <select value={createForm.stage}
                    onChange={(e) => setCreateForm((p) => ({ ...p, stage: e.target.value }))}
                    style={selectBase} onFocus={onInputFocus} onBlur={onInputBlur}>
                    {STAGES.map((s) => (
                      <option key={s.key} value={s.key}>{s.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={gridTwo}>
                <div style={{ marginBottom: '14px' }}>
                  <label style={labelBase}>Source</label>
                  <select value={createForm.source}
                    onChange={(e) => setCreateForm((p) => ({ ...p, source: e.target.value }))}
                    style={selectBase} onFocus={onInputFocus} onBlur={onInputBlur}>
                    <option value="">— Select —</option>
                    <option value="website">Website</option>
                    <option value="referral">Referral</option>
                    <option value="tour">Office Tour</option>
                    <option value="cold_call">Cold Call</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="event">Event</option>
                    <option value="partner">Partner</option>
                    <option value="chatbot">Chatbot</option>
                    <option value="email_campaign">Email campaign</option>
                    <option value="walk_in">Walk-in</option>
                  </select>
                </div>
                <div style={{ marginBottom: '14px' }}>
                  <label style={labelBase}>Company size</label>
                  <select value={createForm.company_size}
                    onChange={(e) => setCreateForm((p) => ({ ...p, company_size: e.target.value }))}
                    style={selectBase} onFocus={onInputFocus} onBlur={onInputBlur}>
                    <option value="">— Select —</option>
                    <option value="1-10">1–10 employees</option>
                    <option value="11-50">11–50 employees</option>
                    <option value="51-200">51–200 employees</option>
                    <option value="200+">200+ employees</option>
                  </select>
                </div>
              </div>

              {/* Assign to agent */}
              {canFilterAgents && agents.length > 0 && (
                <div style={{ marginBottom: '14px' }}>
                  <label style={labelBase}>Assign to</label>
                  <select value={createForm.assigned_agent_user_id}
                    onChange={(e) => setCreateForm((p) => ({ ...p, assigned_agent_user_id: e.target.value }))}
                    style={selectBase} onFocus={onInputFocus} onBlur={onInputBlur}>
                    <option value="">— Unassigned —</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.display}{agent.id === currentUserId ? ' (me)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ marginBottom: '14px' }}>
                <label style={labelBase}>Notes</label>
                <textarea value={createForm.notes}
                  onChange={(e) => setCreateForm((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Initial notes..."
                  style={{ ...inputBase, minHeight: '70px', resize: 'vertical' as const }}
                  onFocus={onInputFocus} onBlur={onInputBlur} />
              </div>
            </div>

            {/* Footer */}
            <div style={{
              padding: '16px 32px', borderTop: `1px solid ${C.border}`,
              display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: '#f0ece6',
            }}>
              <button onClick={() => setIsCreateModalOpen(false)} style={{
                fontFamily: F.body, fontSize: '14px', fontWeight: 500, color: C.textSecondary,
                backgroundColor: 'transparent', border: `1px solid ${C.border}`,
                borderRadius: '8px', padding: '10px 20px', cursor: 'pointer',
              }}>Cancel</button>
              <button onClick={handleCreate}
                disabled={creating || !createForm.company_name.trim()}
                style={{
                  fontFamily: F.body, fontSize: '14px', fontWeight: 600, color: C.white,
                  backgroundColor: C.darkGreen, border: 'none', borderRadius: '8px',
                  padding: '10px 24px', cursor: 'pointer',
                  opacity: creating || !createForm.company_name.trim() ? 0.5 : 1,
                  transition: 'background-color 0.2s',
                }}
                onMouseEnter={(e) => { if (!creating) e.currentTarget.style.backgroundColor = C.darkGreenHover; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = C.darkGreen; }}
              >{creating ? 'Creating...' : 'Create Lead'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ EDIT LEAD MODAL ═══ */}
      <EditLeadModal
        isOpen={isEditModalOpen}
        onClose={() => { setIsEditModalOpen(false); setEditLeadId(null); }}
        leadId={editLeadId}
        onSave={() => fetchLeads()}
        onDelete={() => fetchLeads()}
      />

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}