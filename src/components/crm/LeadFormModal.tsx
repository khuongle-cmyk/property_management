'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  EDIT_LEAD_MODAL_STAGE_OPTIONS,
  dbStageValueFromLeadForm,
  leadStageColumnKeyFromDb,
} from '@/lib/crm/lead-stage-form';

interface EditLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  leadId: string | null;
  onSave: () => void;
  onDelete?: () => void;
  [key: string]: any;
}

export default function EditLeadModal({ isOpen, onClose, leadId, onSave, onDelete }: EditLeadModalProps) {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [formData, setFormData] = useState({
    company_name: '',
    y_tunnus: '',
    vat_number: '',
    company_type: '',
    industry: '',
    company_size: '',
    website: '',
    contact_first_name: '',
    contact_last_name: '',
    email: '',
    phone: '',
    contact_title: '',
    contact_phone_direct: '',
    billing_address: '',
    billing_postal_code: '',
    billing_city: '',
    billing_email: '',
    e_invoice_address: '',
    e_invoice_operator: '',
    e_invoice_operator_code: '',
    stage: 'new',
    source: '',
    notes: '',
    interested_space_type: '',
    approx_size_m2: '',
    budget_eur_month: '',
    preferred_move_in_date: '',
    next_action: '',
    next_action_date: '',
    pipeline_owner: '',
  });

  useEffect(() => {
    if (leadId && isOpen) {
      fetchLead();
      setShowDeleteConfirm(false);
    }
  }, [leadId, isOpen]);

  const fetchLead = async () => {
    if (!leadId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('id', leadId)
        .single();

      if (error) throw error;
      if (data) {
        setFormData({
          company_name: data.company_name || '',
          y_tunnus: data.y_tunnus || '',
          vat_number: data.vat_number || '',
          company_type: data.company_type || '',
          industry: data.industry || '',
          company_size: data.company_size || '',
          website: data.website || '',
          contact_first_name: data.contact_first_name || '',
          contact_last_name: data.contact_last_name || '',
          email: data.email || '',
          phone: data.phone || '',
          contact_title: data.contact_title || '',
          contact_phone_direct: data.contact_phone_direct || '',
          billing_address: data.billing_address || '',
          billing_postal_code: data.billing_postal_code || '',
          billing_city: data.billing_city || '',
          billing_email: data.billing_email || '',
          e_invoice_address: data.e_invoice_address || '',
          e_invoice_operator: data.e_invoice_operator || '',
          e_invoice_operator_code: data.e_invoice_operator_code || '',
          stage: leadStageColumnKeyFromDb(data.stage),
          source: data.source || '',
          notes: data.notes || '',
          interested_space_type: data.interested_space_type || '',
          approx_size_m2: data.approx_size_m2 ? String(data.approx_size_m2) : '',
          budget_eur_month: data.budget_eur_month ? String(data.budget_eur_month) : '',
          preferred_move_in_date: data.preferred_move_in_date || '',
          next_action: data.next_action || '',
          next_action_date: data.next_action_date || '',
          pipeline_owner: data.pipeline_owner || '',
        });
      }
    } catch (err) {
      console.error('Error fetching lead:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!leadId) return;
    setLoading(true);
    try {
      const updateData: any = {
        company_name: formData.company_name,
        y_tunnus: formData.y_tunnus,
        vat_number: formData.vat_number,
        company_type: formData.company_type,
        industry: formData.industry,
        company_size: formData.company_size,
        website: formData.website,
        contact_first_name: formData.contact_first_name,
        contact_last_name: formData.contact_last_name,
        email: formData.email,
        phone: formData.phone,
        contact_title: formData.contact_title,
        contact_phone_direct: formData.contact_phone_direct,
        billing_address: formData.billing_address,
        billing_postal_code: formData.billing_postal_code,
        billing_city: formData.billing_city,
        billing_email: formData.billing_email,
        e_invoice_address: formData.e_invoice_address,
        e_invoice_operator: formData.e_invoice_operator,
        e_invoice_operator_code: formData.e_invoice_operator_code,
        stage: dbStageValueFromLeadForm(formData.stage),
        source: formData.source,
        notes: formData.notes,
        interested_space_type: formData.interested_space_type,
        approx_size_m2: formData.approx_size_m2 ? Number(formData.approx_size_m2) : null,
        budget_eur_month: formData.budget_eur_month ? Number(formData.budget_eur_month) : null,
        preferred_move_in_date: formData.preferred_move_in_date || null,
        next_action: formData.next_action,
        next_action_date: formData.next_action_date || null,
        pipeline_owner: formData.pipeline_owner,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('leads')
        .update(updateData)
        .eq('id', leadId);

      if (error) throw error;
      onSave();
      onClose();
    } catch (err) {
      console.error('Error updating lead:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!leadId) return;
    setDeleting(true);
    try {
      await supabase
        .from('leads')
        .update({
          won_room_id: null,
          won_proposal_id: null,
          assigned_agent_user_id: null,
          interested_property_id: null,
        })
        .eq('id', leadId);

      const { error } = await supabase
        .from('leads')
        .delete()
        .eq('id', leadId);

      if (error) throw error;
      setShowDeleteConfirm(false);
      onDelete?.();
      onSave();
      onClose();
    } catch (err) {
      console.error('Error deleting lead:', err);
    } finally {
      setDeleting(false);
    }
  };

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  if (!isOpen) return null;

  // ── VillageWorks Design Manual Tokens ──
  const colors = {
    petrolGreen: '#21524F',
    petrolDark: '#1a4340',
    petrolLight: '#e8f0ee',
    cream: '#faf8f5',
    creamDark: '#f0ece6',
    beige: '#F3DFC6',
    warmGray: '#6b6560',
    warmGrayLight: '#9a9590',
    textPrimary: '#2c2825',
    textSecondary: '#6b6560',
    white: '#ffffff',
    red: '#c0392b',
    redLight: '#fdf0ee',
    border: '#e5e0da',
    borderFocus: '#21524F',
    overlay: 'rgba(0, 0, 0, 0.4)',
  };

  const fonts = {
    heading: "'Instrument Serif', Georgia, serif",
    body: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontFamily: fonts.heading, fontSize: '18px', fontWeight: 400,
    color: colors.petrolGreen, marginBottom: '16px', paddingBottom: '8px',
    borderBottom: `1px solid ${colors.border}`,
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: fonts.body, fontSize: '13px', fontWeight: 500,
    color: colors.textSecondary, marginBottom: '4px', display: 'block',
  };

  const inputStyle: React.CSSProperties = {
    fontFamily: fonts.body, fontSize: '14px', color: colors.textPrimary,
    backgroundColor: colors.white, border: `1px solid ${colors.border}`,
    borderRadius: '8px', padding: '10px 14px', width: '100%',
    outline: 'none', transition: 'border-color 0.2s, box-shadow 0.2s',
    boxSizing: 'border-box',
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle, appearance: 'none' as const,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236b6560' d='M2 4l4 4 4-4'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 14px center', paddingRight: '36px',
  };

  const onFocus = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = colors.borderFocus;
    e.target.style.boxShadow = `0 0 0 3px ${colors.petrolLight}`;
  };
  const onBlur = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = colors.border;
    e.target.style.boxShadow = 'none';
  };

  const InputField = ({ label, field, placeholder, required, type = 'text' }: {
    label: string; field: string; placeholder?: string; required?: boolean; type?: string;
  }) => (
    <div style={{ marginBottom: '14px' }}>
      <label style={labelStyle}>
        {label}{required && <span style={{ color: colors.red, marginLeft: '3px' }}>*</span>}
      </label>
      <input type={type} value={(formData as any)[field] || ''}
        onChange={(e) => handleChange(field, e.target.value)}
        placeholder={placeholder || ''} style={inputStyle}
        onFocus={onFocus} onBlur={onBlur} />
    </div>
  );

  const SelectField = ({ label, field, options }: {
    label: string; field: string; options: { value: string; label: string }[];
  }) => (
    <div style={{ marginBottom: '14px' }}>
      <label style={labelStyle}>{label}</label>
      <select value={(formData as any)[field] || ''}
        onChange={(e) => handleChange(field, e.target.value)}
        style={selectStyle} onFocus={onFocus} onBlur={onBlur}>
        <option value="">— Select —</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );

  const gridTwo: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' };
  const gridThree: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' };

  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: colors.overlay,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 50, padding: '20px',
    }} onClick={onClose}>
      <div style={{
        backgroundColor: colors.cream, borderRadius: '16px', width: '100%',
        maxWidth: '720px', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 25px 60px rgba(0,0,0,0.15), 0 8px 20px rgba(0,0,0,0.08)',
        overflow: 'hidden',
      }} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div style={{
          padding: '28px 32px 20px', borderBottom: `1px solid ${colors.border}`,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px',
        }}>
          <div>
            <h2 style={{
              fontFamily: fonts.heading, fontSize: '26px', fontWeight: 400,
              color: colors.textPrimary, margin: 0, lineHeight: 1.2,
            }}>Edit Lead</h2>
            <p style={{
              fontFamily: fonts.body, fontSize: '13px', color: colors.warmGrayLight,
              margin: '6px 0 0', lineHeight: 1.4,
            }}>Update lead details. Y-tunnus and e-invoice fields support Finnish invoicing (Finvoice).</p>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
            color: colors.warmGrayLight, borderRadius: '6px',
          }}
            onMouseEnter={(e) => (e.currentTarget.style.color = colors.textPrimary)}
            onMouseLeave={(e) => (e.currentTarget.style.color = colors.warmGrayLight)}
            aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="5" y1="5" x2="15" y2="15" /><line x1="15" y1="5" x2="5" y2="15" />
            </svg>
          </button>
        </div>

        {/* Scrollable Body */}
        <div style={{ padding: '24px 32px', overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '60px 0', fontFamily: fonts.body, fontSize: '14px', color: colors.warmGrayLight,
            }}>
              <svg width="20" height="20" viewBox="0 0 20 20" style={{ marginRight: '10px', animation: 'spin 1s linear infinite' }}>
                <circle cx="10" cy="10" r="8" stroke={colors.petrolGreen} strokeWidth="2" fill="none" strokeDasharray="36 14" />
              </svg>
              Loading lead details...
            </div>
          ) : (
            <>
              <h3 style={sectionTitleStyle}>1. Company Information</h3>
              <InputField label="Company name" field="company_name" required />
              <div style={gridTwo}>
                <InputField label="Y-tunnus" field="y_tunnus" placeholder="1234567-8" />
                <InputField label="VAT number (ALV-numero)" field="vat_number" placeholder="FI12345678" />
              </div>
              <div style={gridTwo}>
                <SelectField label="Company type" field="company_type" options={[
                  { value: 'oy', label: 'Oy (Ltd)' }, { value: 'oyj', label: 'Oyj (Plc)' },
                  { value: 'tmi', label: 'Tmi (Sole trader)' }, { value: 'ky', label: 'Ky (Partnership)' },
                  { value: 'ay', label: 'Ay (General partnership)' }, { value: 'osk', label: 'Osk (Cooperative)' },
                  { value: 'ry', label: 'Ry (Association)' }, { value: 'saatio', label: 'Säätiö (Foundation)' },
                  { value: 'other', label: 'Other' },
                ]} />
                <SelectField label="Industry" field="industry" options={[
                  { value: 'technology', label: 'Technology' }, { value: 'finance', label: 'Finance & Banking' },
                  { value: 'consulting', label: 'Consulting' }, { value: 'legal', label: 'Legal' },
                  { value: 'marketing', label: 'Marketing & Media' }, { value: 'healthcare', label: 'Healthcare' },
                  { value: 'education', label: 'Education' }, { value: 'retail', label: 'Retail & E-commerce' },
                  { value: 'manufacturing', label: 'Manufacturing' }, { value: 'real_estate', label: 'Real Estate' },
                  { value: 'nonprofit', label: 'Non-profit' }, { value: 'other', label: 'Other' },
                ]} />
              </div>
              <div style={gridTwo}>
                <SelectField label="Company size" field="company_size" options={[
                  { value: '1-5', label: '1–5 employees' }, { value: '6-20', label: '6–20 employees' },
                  { value: '21-50', label: '21–50 employees' }, { value: '51-200', label: '51–200 employees' },
                  { value: '201-500', label: '201–500 employees' }, { value: '500+', label: '500+ employees' },
                ]} />
                <InputField label="Website" field="website" placeholder="https://" />
              </div>

              <h3 style={{ ...sectionTitleStyle, marginTop: '28px' }}>2. Contact Person</h3>
              <div style={gridTwo}>
                <InputField label="First name" field="contact_first_name" required />
                <InputField label="Last name" field="contact_last_name" required />
              </div>
              <div style={gridTwo}>
                <InputField label="Email" field="email" type="email" placeholder="name@company.com" />
                <InputField label="Phone" field="phone" type="tel" placeholder="+358" />
              </div>
              <div style={gridTwo}>
                <InputField label="Title / Role" field="contact_title" placeholder="e.g. CEO, Office Manager" />
                <InputField label="Direct phone" field="contact_phone_direct" type="tel" placeholder="+358" />
              </div>

              <h3 style={{ ...sectionTitleStyle, marginTop: '28px' }}>3. Billing Address</h3>
              <InputField label="Street address" field="billing_address" />
              <div style={gridThree}>
                <InputField label="Postal code" field="billing_postal_code" />
                <InputField label="City" field="billing_city" />
                <InputField label="Billing email" field="billing_email" type="email" placeholder="billing@company.com" />
              </div>

              <h3 style={{ ...sectionTitleStyle, marginTop: '28px' }}>4. E-Invoicing (Finvoice)</h3>
              <div style={gridThree}>
                <InputField label="E-invoice address" field="e_invoice_address" placeholder="003712345678" />
                <InputField label="Operator name" field="e_invoice_operator" placeholder="e.g. Basware" />
                <InputField label="Operator code" field="e_invoice_operator_code" placeholder="e.g. BAWCFI22" />
              </div>

              <h3 style={{ ...sectionTitleStyle, marginTop: '28px' }}>5. Space Interest</h3>
              <div style={gridThree}>
                <SelectField label="Space type" field="interested_space_type" options={[
                  { value: 'private_office', label: 'Private Office' }, { value: 'open_desk', label: 'Open Desk' },
                  { value: 'meeting_room', label: 'Meeting Room' }, { value: 'event_space', label: 'Event / Venue' },
                  { value: 'virtual_office', label: 'Virtual Office' }, { value: 'coworking', label: 'Coworking' },
                  { value: 'other', label: 'Other' },
                ]} />
                <InputField label="Approx. size (m²)" field="approx_size_m2" type="number" placeholder="e.g. 50" />
                <InputField label="Budget (€/month)" field="budget_eur_month" type="number" placeholder="e.g. 2000" />
              </div>
              <div style={gridTwo}>
                <InputField label="Preferred move-in date" field="preferred_move_in_date" type="date" />
                <InputField label="Pipeline owner" field="pipeline_owner" placeholder="e.g. Mariia, Inka" />
              </div>

              <h3 style={{ ...sectionTitleStyle, marginTop: '28px' }}>6. Lead Status</h3>
              <div style={gridTwo}>
                <SelectField label="Stage" field="stage" options={EDIT_LEAD_MODAL_STAGE_OPTIONS} />
                <SelectField label="Source" field="source" options={[
                  { value: 'website', label: 'Website' }, { value: 'referral', label: 'Referral' },
                  { value: 'tour', label: 'Office Tour' }, { value: 'cold_call', label: 'Cold Call' },
                  { value: 'event', label: 'Event' }, { value: 'linkedin', label: 'LinkedIn' },
                  { value: 'partner', label: 'Partner' }, { value: 'other', label: 'Other' },
                ]} />
              </div>
              <div style={gridTwo}>
                <InputField label="Next action" field="next_action" placeholder="e.g. Send proposal, Schedule tour" />
                <InputField label="Next action date" field="next_action_date" type="date" />
              </div>
              <div style={{ marginBottom: '14px' }}>
                <label style={labelStyle}>Notes</label>
                <textarea value={formData.notes}
                  onChange={(e) => handleChange('notes', e.target.value)}
                  placeholder="Internal notes about this lead..."
                  style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' as const }}
                  onFocus={onFocus as any} onBlur={onBlur as any} />
              </div>

              {/* Delete Danger Zone */}
              <div style={{
                marginTop: '32px', padding: '16px 20px',
                backgroundColor: colors.redLight, borderRadius: '10px', border: '1px solid #f0d0cc',
              }}>
                {!showDeleteConfirm ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <p style={{ fontFamily: fonts.body, fontSize: '14px', fontWeight: 600, color: colors.red, margin: 0 }}>Danger zone</p>
                      <p style={{ fontFamily: fonts.body, fontSize: '12px', color: colors.warmGray, margin: '2px 0 0' }}>
                        Permanently delete this lead and all associated data.
                      </p>
                    </div>
                    <button onClick={() => setShowDeleteConfirm(true)} style={{
                      fontFamily: fonts.body, fontSize: '13px', fontWeight: 500,
                      color: colors.red, backgroundColor: 'transparent',
                      border: `1px solid ${colors.red}`, borderRadius: '8px',
                      padding: '9px 18px', cursor: 'pointer', transition: 'background-color 0.2s, color 0.2s',
                    }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = colors.red; e.currentTarget.style.color = colors.white; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = colors.red; }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <path d="M2 3.5h10M5.5 6v4M8.5 6v4M3 3.5l.5 8a1 1 0 001 1h5a1 1 0 001-1l.5-8M5 3.5V2a1 1 0 011-1h2a1 1 0 011 1v1.5" />
                        </svg>
                        Delete lead
                      </span>
                    </button>
                  </div>
                ) : (
                  <div>
                    <p style={{ fontFamily: fonts.body, fontSize: '14px', fontWeight: 600, color: colors.red, margin: '0 0 4px' }}>Are you sure?</p>
                    <p style={{ fontFamily: fonts.body, fontSize: '12px', color: colors.warmGray, margin: '0 0 12px' }}>
                      This action cannot be undone. The lead &quot;{formData.company_name || 'Unnamed'}&quot; will be permanently removed.
                    </p>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button onClick={handleDelete} disabled={deleting} style={{
                        fontFamily: fonts.body, fontSize: '13px', fontWeight: 500,
                        color: colors.white, backgroundColor: colors.red,
                        border: `1px solid ${colors.red}`, borderRadius: '8px',
                        padding: '9px 18px', cursor: 'pointer', opacity: deleting ? 0.6 : 1,
                      }}>{deleting ? 'Deleting...' : 'Yes, delete permanently'}</button>
                      <button onClick={() => setShowDeleteConfirm(false)} style={{
                        fontFamily: fonts.body, fontSize: '14px', fontWeight: 500,
                        color: colors.textSecondary, backgroundColor: 'transparent',
                        border: `1px solid ${colors.border}`, borderRadius: '8px',
                        padding: '10px 20px', cursor: 'pointer',
                      }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 32px', borderTop: `1px solid ${colors.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px',
          backgroundColor: colors.creamDark,
        }}>
          <button onClick={onClose} style={{
            fontFamily: fonts.body, fontSize: '14px', fontWeight: 500,
            color: colors.textSecondary, backgroundColor: 'transparent',
            border: `1px solid ${colors.border}`, borderRadius: '8px',
            padding: '10px 20px', cursor: 'pointer',
          }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = colors.white; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
          >Cancel</button>
          <button onClick={handleSave} disabled={loading} style={{
            fontFamily: fonts.body, fontSize: '14px', fontWeight: 600,
            color: colors.white, backgroundColor: colors.petrolGreen,
            border: 'none', borderRadius: '8px', padding: '10px 24px',
            cursor: 'pointer', transition: 'background-color 0.2s',
            opacity: loading ? 0.6 : 1,
          }}
            onMouseEnter={(e) => { if (!loading) e.currentTarget.style.backgroundColor = colors.petrolDark; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = colors.petrolGreen; }}
          >{loading ? 'Saving...' : 'Save changes'}</button>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}