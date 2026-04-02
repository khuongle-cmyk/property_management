/** Mock data for VillageWorks dashboard Email module (Gmail API later). */

export type VwPropertyId = "erottaja2" | "freda" | "p5" | "sahkis" | "skylounge";

export const VW_PROPERTIES: Array<{
  id: VwPropertyId;
  short: string;
  legalName: string;
  badgeClass: string;
}> = [
  { id: "erottaja2", short: "Erottaja2", legalName: "mid6 Oy", badgeClass: "bg-teal-100 text-teal-900 border-teal-200" },
  { id: "freda", short: "Freda", legalName: "Kampin Toimistopalvelut Oy", badgeClass: "bg-amber-100 text-amber-900 border-amber-200" },
  { id: "p5", short: "P5", legalName: "DCA Global Services Oy", badgeClass: "bg-sky-100 text-sky-900 border-sky-200" },
  { id: "sahkis", short: "Sahkis", legalName: "WM Office Services Oy", badgeClass: "bg-violet-100 text-violet-900 border-violet-200" },
  { id: "skylounge", short: "SkyLounge", legalName: "Work & Meet Oy", badgeClass: "bg-rose-100 text-rose-900 border-rose-200" },
];

export function propertyById(id: VwPropertyId) {
  return VW_PROPERTIES.find((p) => p.id === id)!;
}

export type ThreadStatus = "needs_reply" | "awaiting" | "replied";

export type MockThread = {
  id: string;
  senderName: string;
  senderInitials: string;
  subject: string;
  preview: string;
  propertyId: VwPropertyId;
  status: ThreadStatus;
  updatedAt: string; // ISO
  /** When true, show unread dot in inbox until opened. */
  unread?: boolean;
};

export const MOCK_THREADS: MockThread[] = [
  {
    id: "t1",
    senderName: "Jussi Virtanen",
    senderInitials: "JV",
    subject: "Laajennus Erottaja2-tiloihin — kapasiteetti ja aikataulu",
    preview: "Hei Mariia, kiitos eilisestä puhelusta. Voitteko vahvistaa, mitä vapaita…",
    propertyId: "erottaja2",
    status: "needs_reply",
    updatedAt: "2026-04-02T09:15:00+03:00",
    unread: true,
  },
  {
    id: "t2",
    senderName: "Aino Korhonen",
    senderInitials: "AK",
    subject: "Re: Meeting room booking April",
    preview: "Kiitos, vahvistan että klo 14 sopii meille.",
    propertyId: "freda",
    status: "awaiting",
    updatedAt: "2026-04-01T16:40:00+03:00",
  },
  {
    id: "t3",
    senderName: "Mikko Nieminen",
    senderInitials: "MN",
    subject: "Laskutusosoitteen päivitys",
    preview: "Pyydämme päivittämään Y-tunnuksen laskutusjärjestelmään…",
    propertyId: "p5",
    status: "replied",
    updatedAt: "2026-04-01T11:05:00+03:00",
  },
  {
    id: "t4",
    senderName: "Sanna Lehtonen",
    senderInitials: "SL",
    subject: "Coworking membership renewal",
    preview: "Haluaisimme jatkaa jäsenyyttä kesäkuusta alkaen.",
    propertyId: "sahkis",
    status: "needs_reply",
    updatedAt: "2026-03-31T14:22:00+03:00",
  },
  {
    id: "t5",
    senderName: "Oliver Lindström",
    senderInitials: "OL",
    subject: "Tilavierailu torstaina",
    preview: "Vahvistan vierailun klo 10–11 SkyLounge-tiloissa.",
    propertyId: "skylounge",
    status: "awaiting",
    updatedAt: "2026-03-30T09:50:00+03:00",
  },
  {
    id: "t6",
    senderName: "Helena Mäkinen",
    senderInitials: "HM",
    subject: "Re: Tarjous virtuaali­toimistosta",
    preview: "Kiitos tarjouksesta — keskustelemme tiimin kanssa perjantaihin mennessä.",
    propertyId: "freda",
    status: "replied",
    updatedAt: "2026-03-29T08:12:00+03:00",
  },
];

/** Inbox row status maps to thread header dropdown (Replied → Closed). */
export type DetailThreadStatus = "needs_reply" | "awaiting" | "closed";

export type MockThreadMessage = {
  id: string;
  at: string;
  direction: "in" | "out";
  fromName: string;
  fromEmail: string;
  toLine: string;
  bodyHtml: string;
  longBody?: boolean;
  attachments?: { name: string; sizeLabel: string }[];
  tracking?: { openCount: number; lastOpenedLabel: string };
};

export type MockThreadSidebar = {
  contactEmail: string;
  phone: string;
  activities: { title: string; at: string }[];
  otherThreads: { id: string; subject: string; preview: string }[];
};

export type MockThreadDetail = {
  threadId: string;
  subject: string;
  companyName: string;
  companyCrmPath: string;
  propertyId: VwPropertyId;
  detailStatus: DetailThreadStatus;
  starred: boolean;
  assignedTo: { name: string; initials: string };
  assignees: string[];
  messages: MockThreadMessage[];
  sidebar: MockThreadSidebar;
};

export const MOCK_THREAD_DETAILS: Record<string, MockThreadDetail> = {
  t1: {
    threadId: "t1",
    subject: "Laajennus Erottaja2-tiloihin — kapasiteetti ja aikataulu",
    companyName: "Nordic Design Studio Oy",
    companyCrmPath: "/crm/contacts/lead_c1",
    propertyId: "erottaja2",
    detailStatus: "needs_reply",
    starred: false,
    assignedTo: { name: "Mariia", initials: "M" },
    assignees: ["Khuong", "Mariia", "Inka"],
    messages: [
      {
        id: "m1",
        at: "2026-03-28T09:20:00+03:00",
        direction: "in",
        fromName: "Jussi Virtanen",
        fromEmail: "jussi.virtanen@nordicdesign.fi",
        toLine: "mariia@villageworks.com",
        bodyHtml:
          "<p>Hei Mariia,</p><p>Kiitos viime viikon esittelystä Erottaja2:ssa. Tiimimme kasvaa ja tarvitsemme noin 25–30 m² lisätilaa saman kiinteistön sisältä tai välittömästä läheisyydestä.</p><p>Voitteko kertoa, onko 4. kerroksessa vielä vapautumassa tiloja Q2–Q3 aikana?</p><p>Terveisin,<br/>Jussi</p>",
      },
      {
        id: "m2",
        at: "2026-03-28T14:05:00+03:00",
        direction: "out",
        fromName: "Mariia Korhonen",
        fromEmail: "mariia@villageworks.com",
        toLine: "jussi.virtanen@nordicdesign.fi",
        bodyHtml:
          "<p>Hei Jussi,</p><p>Kiitos viestistä — 4. kerroksessa vapautuu yksi 32 m² huone toukokuun puolivälistä. Voin lähettää pohjakuvan ja vuokrausehdotuksen huomenna.</p><p>Sopiiko lyhyt puhelu torstaina klo 10?</p><p>Ystävällisin terveisin,<br/>Mariia<br/>VillageWorks</p>",
        tracking: { openCount: 4, lastOpenedLabel: "2 hours ago" },
      },
      {
        id: "m3",
        at: "2026-04-01T10:30:00+03:00",
        direction: "in",
        fromName: "Jussi Virtanen",
        fromEmail: "jussi.virtanen@nordicdesign.fi",
        toLine: "mariia@villageworks.com",
        bodyHtml:
          "<p>Hei Mariia,</p><p>Torstai klo 10 sopii. Samalla kysyisin: voimmeko yhdistää nykyisen 18 m² huoneen ja uuden tilan yhdeksi laskutusyksiköksi?</p><p>Lisäksi tarvitsemme yhden kiinteän työpisteen lisää neuvottelutilaan viikoittaisia asiakaspalavereita varten.</p><p>Jussi</p>",
      },
      {
        id: "m4",
        at: "2026-04-02T09:15:00+03:00",
        direction: "out",
        fromName: "Mariia Korhonen",
        fromEmail: "mariia@villageworks.com",
        toLine: "jussi.virtanen@nordicdesign.fi",
        bodyHtml:
          "<p>Hei Jussi,</p><p>Kiitos tarkennetuista kysymyksistä. Alla yhteenveto ja liitteet.</p><p><strong>Yhdistetty laskutus:</strong> Kyllä — voimme niputtaa sopimukset yhdeksi vuokrasopimukseksi, jolloin yhteinen neliömäärä on 50 m² ja yksi Y-tunnus laskutuksessa.</p><p><strong>Neuvottelutila:</strong> Ehdotan 6 hlön huonetta 4B12:n viereen; kalustus voidaan täydentää yhdellä kiinteällä työpisteellä (sähköistys OK).</p><p><strong>Aikataulu:</strong> Muuttoikkuna 15.5.–31.5., avainten luovutus viimeistään 12.5.</p><p>Liitteet: pohjakuva PDF, ehdotus vuokrista ja palvelumaksuista.</p><p>Soitellaan torstaina — lähetän kalenterikutsun.</p><p>Mariia</p>",
        longBody: true,
        attachments: [
          { name: "Erottaja2_4krs_4B12_pohja.pdf", sizeLabel: "1.2 MB" },
          { name: "VW_tilatarjous_NordicDesign_Q2.xlsx", sizeLabel: "84 KB" },
        ],
        tracking: { openCount: 3, lastOpenedLabel: "2 hours ago" },
      },
    ],
    sidebar: {
      contactEmail: "jussi.virtanen@nordicdesign.fi",
      phone: "+358 40 123 4567",
      activities: [
        { title: "Offer sent — Erottaja2 expansion (draft v2)", at: "2026-03-27" },
        { title: "Viewing completed — 4th floor", at: "2026-03-21" },
        { title: "Lead created from inbound form", at: "2026-03-15" },
      ],
      otherThreads: [
        { id: "t_x1", subject: "Parkkipaikat vieraille", preview: "Voimmeko varata 2 paikkaa torstaille…" },
        { id: "t_x2", subject: "Re: Vuokrasopimuksen liite", preview: "Allekirjoitetut dokumentit liitteenä." },
      ],
    },
  },
};

function threadStatusToDetail(s: ThreadStatus): DetailThreadStatus {
  if (s === "needs_reply") return "needs_reply";
  if (s === "awaiting") return "awaiting";
  return "closed";
}

function buildSyntheticThreadDetail(thread: MockThread): MockThreadDetail {
  return {
    threadId: thread.id,
    subject: thread.subject,
    companyName: `${thread.senderName} (contact)`,
    companyCrmPath: "/crm/contacts",
    propertyId: thread.propertyId,
    detailStatus: threadStatusToDetail(thread.status),
    starred: false,
    assignedTo: { name: "Khuong", initials: "K" },
    assignees: ["Khuong", "Mariia", "Inka"],
    messages: [
      {
        id: `${thread.id}_m1`,
        at: thread.updatedAt,
        direction: "in",
        fromName: thread.senderName,
        fromEmail: "contact@example.fi",
        toLine: "sales@villageworks.com",
        bodyHtml: `<p>${thread.preview}</p><p><em>(Mock thread — full history will load from Gmail.)</em></p>`,
      },
    ],
    sidebar: {
      contactEmail: "contact@example.fi",
      phone: "—",
      activities: [{ title: "No CRM activities (mock)", at: "—" }],
      otherThreads: [],
    },
  };
}

export function getMockThreadDetail(thread: MockThread): MockThreadDetail {
  const full = MOCK_THREAD_DETAILS[thread.id];
  if (full) {
    return {
      ...full,
      detailStatus: threadStatusToDetail(thread.status),
    };
  }
  return buildSyntheticThreadDetail(thread);
}

export type TimelineDirection = "in" | "out";

export type MockTimelineEntry = {
  id: string;
  at: string;
  direction: TimelineDirection;
  from: string;
  to: string;
  subject: string;
  preview: string;
  staffName: string;
  opened: boolean;
  propertyId: VwPropertyId;
};

export const MOCK_COMPANY_OPTIONS = [
  { id: "c1", name: "Nordic Design Studio Oy", domain: "nordicdesign.fi" },
  { id: "c2", name: "Helsinki Tech Partners Oy", domain: "htp.fi" },
  { id: "c3", name: "Baltic Logistics Oy", domain: "balticlog.fi" },
];

export const MOCK_TIMELINE_BY_COMPANY: Record<string, MockTimelineEntry[]> = {
  c1: [
    {
      id: "e1",
      at: "2026-04-02T10:00:00+03:00",
      direction: "in",
      from: "jussi.virtanen@nordicdesign.fi",
      to: "sales@villageworks.com",
      subject: "Uusi toimitilakysely",
      preview: "Etsimme 8 hlön toimistotilaa keskittymäalueelta…",
      staffName: "Khuong",
      opened: true,
      propertyId: "erottaja2",
    },
    {
      id: "e2",
      at: "2026-04-01T15:30:00+03:00",
      direction: "out",
      from: "khuong@villageworks.com",
      to: "jussi.virtanen@nordicdesign.fi",
      subject: "Re: Uusi toimitilakysely",
      preview: "Hei Jussi, kiitos viestistä — liitän esitteet ja kalenterilinkin.",
      staffName: "Khuong",
      opened: true,
      propertyId: "erottaja2",
    },
    {
      id: "e3",
      at: "2026-03-28T09:00:00+03:00",
      direction: "in",
      from: "jussi.virtanen@nordicdesign.fi",
      to: "sales@villageworks.com",
      subject: "Seurantakysely",
      preview: "Onko teillä vielä tilaa Freda-talossa?",
      staffName: "Mariia",
      opened: false,
      propertyId: "freda",
    },
  ],
  c2: [
    {
      id: "e4",
      at: "2026-03-30T12:00:00+03:00",
      direction: "out",
      from: "inka@villageworks.com",
      to: "contact@htp.fi",
      subject: "Tarjous kokoustiloista",
      preview: "Liitteenä hinta P5-talon neuvottelutiloista…",
      staffName: "Inka",
      opened: true,
      propertyId: "p5",
    },
  ],
  c3: [],
};

export type MockPropertyRow = {
  propertyId: VwPropertyId;
  sent: number;
  received: number;
  needsReply: number;
  avgResponseHours: number;
  openRatePct: number;
  staleThreads: number;
  alert: boolean;
};

export const MOCK_PROPERTY_TABLE: MockPropertyRow[] = [
  { propertyId: "erottaja2", sent: 42, received: 38, needsReply: 3, avgResponseHours: 2.4, openRatePct: 68, staleThreads: 1, alert: true },
  { propertyId: "freda", sent: 31, received: 29, needsReply: 2, avgResponseHours: 3.1, openRatePct: 61, staleThreads: 0, alert: false },
  { propertyId: "p5", sent: 28, received: 25, needsReply: 1, avgResponseHours: 1.8, openRatePct: 72, staleThreads: 0, alert: false },
  { propertyId: "sahkis", sent: 19, received: 22, needsReply: 4, avgResponseHours: 4.2, openRatePct: 55, staleThreads: 2, alert: true },
  { propertyId: "skylounge", sent: 24, received: 21, needsReply: 1, avgResponseHours: 2.9, openRatePct: 64, staleThreads: 0, alert: false },
];

export type MockTeamMember = {
  name: string;
  emailsHandled: number;
  avgReplyHours: number;
  pending: number;
};

export const MOCK_TEAM: MockTeamMember[] = [
  { name: "Khuong", emailsHandled: 156, avgReplyHours: 2.1, pending: 4 },
  { name: "Mariia", emailsHandled: 142, avgReplyHours: 2.8, pending: 3 },
  { name: "Inka", emailsHandled: 128, avgReplyHours: 3.0, pending: 2 },
];

/** Sample contacts for compose autocomplete (mirrors customer_companies-style labels). */
export const MOCK_CONTACTS = [
  { id: "co1", name: "Nordic Design Studio Oy", email: "hello@nordicdesign.fi" },
  { id: "co2", name: "Helsinki Tech Partners Oy", email: "contact@htp.fi" },
  { id: "co3", name: "Baltic Logistics Oy", email: "info@balticlog.fi" },
  { id: "co4", name: "Kaisa Virtanen", email: "kaisa.virtanen@example.fi" },
];

export const MOCK_EMAIL_TEMPLATES = [
  { id: "intro", label: "Introduction — new lead" },
  { id: "followup", label: "Follow-up after viewing" },
  { id: "pricing", label: "Pricing & availability" },
  { id: "blank", label: "Blank" },
];

/** Mock unread count for sidebar badge (until Gmail sync). */
export const MOCK_EMAIL_UNREAD_COUNT = 7;
