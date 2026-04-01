import { useState, useEffect, useCallback, useRef, useMemo, createContext, useContext, useReducer } from "react";

// ═══════════════════════════════════════════════════════════════════════════════
// CATALYST OS — COMPLETE MARKET-READY APPLICATION
// Modules: Forge · Launchpad · Radar · Studio · Cortex
// Architecture: Event-driven state + live backend API layer
// ═══════════════════════════════════════════════════════════════════════════════

// ─── SHARED FRONTEND HELPERS ──────────────────────────────────────────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmt = n => n >= 1e6 ? (n/1e6).toFixed(1)+"M" : n >= 1e3 ? (n/1e3).toFixed(1)+"k" : String(n);
const pct = n => Math.round(n * 100) + "%";
const dayName = d => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d];
const cn = (...c) => c.filter(Boolean).join(" ");

// Platform registry — single source of truth
const PLATFORMS = {
  tiktok:    { name:"TikTok",          icon:"♪",  color:"#fe2c55", aspect:"9:16", maxCap:150,  pacing:"fast",   rateLimit:100, hooks:["curiosity","shock","relatable"] },
  instagram: { name:"Instagram Reels", icon:"◎",  color:"#e1306c", aspect:"9:16", maxCap:2200, pacing:"medium", rateLimit:80,  hooks:["aesthetic","story","question"] },
  linkedin:  { name:"LinkedIn",        icon:"in", color:"#0a66c2", aspect:"16:9", maxCap:3000, pacing:"slow",   rateLimit:60,  hooks:["insight","data","contrarian"] },
  x:         { name:"X (Twitter)",     icon:"𝕏",  color:"#1d9bf0", aspect:"16:9", maxCap:280,  pacing:"fast",   rateLimit:120, hooks:["hot-take","thread","question"] },
  youtube:   { name:"YouTube Shorts",  icon:"▶",  color:"#ff0000", aspect:"9:16", maxCap:5000, pacing:"medium", rateLimit:50,  hooks:["how-to","reveal","challenge"] },
};

function safeJsonParse(input, fallback) {
  try { return JSON.parse(input); } catch { return fallback; }
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function mapCampaign(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at ? row.created_at.split("T")[0] : (row.createdAt || new Date().toISOString().split("T")[0]),
    platforms: Array.isArray(row.platforms) ? row.platforms : safeJsonParse(row.platforms || "[]", []),
    variants: row.variants || [],
    engagement: row.engagement || (row.total_views ? {
      views: row.total_views || 0,
      likes: row.total_likes || 0,
      comments: row.total_comments || 0,
      shares: row.total_shares || 0,
      saves: row.total_saves || 0,
    } : null),
    scheduledFor: row.scheduled_for || row.scheduledFor || null,
  };
}

function mapSignal(row) {
  return {
    id: row.id,
    type: row.type,
    count: row.count || 0,
    topic: row.topic || "",
    platforms: Array.isArray(row.platforms) ? row.platforms : safeJsonParse(row.platforms || "[]", []),
    sentiment: typeof row.sentiment === "number" ? row.sentiment : 0.5,
    actionable: row.actionable === 1 || row.actionable === true,
    ts: row.created_at || row.ts || new Date().toISOString(),
    campaignId: row.campaign_id || row.campaignId || null,
  };
}

function mapBrief(row) {
  return {
    id: row.id,
    signalId: row.signal_id || row.signalId || null,
    title: row.title || "",
    script: row.script || "",
    format: row.format || "",
    platform: row.platform || "linkedin",
    status: row.status || "pending",
    priority: row.priority || "medium",
  };
}

function mapVoiceDna(vd) {
  return {
    tone: vd?.tone || "Professional",
    emojiUsage: vd?.emoji_usage || vd?.emojiUsage || "minimal",
    hashtagStyle: vd?.hashtag_style || vd?.hashtagStyle || "niche",
    includeWords: vd?.include_words || vd?.includeWords || "",
    excludeWords: vd?.exclude_words || vd?.excludeWords || "",
    samples: Array.isArray(vd?.samples) ? vd.samples : safeJsonParse(vd?.samples || "[]", []),
    trained: vd?.trained === 1 || vd?.trained === true,
  };
}

function mapApiHealth(rows) {
  if (!Array.isArray(rows)) return rows || {};
  return rows.reduce((acc, row) => {
    acc[row.platform] = {
      connected: row.connected === 1 || row.connected === true,
      callsUsed: row.calls_used ?? row.callsUsed ?? 0,
      callsMax: row.calls_max ?? row.callsMax ?? 100,
      lastSync: row.last_sync ?? row.lastSync ?? null,
      status: row.status || "healthy",
    };
    return acc;
  }, {});
}

class ApiClient {
  constructor() {
    this.listeners = [];
    this.token = typeof window !== "undefined" ? localStorage.getItem("catalyst_token") : null;
    const envBase = (import.meta?.env?.VITE_CATALYST_API_BASE || "").trim();
    this.baseUrl = envBase.replace(/\/$/, "");
  }

  on(fn) {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((item) => item !== fn); };
  }

  emit(event, data) {
    this.listeners.forEach((fn) => fn(event, data));
  }

  isAuthenticated() {
    return Boolean(this.token);
  }

  setToken(token) {
    this.token = token || null;
    if (typeof window !== "undefined") {
      if (this.token) localStorage.setItem("catalyst_token", this.token);
      else localStorage.removeItem("catalyst_token");
    }
  }

  logout() {
    this.setToken(null);
  }

  requireAuth() {
    if (!this.token) throw new Error("Please log in to continue.");
  }

  async request(path, opts = {}) {
    if (!this.baseUrl && typeof window !== "undefined") {
      const runtimeBase = (window.CATALYST_API_BASE || localStorage.getItem("catalyst_api_base") || "").trim();
      this.baseUrl = runtimeBase.replace(/\/$/, "");
    }
    if (!this.baseUrl) {
      throw new Error("Missing API base URL. Set VITE_CATALYST_API_BASE in frontend environment.");
    }
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(`${this.baseUrl}${path}`, { ...opts, headers });
    const payload = await res.json().catch(() => ({}));
    if (res.status === 401) {
      this.logout();
      throw new Error("Session expired. Please log in again.");
    }
    if (!res.ok || payload?.ok === false) {
      throw new Error(payload?.error?.message || `HTTP ${res.status}`);
    }
    return payload?.data ?? payload;
  }

  async register({ name, email, password }) {
    const value = await this.request("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    });
    this.setToken(value.token);
    return value.user;
  }

  async login({ email, password }) {
    const value = await this.request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    this.setToken(value.token);
    return value.user;
  }

  async getUser() {
    this.requireAuth();
    const me = await this.request("/api/v1/auth/me");
    const vd = await this.request("/api/v1/voice-dna");
    return {
      ...me.user,
      voiceDna: mapVoiceDna(vd),
      avatar: me.user?.name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() || "DU",
    };
  }

  async updateVoiceDna(cfg) {
    this.requireAuth();
    const vd = await this.request("/api/v1/voice-dna", { method: "PUT", body: JSON.stringify(cfg) });
    return mapVoiceDna(vd);
  }

  async getCampaigns() {
    this.requireAuth();
    const rows = await this.request("/api/v1/campaigns");
    return toArray(rows).map(mapCampaign);
  }

  async createCampaign(data) {
    this.requireAuth();
    const payload = {
      name: data.name,
      platforms: data.platforms,
      masterContent: {
        title: data.masterContent?.title || data.name,
        summary: data.masterContent?.summary || "",
        contentType: data.masterContent?.contentType || "Talking Head",
      },
    };
    const created = await this.request("/api/v1/campaigns", { method: "POST", body: JSON.stringify(payload) });
    return mapCampaign(created.campaign || created);
  }

  async generateVariants(masterContent, platforms) {
    this.requireAuth();
    this.emit("forge:analyzing", { step: 1 });
    this.emit("forge:generating", { step: 2 });
    const hookMap = { linkedin: "B", x: "C", tiktok: "A", instagram: "A", youtube: "A" };
    return platforms.map((platform) => ({
      id: uid(),
      platform,
      caption: `${masterContent?.title || "New Campaign"}\n\n${masterContent?.summary || ""}`.trim(),
      edits: ["Auto-generated draft from master content"],
      hookStyle: hookMap[platform] || "A",
      aspect: PLATFORMS[platform]?.aspect || "16:9",
      pacing: PLATFORMS[platform]?.pacing || "medium",
      estimatedReach: 0,
      status: "ready",
      approved: false,
    }));
  }

  async getSignals() {
    this.requireAuth();
    const rows = await this.request("/api/v1/signals");
    return toArray(rows).map(mapSignal);
  }

  async dismissSignal(id) {
    this.requireAuth();
    await this.request(`/api/v1/signals/${id}`, { method: "PATCH", body: JSON.stringify({ dismissed: true }) });
    return true;
  }

  async getBriefs() {
    this.requireAuth();
    const rows = await this.request("/api/v1/briefs");
    return toArray(rows).map(mapBrief);
  }

  async updateBrief(id, patch) {
    this.requireAuth();
    const row = await this.request(`/api/v1/briefs/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    return mapBrief(row);
  }

  async getCortex() {
    this.requireAuth();
    return await this.request("/api/v1/cortex");
  }

  async getApiHealth() {
    this.requireAuth();
    const rows = await this.request("/api/v1/health/platforms");
    return mapApiHealth(rows);
  }

  async getDashboardStats() {
    this.requireAuth();
    return await this.request("/api/v1/dashboard");
  }

  async getCalendarBalance() {
    this.requireAuth();
    return await this.request("/api/v1/cortex/calendar-balance");
  }

  async getTrendingAudio(query) {
    this.requireAuth();
    const qs = new URLSearchParams(query).toString();
    return await this.request(`/api/v1/forge/trending-audio?${qs}`);
  }

  async testHooks(payload) {
    this.requireAuth();
    return await this.request("/api/v1/forge/hook-test", { method: "POST", body: JSON.stringify(payload) });
  }

  async pauseAllScheduled() {
    this.requireAuth();
    await this.request("/api/v1/crisis/trigger", { method: "POST", body: JSON.stringify({}) });
    return await this.getCampaigns();
  }

  async resumeAllPaused() {
    this.requireAuth();
    await this.request("/api/v1/crisis/resolve", { method: "POST", body: JSON.stringify({}) });
    return await this.getCampaigns();
  }
}

const api = new ApiClient();

// ─── APP STATE MANAGEMENT ─────────────────────────────────────────────────────
const AppContext = createContext(null);

const initialState = {
  view: "dashboard",
  user: null,
  campaigns: [],
  signals: [],
  briefs: [],
  cortex: null,
  apiHealth: {},
  calendarBalance: null,
  stats: null,
  forgeState: { step:0, masterContent:null, variants:[], processing:false },
  crisisMode: false,
  notifications: [],
  loading: true,
  studioTeleprompter: null,
};

function reducer(state, action) {
  switch(action.type) {
    case "SET_VIEW":          return { ...state, view: action.payload };
    case "SET_USER":          return { ...state, user: action.payload };
    case "SET_CAMPAIGNS":     return { ...state, campaigns: action.payload };
    case "SET_SIGNALS":       return { ...state, signals: action.payload };
    case "SET_BRIEFS":        return { ...state, briefs: action.payload };
    case "SET_CORTEX":        return { ...state, cortex: action.payload };
    case "SET_API_HEALTH":    return { ...state, apiHealth: action.payload };
    case "SET_CALENDAR_BALANCE": return { ...state, calendarBalance: action.payload };
    case "SET_STATS":         return { ...state, stats: action.payload };
    case "SET_FORGE":         return { ...state, forgeState: { ...state.forgeState, ...action.payload } };
    case "SET_CRISIS":        return { ...state, crisisMode: action.payload };
    case "SET_LOADING":       return { ...state, loading: action.payload };
    case "SET_TELEPROMPTER":  return { ...state, studioTeleprompter: action.payload };
    case "ADD_NOTIFICATION": {
      const n = { id:uid(), ...action.payload, ts:Date.now() };
      return { ...state, notifications: [...state.notifications, n] };
    }
    case "REMOVE_NOTIFICATION": return { ...state, notifications: state.notifications.filter(n => n.id !== action.payload) };
    default: return state;
  }
}

// ─── ICONS ────────────────────────────────────────────────────────────────────
const I = {
  Upload:()=><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  Check:()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>,
  Play:()=><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>,
  Pause:()=><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>,
  Calendar:()=><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  Zap:()=><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"/></svg>,
  Shield:()=><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  Alert:()=><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  Bar:()=><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  Globe:()=><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>,
  Mic:()=><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>,
  Brain:()=><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9.5 2A5.5 5.5 0 005 7.5c0 .88.21 1.71.58 2.45A5.5 5.5 0 002 15a5.5 5.5 0 005.21 5.49 3.5 3.5 0 005.29.01 3.5 3.5 0 005.29-.01A5.5 5.5 0 0022 15a5.5 5.5 0 00-3.58-5.05c.37-.74.58-1.57.58-2.45A5.5 5.5 0 0014.5 2a5.49 5.49 0 00-2.5.6A5.49 5.49 0 009.5 2z"/></svg>,
  Film:()=><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/></svg>,
  Edit:()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  X:()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Right:()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>,
  Down:()=><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>,
  Trend:()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  Clock:()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  Target:()=><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  Lightbulb:()=><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0018 8 6 6 0 006 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 018.91 14"/></svg>,
};

// ─── NOTIFICATION SYSTEM ──────────────────────────────────────────────────────
function useNotify() {
  const { dispatch } = useContext(AppContext);
  return useCallback((msg, type="info") => {
    const id = uid();
    dispatch({ type:"ADD_NOTIFICATION", payload:{ id, msg, type } });
    setTimeout(() => dispatch({ type:"REMOVE_NOTIFICATION", payload:id }), 4500);
  }, [dispatch]);
}

function Toasts({ items }) {
  return (
    <div style={{ position:"fixed", top:16, right:16, zIndex:9999, display:"flex", flexDirection:"column", gap:8, pointerEvents:"none" }}>
      {items.map(n => (
        <div key={n.id} className="anim-slide" style={{
          padding:"10px 16px", borderRadius:8, fontSize:13, fontWeight:500, maxWidth:360, pointerEvents:"auto",
          background: n.type==="error"?"#450a0a":n.type==="success"?"#052e16":"#1e1b4b",
          border:`1px solid ${n.type==="error"?"#7f1d1d":n.type==="success"?"#14532d":"#312e81"}`,
          color: n.type==="error"?"#fca5a5":n.type==="success"?"#86efac":"#c4b5fd",
        }}>{n.msg}</div>
      ))}
    </div>
  );
}

// ─── SHARED UI COMPONENTS ─────────────────────────────────────────────────────
const Badge = ({ children, color="#6366f1", bg }) => (
  <span style={{ padding:"2px 8px", borderRadius:4, fontSize:11, fontWeight:600, background:bg||(color+"18"), color, whiteSpace:"nowrap" }}>{children}</span>
);

const StatCard = ({ label, value, sub, color="#6366f1", icon }) => (
  <div style={{ padding:20, borderRadius:10, background:"#111116", border:"1px solid #1c1c24", position:"relative", overflow:"hidden" }}>
    <div style={{ position:"absolute", top:0, left:0, width:3, height:"100%", background:color, borderRadius:"0 2px 2px 0" }} />
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
      <div>
        <p style={{ fontSize:12, color:"#71717a", marginBottom:8, fontWeight:500 }}>{label}</p>
        <p style={{ fontSize:26, fontWeight:700, letterSpacing:"-0.03em", lineHeight:1 }}>{value}</p>
        {sub && <p style={{ fontSize:11, color:"#52525b", marginTop:6 }}>{sub}</p>}
      </div>
      {icon && <div style={{ color:"#3f3f46" }}>{icon}</div>}
    </div>
  </div>
);

const Btn = ({ children, variant="primary", disabled, onClick, style:s, ...props }) => {
  const base = { padding:"7px 16px", borderRadius:7, border:"none", fontSize:13, fontWeight:600, display:"inline-flex", alignItems:"center", gap:6, cursor:disabled?"not-allowed":"pointer", transition:"all 0.15s", opacity:disabled?0.5:1, ...s };
  const styles = {
    primary:   { ...base, background:"linear-gradient(135deg,#6366f1,#8b5cf6)", color:"#fff" },
    secondary: { ...base, background:"transparent", border:"1px solid #27272a", color:"#a1a1aa" },
    danger:    { ...base, background:"#7f1d1d", border:"1px solid #991b1b", color:"#fca5a5" },
    success:   { ...base, background:"#14532d", border:"1px solid #166534", color:"#86efac" },
    ghost:     { ...base, background:"transparent", color:"#71717a" },
  };
  return <button onClick={disabled?undefined:onClick} style={styles[variant]||styles.primary} {...props}>{children}</button>;
};

const PlatformPill = ({ id, small }) => {
  const p = PLATFORMS[id]; if(!p) return null;
  const sz = small ? 18 : 24;
  return (
    <span title={p.name} style={{ width:sz, height:sz, borderRadius:4, background:p.color+"20", color:p.color, display:"inline-flex", alignItems:"center", justifyContent:"center", fontSize:small?8:10, fontWeight:700 }}>
      {p.icon}
    </span>
  );
};

const Section = ({ title, subtitle, right, children, style:s }) => (
  <div style={{ background:"#111116", borderRadius:10, border:"1px solid #1c1c24", overflow:"hidden", ...s }}>
    {(title || right) && (
      <div style={{ padding:"14px 20px", borderBottom:"1px solid #1c1c24", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <h2 style={{ fontSize:15, fontWeight:600 }}>{title}</h2>
          {subtitle && <p style={{ fontSize:12, color:"#71717a", marginTop:2 }}>{subtitle}</p>}
        </div>
        {right}
      </div>
    )}
    {children}
  </div>
);

const EmptyState = ({ icon, title, sub }) => (
  <div style={{ padding:48, textAlign:"center" }}>
    <div style={{ width:44, height:44, margin:"0 auto 14px", borderRadius:10, background:"#1c1c24", display:"flex", alignItems:"center", justifyContent:"center", color:"#52525b" }}>{icon}</div>
    <p style={{ fontSize:14, fontWeight:500, marginBottom:4 }}>{title}</p>
    <p style={{ fontSize:12, color:"#52525b" }}>{sub}</p>
  </div>
);

// ─── PAGE: DASHBOARD ──────────────────────────────────────────────────────────
function Dashboard() {
  const { state, dispatch } = useContext(AppContext);
  const { stats, campaigns, cortex } = state;
  if (!stats) return null;

  return (
    <div className="anim-fade">
      <div style={{ marginBottom:28 }}>
        <h1 style={{ fontSize:24, fontWeight:700, letterSpacing:"-0.03em", marginBottom:4 }}>Command Center</h1>
        <p style={{ color:"#71717a", fontSize:14 }}>{stats.liveCampaigns} live campaigns · {stats.signalCount} actionable signals waiting</p>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:24 }}>
        <StatCard label="Total Reach" value={fmt(stats.totalReach)} sub="Across live campaigns" color="#6366f1" icon={<I.Globe/>} />
        <StatCard label="Engagement Rate" value={stats.engagementRate+"%"} sub="Likes + Comments + Shares / Views" color="#22c55e" icon={<I.Trend/>} />
        <StatCard label="Active Campaigns" value={stats.activeCampaigns} sub={`${stats.liveCampaigns} live`} color="#8b5cf6" icon={<I.Calendar/>} />
        <StatCard label="Content Queue" value={stats.pendingBriefs} sub="Briefs pending review" color="#eab308" icon={<I.Film/>} />
      </div>

      {/* Cortex Weekly Actions */}
      {cortex?.weeklyDigest && (
        <Section title="Cortex — Weekly Intelligence" subtitle="AI-generated recommendations based on your audience data" right={<Badge color="#c084fc" bg="#2e1065">AI</Badge>} style={{ marginBottom:20 }}>
          <div style={{ padding:20 }}>
            {cortex.weeklyDigest.recommendedActions.map((a,i) => (
              <div key={i} style={{ display:"flex", gap:12, alignItems:"flex-start", padding:"10px 0", borderBottom: i < cortex.weeklyDigest.recommendedActions.length-1 ? "1px solid #1c1c24":"none" }}>
                <div style={{ minWidth:24, height:24, borderRadius:6, background:"#1e1b4b", color:"#a5b4fc", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700 }}>{i+1}</div>
                <p style={{ fontSize:13, color:"#d4d4d8", lineHeight:1.5 }}>{a}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Campaign List */}
      <Section title="Campaigns" right={<Btn onClick={() => dispatch({type:"SET_VIEW",payload:"forge"})}><I.Zap/> New Campaign</Btn>}>
        {campaigns.map(c => (
          <div key={c.id} className="row-hover" style={{ padding:"12px 20px", borderBottom:"1px solid #1c1c24", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ display:"flex", alignItems:"center", gap:14 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background: c.status==="live"?"#22c55e":c.status==="scheduled"?"#eab308":c.status==="paused"?"#ef4444":"#52525b" }} className={c.status==="live"?"pulse":""} />
              <div>
                <p style={{ fontSize:14, fontWeight:500 }}>{c.name}</p>
                <p style={{ fontSize:11, color:"#71717a" }}>{c.createdAt} · <span style={{ textTransform:"capitalize" }}>{c.status}</span></p>
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <div style={{ display:"flex", gap:3 }}>{c.platforms.map(p => <PlatformPill key={p} id={p} small />)}</div>
              {c.engagement && <span style={{ fontSize:12, color:"#71717a" }}>{fmt(c.engagement.views)} views</span>}
              <I.Right/>
            </div>
          </div>
        ))}
      </Section>
    </div>
  );
}

// ─── PAGE: FORGE ──────────────────────────────────────────────────────────────
function Forge() {
  const { state, dispatch } = useContext(AppContext);
  const notify = useNotify();
  const { forgeState } = state;

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [contentType, setContentType] = useState("Talking Head");
  const [selected, setSelected] = useState(["tiktok","instagram","linkedin"]);
  const [file, setFile] = useState(null);
  const [niche, setNiche] = useState("b2b marketing");
  const [audioSuggestions, setAudioSuggestions] = useState([]);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [hookPlatform, setHookPlatform] = useState("linkedin");
  const [hookInputs, setHookInputs] = useState([
    "3 mistakes that quietly kill your pipeline this quarter",
    "What nobody tells you about scaling outbound in 2026",
    "",
  ]);
  const [hookResult, setHookResult] = useState(null);

  const toggle = p => setSelected(s => s.includes(p)?s.filter(x=>x!==p):[...s,p]);

  useEffect(() => {
    if (selected.length > 0) setHookPlatform(selected[0]);
  }, [selected]);

  const generate = async () => {
    if (!title.trim() || selected.length === 0) return;
    dispatch({ type:"SET_FORGE", payload:{ processing:true, step:1, masterContent:{ title, summary, contentType } } });
    try {
      const unsub = api.on((evt) => {
        if (evt === "forge:analyzing") dispatch({ type:"SET_FORGE", payload:{ step:1 } });
        if (evt === "forge:generating") dispatch({ type:"SET_FORGE", payload:{ step:2 } });
      });
      const variants = await api.generateVariants({ title, summary, contentType }, selected);
      unsub();
      dispatch({ type:"SET_FORGE", payload:{ step:3, variants, processing:false } });
      notify("All variants generated — ready for review.", "success");
    } catch(e) {
      dispatch({ type:"SET_FORGE", payload:{ processing:false, step:0 } });
      notify("Generation failed. Please retry.", "error");
    }
  };

  const approveOne = id => dispatch({ type:"SET_FORGE", payload:{ variants: forgeState.variants.map(v => v.id===id?{...v,approved:true}:v) } });
  const approveAll = () => { dispatch({ type:"SET_FORGE", payload:{ variants: forgeState.variants.map(v => ({...v,approved:true})) } }); notify("All approved!","success"); };

  const launch = async () => {
    const approved = forgeState.variants.filter(v => v.approved);
    if (approved.length === 0) { notify("Approve at least one variant.","error"); return; }
    await api.createCampaign({
      name: forgeState.masterContent.title,
      platforms: approved.map(v => v.platform),
      masterContent: forgeState.masterContent,
    });
    const camps = await api.getCampaigns();
    dispatch({ type:"SET_CAMPAIGNS", payload:camps });
    dispatch({ type:"SET_FORGE", payload:{ step:0, masterContent:null, variants:[], processing:false } });
    dispatch({ type:"SET_VIEW", payload:"launchpad" });
    notify("Campaign scheduled!", "success");
  };

  const loadTrendingAudio = async () => {
    const platform = selected.find((p) => ["tiktok", "instagram", "youtube"].includes(p));
    if (!platform) {
      notify("Trending audio is available for TikTok, Instagram, or YouTube.", "info");
      return;
    }
    setLoadingAudio(true);
    try {
      const suggestions = await api.getTrendingAudio({ platform, niche, limit: 3 });
      setAudioSuggestions(suggestions);
      notify("Trending audio suggestions loaded.", "success");
    } catch {
      notify("Could not load audio suggestions.", "error");
    } finally {
      setLoadingAudio(false);
    }
  };

  const runHookTest = async () => {
    const hooks = hookInputs.map((h) => h.trim()).filter(Boolean);
    if (hooks.length < 2) {
      notify("Add at least 2 hook options to run hook testing.", "error");
      return;
    }
    const result = await api.testHooks({ platform: hookPlatform, hooks, niche });
    setHookResult(result);
    notify(`Hook winner selected for ${PLATFORMS[hookPlatform]?.name}.`, "success");
  };

  // Upload / Config form
  if (forgeState.step === 0 && !forgeState.processing) {
    return (
      <div className="anim-fade">
        <div style={{ marginBottom:28 }}>
          <h1 style={{ fontSize:24, fontWeight:700, letterSpacing:"-0.03em", marginBottom:4 }}>Forge</h1>
          <p style={{ color:"#71717a", fontSize:14 }}>Upload one master asset. Get platform-native variants with your Voice DNA.</p>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
          {/* Left */}
          <Section title="Master Asset">
            <div style={{ padding:20 }}>
              <div onClick={()=>setFile({name:"master-video.mp4",size:"24.3 MB",dur:"10:24"})} className="row-hover" style={{
                border:"2px dashed #27272a", borderRadius:10, padding:36, textAlign:"center", marginBottom:18, cursor:"pointer", transition:"border-color 0.15s",
              }}>
                {file ? (
                  <><div style={{ width:40,height:40,margin:"0 auto 10px",borderRadius:8,background:"#14532d",display:"flex",alignItems:"center",justifyContent:"center",color:"#86efac" }}><I.Check/></div>
                  <p style={{ fontSize:14,fontWeight:500 }}>{file.name}</p><p style={{ fontSize:12,color:"#71717a" }}>{file.size} · {file.dur}</p></>
                ) : (
                  <><div style={{ width:40,height:40,margin:"0 auto 10px",borderRadius:8,background:"#1c1c24",display:"flex",alignItems:"center",justifyContent:"center",color:"#52525b" }}><I.Upload/></div>
                  <p style={{ fontSize:14,fontWeight:500 }}>Drop your master video or click to upload</p><p style={{ fontSize:12,color:"#52525b" }}>MP4, MOV, WebM up to 500MB</p></>
                )}
              </div>
              <label style={{ fontSize:12,fontWeight:500,color:"#a1a1aa",display:"block",marginBottom:6 }}>Title *</label>
              <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g., How We 10x'd Our Pipeline" style={{ width:"100%",padding:"8px 12px",borderRadius:6,border:"1px solid #27272a",background:"#0a0a0f",color:"#e4e4e7",fontSize:13,marginBottom:14 }} />
              <label style={{ fontSize:12,fontWeight:500,color:"#a1a1aa",display:"block",marginBottom:6 }}>Key Message</label>
              <textarea value={summary} onChange={e=>setSummary(e.target.value)} placeholder="Core takeaway..." rows={3} style={{ width:"100%",padding:"8px 12px",borderRadius:6,border:"1px solid #27272a",background:"#0a0a0f",color:"#e4e4e7",fontSize:13,resize:"vertical",marginBottom:14 }} />
              <label style={{ fontSize:12,fontWeight:500,color:"#a1a1aa",display:"block",marginBottom:6 }}>Content Type</label>
              <div style={{ display:"flex",flexWrap:"wrap",gap:6 }}>
                {["Talking Head","Screen Share","B-Roll Heavy","Interview","Tutorial"].map(t => (
                  <button key={t} onClick={()=>setContentType(t)} style={{ padding:"5px 12px",borderRadius:5,border:`1px solid ${contentType===t?"#6366f1":"#27272a"}`,background:contentType===t?"#1e1b4b":"transparent",color:contentType===t?"#a5b4fc":"#71717a",fontSize:12,fontWeight:500,cursor:"pointer" }}>{t}</button>
                ))}
              </div>
            </div>
          </Section>

          {/* Right */}
          <Section title="Target Platforms">
            <div style={{ padding:20 }}>
              <div style={{ display:"flex",flexDirection:"column",gap:8,marginBottom:20 }}>
                {Object.entries(PLATFORMS).map(([k,p]) => (
                  <button key={k} onClick={()=>toggle(k)} style={{
                    display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 14px",borderRadius:8,
                    border:`1px solid ${selected.includes(k)?p.color+"50":"#1c1c24"}`,background:selected.includes(k)?p.color+"08":"transparent",
                    textAlign:"left",cursor:"pointer",transition:"all 0.15s",
                  }}>
                    <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                      <PlatformPill id={k} />
                      <div><p style={{ fontSize:13,fontWeight:500,color:"#e4e4e7" }}>{p.name}</p><p style={{ fontSize:11,color:"#52525b" }}>{p.aspect} · {p.pacing} pacing · {p.maxCap} chars</p></div>
                    </div>
                    <div style={{ width:18,height:18,borderRadius:4,border:`2px solid ${selected.includes(k)?p.color:"#3f3f46"}`,background:selected.includes(k)?p.color:"transparent",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s" }}>
                      {selected.includes(k) && <I.Check/>}
                    </div>
                  </button>
                ))}
              </div>
              <label style={{ fontSize:12,fontWeight:500,color:"#a1a1aa",display:"block",marginBottom:6 }}>Niche (for trend recommendations)</label>
              <input
                value={niche}
                onChange={(e)=>setNiche(e.target.value)}
                placeholder="e.g., b2b saas, creator economy"
                style={{ width:"100%",padding:"8px 12px",borderRadius:6,border:"1px solid #27272a",background:"#0a0a0f",color:"#e4e4e7",fontSize:13,marginBottom:10 }}
              />
              <div style={{ display:"flex",gap:8,marginBottom:10 }}>
                <Btn variant="secondary" onClick={loadTrendingAudio} disabled={loadingAudio} style={{ flex:1 }}>
                  {loadingAudio ? "Loading..." : "Trending Audio Suggestions"}
                </Btn>
              </div>
              {audioSuggestions.length > 0 && (
                <div style={{ marginBottom:14,padding:10,borderRadius:8,background:"#0a0a0f",border:"1px solid #1c1c24" }}>
                  {audioSuggestions.map((a) => (
                    <div key={a.id} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid #1c1c24" }}>
                      <div>
                        <p style={{ fontSize:12,fontWeight:500 }}>{a.title}</p>
                        <p style={{ fontSize:10,color:"#71717a",textTransform:"capitalize" }}>{PLATFORMS[a.platform]?.name} · {a.genre}</p>
                      </div>
                      <Badge color="#86efac" bg="#14532d">{Math.round(a.relevance * 100)}% fit</Badge>
                    </div>
                  ))}
                </div>
              )}
              <Btn onClick={generate} disabled={!title.trim()||selected.length===0} style={{ width:"100%" }}><I.Zap/> Generate Campaign</Btn>
            </div>
          </Section>
        </div>
      </div>
    );
  }

  // Processing
  if (forgeState.processing) {
    return (
      <div className="anim-fade" style={{ textAlign:"center", padding:80 }}>
        <div style={{ width:52,height:52,margin:"0 auto 20px",borderRadius:12,background:"linear-gradient(135deg,#6366f1,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center" }}><I.Zap/></div>
        <p style={{ fontSize:17,fontWeight:600,marginBottom:10 }}>{forgeState.step===1?"Analyzing content structure & Voice DNA...":"Generating platform-native variants..."}</p>
        <div style={{ width:220,height:4,borderRadius:2,background:"#1c1c24",margin:"0 auto" }}>
          <div className="shimmer" style={{ width:forgeState.step===1?"45%":"85%",height:"100%",borderRadius:2,transition:"width 0.6s" }} />
        </div>
        <p style={{ fontSize:12,color:"#52525b",marginTop:12 }}>This typically takes 10-15 seconds</p>
      </div>
    );
  }

  // Review
  return (
    <div className="anim-fade">
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24 }}>
        <div>
          <h1 style={{ fontSize:24,fontWeight:700,letterSpacing:"-0.03em",marginBottom:4 }}>Review Variants</h1>
          <p style={{ color:"#71717a",fontSize:14 }}>{forgeState.variants.filter(v=>v.approved).length}/{forgeState.variants.length} approved · {forgeState.masterContent?.title}</p>
        </div>
        <div style={{ display:"flex",gap:8 }}>
          <Btn variant="secondary" onClick={()=>dispatch({type:"SET_FORGE",payload:{step:0,variants:[],processing:false,masterContent:null}})}>Start Over</Btn>
          <Btn variant="secondary" onClick={approveAll}>Approve All</Btn>
          <Btn onClick={launch}><I.Play/> Launch Campaign</Btn>
        </div>
      </div>
      <Section title="Pre-Publish Hook Testing" subtitle="Test 2-3 hook options before launch (no delete/re-upload needed)" style={{ marginBottom:16 }}>
        <div style={{ padding:16 }}>
          <div style={{ display:"grid",gridTemplateColumns:"180px 1fr",gap:10,marginBottom:10 }}>
            <select value={hookPlatform} onChange={(e)=>setHookPlatform(e.target.value)} style={{ width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid #27272a",background:"#0a0a0f",color:"#e4e4e7",fontSize:12 }}>
              {forgeState.variants.map((v) => (
                <option key={v.id} value={v.platform}>{PLATFORMS[v.platform]?.name}</option>
              ))}
            </select>
            <input value={niche} onChange={(e)=>setNiche(e.target.value)} placeholder="Niche context" style={{ width:"100%",padding:"8px 12px",borderRadius:6,border:"1px solid #27272a",background:"#0a0a0f",color:"#e4e4e7",fontSize:12 }} />
          </div>
          {hookInputs.map((h, i) => (
            <input
              key={i}
              value={h}
              onChange={(e)=>setHookInputs((prev)=>prev.map((it, idx)=>idx===i?e.target.value:it))}
              placeholder={`Hook option ${i+1}`}
              style={{ width:"100%",padding:"8px 12px",borderRadius:6,border:"1px solid #27272a",background:"#0a0a0f",color:"#e4e4e7",fontSize:12,marginBottom:8 }}
            />
          ))}
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",gap:10 }}>
            <Btn variant="secondary" onClick={runHookTest}>Run Hook Test</Btn>
            {hookResult?.winner && (
              <Badge color="#86efac" bg="#14532d">Winner: "{hookResult.winner.hook}" ({Math.round(hookResult.winner.confidence*100)}%)</Badge>
            )}
          </div>
        </div>
      </Section>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(360px,1fr))",gap:16 }}>
        {forgeState.variants.map(v => <VariantCard key={v.id} v={v} onApprove={()=>approveOne(v.id)} />)}
      </div>
    </div>
  );
}

function VariantCard({ v, onApprove }) {
  const [editing, setEditing] = useState(false);
  const [cap, setCap] = useState(v.caption);
  const p = PLATFORMS[v.platform];
  const hooks = { A:"Casual & Relatable", B:"Professional & Direct", C:"Bold & Controversial" };

  return (
    <div className="anim-fade" style={{ background:"#111116",borderRadius:10,border:`1px solid ${v.approved?"#166534":"#1c1c24"}`,overflow:"hidden",transition:"border-color 0.2s" }}>
      <div style={{ padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid #1c1c24" }}>
        <div style={{ display:"flex",alignItems:"center",gap:8 }}><PlatformPill id={v.platform}/><span style={{ fontSize:13,fontWeight:600 }}>{p.name}</span></div>
        <Badge color="#a5b4fc" bg="#1e1b4b">Hook {v.hookStyle}</Badge>
      </div>
      <div style={{ height:100,background:"#0a0a0f",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6,borderBottom:"1px solid #1c1c24" }}>
        <div style={{ width:32,height:32,borderRadius:"50%",background:p.color+"20",color:p.color,display:"flex",alignItems:"center",justifyContent:"center" }}><I.Play/></div>
        <span style={{ fontSize:11,color:"#52525b" }}>{v.aspect} · {v.pacing} pacing</span>
      </div>
      <div style={{ padding:"10px 16px",borderBottom:"1px solid #1c1c24" }}>
        <p style={{ fontSize:11,fontWeight:600,color:"#52525b",marginBottom:6 }}>AI EDITS</p>
        {v.edits.map((e,i) => <div key={i} style={{ display:"flex",alignItems:"center",gap:6,fontSize:12,color:"#a1a1aa",marginBottom:3 }}><div style={{ width:4,height:4,borderRadius:"50%",background:"#6366f1" }}/>{e}</div>)}
      </div>
      <div style={{ padding:"10px 16px",borderBottom:"1px solid #1c1c24" }}>
        <div style={{ display:"flex",justifyContent:"space-between",marginBottom:4 }}>
          <span style={{ fontSize:11,fontWeight:600,color:"#52525b" }}>CAPTION</span>
          <button onClick={()=>setEditing(!editing)} style={{ background:"none",border:"none",color:"#6366f1",fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",gap:3 }}><I.Edit/>{editing?"Done":"Edit"}</button>
        </div>
        {editing ? <textarea value={cap} onChange={e=>setCap(e.target.value)} rows={3} style={{ width:"100%",padding:8,borderRadius:6,border:"1px solid #27272a",background:"#0a0a0f",color:"#e4e4e7",fontSize:12,resize:"vertical" }} />
         : <p style={{ fontSize:12,color:"#a1a1aa",lineHeight:1.5,whiteSpace:"pre-wrap" }}>{cap}</p>}
        <p style={{ fontSize:10,color:"#3f3f46",marginTop:4 }}>{cap.length}/{p.maxCap}</p>
      </div>
      <div style={{ padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
        <span style={{ fontSize:11,color:"#52525b" }}>Est. reach: {fmt(v.estimatedReach)}</span>
        {v.approved ? <Badge color="#86efac" bg="#14532d">Approved</Badge> : <Btn variant="success" onClick={onApprove}><I.Check/> Approve</Btn>}
      </div>
    </div>
  );
}

// ─── PAGE: LAUNCHPAD ──────────────────────────────────────────────────────────
function Launchpad() {
  const { state } = useContext(AppContext);
  const { campaigns, apiHealth, calendarBalance } = state;

  const days = ["Mon 24","Tue 25","Wed 26","Thu 27","Fri 28","Sat 29","Sun 30"];
  const forDay = d => { const num = parseInt(d.split(" ")[1]); return campaigns.filter(c => parseInt(c.createdAt.split("-")[2]) === num); };

  return (
    <div className="anim-fade">
      <div style={{ marginBottom:28 }}>
        <h1 style={{ fontSize:24,fontWeight:700,letterSpacing:"-0.03em",marginBottom:4 }}>Launchpad</h1>
        <p style={{ color:"#71717a",fontSize:14 }}>Publishing calendar, scheduling, and API compliance monitoring.</p>
      </div>

      {calendarBalance && (
        <Section title="Calendar Balancer" subtitle="Intelligence checks for cadence and content fatigue" style={{ marginBottom:20 }}>
          <div style={{ padding:16 }}>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12 }}>
              {["promotional","educational","storytelling"].map((k) => (
                <div key={k} style={{ padding:10,borderRadius:8,background:"#0a0a0f",border:"1px solid #1c1c24" }}>
                  <p style={{ fontSize:11,color:"#71717a",textTransform:"capitalize" }}>{k}</p>
                  <p style={{ fontSize:14,fontWeight:600 }}>{calendarBalance.current[k]} <span style={{ color:"#52525b",fontSize:11 }}>/ ideal {calendarBalance.ideal[k]}</span></p>
                </div>
              ))}
            </div>
            {calendarBalance.actions.map((a, i) => (
              <div key={i} style={{ display:"flex",gap:10,alignItems:"flex-start",padding:"7px 0",borderBottom: i < calendarBalance.actions.length-1 ? "1px solid #1c1c24":"none" }}>
                <div style={{ minWidth:20,height:20,borderRadius:5,background:"#1e1b4b",color:"#a5b4fc",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700 }}>{i+1}</div>
                <p style={{ fontSize:12,color:"#d4d4d8" }}>{a}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="This Week" style={{ marginBottom:20 }}>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)" }}>
          {days.map((d,i) => {
            const dc = forDay(d); const today = d.includes("25");
            return (
              <div key={i} style={{ padding:"10px 8px",minHeight:110,borderRight:i<6?"1px solid #1c1c24":"",background:today?"#1e1b4b08":"" }}>
                <p style={{ fontSize:12,fontWeight:today?700:400,color:today?"#a5b4fc":"#71717a",marginBottom:8 }}>{d}</p>
                {dc.map(c => (
                  <div key={c.id} style={{ padding:"4px 6px",borderRadius:4,marginBottom:3,fontSize:10,fontWeight:500,
                    background:c.status==="live"?"#14532d":c.status==="paused"?"#450a0a":"#1e1b4b",
                    color:c.status==="live"?"#86efac":c.status==="paused"?"#fca5a5":"#a5b4fc",
                    whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>
                    {c.name}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </Section>

      {/* API Health */}
      <Section title="API Compliance & Health" subtitle="Real-time rate limit monitoring across all connected platforms">
        <div style={{ padding:16, display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12 }}>
          {Object.entries(apiHealth).map(([k,h]) => {
            const p = PLATFORMS[k]; if(!p) return null;
            const pctUsed = h.callsUsed / h.callsMax;
            return (
              <div key={k} style={{ padding:14,borderRadius:8,background:"#0a0a0f",border:"1px solid #1c1c24" }}>
                <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:10 }}>
                  <PlatformPill id={k} small /><span style={{ fontSize:12,fontWeight:500 }}>{p.name}</span>
                </div>
                <div style={{ display:"flex",alignItems:"center",gap:4,marginBottom:6 }}>
                  <div style={{ width:6,height:6,borderRadius:"50%",background:h.status==="healthy"?"#22c55e":"#ef4444" }} />
                  <span style={{ fontSize:11,color:"#71717a" }}>{h.connected?"Connected":"Disconnected"}</span>
                </div>
                <div style={{ height:4,borderRadius:2,background:"#1c1c24",marginBottom:4 }}>
                  <div style={{ height:"100%",borderRadius:2,width:pct(pctUsed),background:pctUsed>0.8?"#ef4444":pctUsed>0.5?"#eab308":"#22c55e",transition:"width 0.3s" }} />
                </div>
                <span style={{ fontSize:10,color:"#52525b" }}>{h.callsUsed}/{h.callsMax} daily calls</span>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

// ─── PAGE: RADAR ──────────────────────────────────────────────────────────────
function Radar() {
  const { state, dispatch } = useContext(AppContext);
  const notify = useNotify();
  const { signals, briefs, crisisMode, campaigns } = state;

  const triggerCrisis = async () => {
    dispatch({ type:"SET_CRISIS", payload:true });
    const c = await api.pauseAllScheduled();
    dispatch({ type:"SET_CAMPAIGNS", payload:c });
    notify("CRISIS MODE: All scheduled posts paused.", "error");
  };
  const resolveCrisis = async () => {
    dispatch({ type:"SET_CRISIS", payload:false });
    const c = await api.resumeAllPaused();
    dispatch({ type:"SET_CAMPAIGNS", payload:c });
    notify("Crisis resolved. Posts resumed.", "success");
  };
  const dismiss = async id => { await api.dismissSignal(id); dispatch({ type:"SET_SIGNALS", payload: await api.getSignals() }); };
  const approveBrief = async id => {
    await api.updateBrief(id, { status:"approved" });
    dispatch({ type:"SET_BRIEFS", payload: await api.getBriefs() });
    notify("Brief approved — added to Studio!", "success");
  };
  const sendToStudio = (brief) => {
    dispatch({ type:"SET_TELEPROMPTER", payload: brief });
    dispatch({ type:"SET_VIEW", payload:"studio" });
  };

  return (
    <div className="anim-fade">
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24 }}>
        <div>
          <h1 style={{ fontSize:24,fontWeight:700,letterSpacing:"-0.03em",marginBottom:4 }}>Radar</h1>
          <p style={{ color:"#71717a",fontSize:14 }}>Active listening. Signals become content. The loop closes here.</p>
        </div>
        {crisisMode
          ? <Btn variant="danger" onClick={resolveCrisis}><I.Alert/> Resolve Crisis — Resume</Btn>
          : <Btn variant="secondary" onClick={triggerCrisis}><I.Alert/> Simulate Crisis</Btn>}
      </div>

      {crisisMode && (
        <div className="anim-fade" style={{ padding:14,borderRadius:10,background:"#450a0a40",border:"1px solid #7f1d1d",marginBottom:20,display:"flex",alignItems:"center",gap:12 }}>
          <div className="pulse" style={{ width:10,height:10,borderRadius:"50%",background:"#ef4444" }} />
          <div><p style={{ fontSize:14,fontWeight:600,color:"#fca5a5" }}>Crisis Mode Active</p><p style={{ fontSize:12,color:"#fca5a580" }}>All scheduled posts paused. Review and resolve before resuming.</p></div>
        </div>
      )}

      <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:22 }}>
        <StatCard label="Avg Sentiment" value="72%" sub="Across all platforms" color="#22c55e" icon={<I.Globe/>} />
        <StatCard label="Active Signals" value={signals.length} sub={`${signals.filter(s=>s.actionable).length} actionable`} color="#6366f1" icon={<I.Target/>} />
        <StatCard label="Content Briefs" value={briefs.filter(b=>b.status==="pending").length} sub="Awaiting review" color="#eab308" icon={<I.Film/>} />
      </div>

      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:20 }}>
        {/* Signals */}
        <Section title="Audience Signals" subtitle="Auto-detected from comments, DMs, and mentions">
          {signals.length === 0 ? <EmptyState icon={<I.Globe/>} title="No signals" sub="Signals will appear as engagement flows in" /> : signals.map(s => (
            <div key={s.id} style={{ padding:"12px 20px",borderBottom:"1px solid #1c1c24" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6 }}>
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:5,flexWrap:"wrap" }}>
                    <Badge color={s.type==="question"?"#93c5fd":s.type==="objection"?"#fca5a5":s.type==="praise"?"#86efac":"#fde68a"} bg={s.type==="question"?"#1e3a5f":s.type==="objection"?"#450a0a":s.type==="praise"?"#052e16":"#422006"}>{s.type.replace("_"," ")}</Badge>
                    <span style={{ fontSize:11,color:"#52525b" }}>{s.count} mentions</span>
                    <Badge color={s.sentiment>0.6?"#22c55e":s.sentiment>0.3?"#eab308":"#ef4444"}>{s.sentiment>0.6?"Positive":s.sentiment>0.3?"Mixed":"Negative"} {pct(s.sentiment)}</Badge>
                  </div>
                  <p style={{ fontSize:13,fontWeight:500,marginBottom:4 }}>"{s.topic}"</p>
                  <div style={{ display:"flex",gap:4 }}>{s.platforms.map(p => <PlatformPill key={p} id={p} small />)}</div>
                </div>
                <Btn variant="ghost" onClick={()=>dismiss(s.id)} style={{ fontSize:11,padding:"3px 8px" }}><I.X/></Btn>
              </div>
            </div>
          ))}
        </Section>

        {/* Briefs */}
        <Section title="To-Record Queue" subtitle="AI-drafted briefs from audience signals">
          {briefs.length === 0 ? <EmptyState icon={<I.Film/>} title="No briefs yet" sub="Briefs are generated from actionable signals" /> : briefs.map(b => (
            <div key={b.id} style={{ padding:"12px 20px",borderBottom:"1px solid #1c1c24" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6 }}>
                <div>
                  <p style={{ fontSize:14,fontWeight:600,marginBottom:3 }}>{b.title}</p>
                  <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:6 }}>
                    <PlatformPill id={b.platform} small /><span style={{ fontSize:11,color:"#71717a" }}>{PLATFORMS[b.platform]?.name} · {b.format}</span>
                    {b.priority==="high" && <Badge color="#fca5a5" bg="#450a0a">High Priority</Badge>}
                  </div>
                </div>
                <div style={{ display:"flex",gap:4 }}>
                  {b.status === "pending" ? (
                    <>
                      <Btn variant="success" onClick={()=>approveBrief(b.id)} style={{ padding:"4px 10px",fontSize:11 }}><I.Check/> Approve</Btn>
                      <Btn variant="secondary" onClick={()=>sendToStudio(b)} style={{ padding:"4px 10px",fontSize:11 }}><I.Play/> Studio</Btn>
                    </>
                  ) : <Badge color="#86efac" bg="#14532d">Approved</Badge>}
                </div>
              </div>
              <div style={{ padding:10,borderRadius:6,background:"#0a0a0f",border:"1px solid #1c1c24",fontSize:12,color:"#a1a1aa",lineHeight:1.6,fontStyle:"italic" }}>"{b.script}"</div>
            </div>
          ))}
        </Section>
      </div>
    </div>
  );
}

// ─── PAGE: STUDIO ─────────────────────────────────────────────────────────────
function Studio() {
  const { state, dispatch } = useContext(AppContext);
  const notify = useNotify();
  const { briefs, studioTeleprompter } = state;
  const approvedBriefs = briefs.filter(b => b.status === "approved");
  const [activeBrief, setActiveBrief] = useState(studioTeleprompter || approvedBriefs[0] || null);
  const [teleMode, setTeleMode] = useState(false);
  const [recording, setRecording] = useState(false);
  const [editedScript, setEditedScript] = useState(activeBrief?.script || "");
  const scrollRef = useRef(null);

  useEffect(() => { if (activeBrief) setEditedScript(activeBrief.script); }, [activeBrief]);

  const startTeleprompter = () => { setTeleMode(true); setRecording(false); };
  const startRecording = () => {
    setRecording(true);
    notify("Recording started — teleprompter scrolling", "info");
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      const interval = setInterval(() => {
        if (scrollRef.current) scrollRef.current.scrollTop += 1;
      }, 80);
      setTimeout(() => { clearInterval(interval); setRecording(false); notify("Recording complete!", "success"); }, 8000);
    }
  };

  return (
    <div className="anim-fade">
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24 }}>
        <div>
          <h1 style={{ fontSize:24,fontWeight:700,letterSpacing:"-0.03em",marginBottom:4 }}>Studio</h1>
          <p style={{ color:"#71717a",fontSize:14 }}>Script editing, teleprompter, and recording workflow.</p>
        </div>
        {teleMode && <Btn variant="secondary" onClick={()=>setTeleMode(false)}><I.X/> Exit Teleprompter</Btn>}
      </div>

      {teleMode ? (
        <div className="anim-fade" style={{ maxWidth:700,margin:"0 auto" }}>
          <div style={{ background:"#111116",borderRadius:12,border:"1px solid #1c1c24",overflow:"hidden" }}>
            <div style={{ padding:"12px 20px",borderBottom:"1px solid #1c1c24",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
              <span style={{ fontSize:14,fontWeight:600 }}>{activeBrief?.title}</span>
              <div style={{ display:"flex",gap:8 }}>
                {recording ? <Badge color="#ef4444" bg="#450a0a"><span className="pulse" style={{ width:6,height:6,borderRadius:"50%",background:"#ef4444",display:"inline-block",marginRight:4 }}/>Recording</Badge>
                 : <Btn onClick={startRecording} variant="danger" style={{ padding:"6px 14px" }}><div style={{ width:8,height:8,borderRadius:"50%",background:"#fca5a5" }}/> Start Recording</Btn>}
              </div>
            </div>
            <div ref={scrollRef} style={{ padding:"40px 48px",height:400,overflowY:"auto",scrollBehavior:"smooth" }}>
              <p style={{ fontSize:28,fontWeight:500,lineHeight:1.8,color:"#e4e4e7",letterSpacing:"-0.01em" }}>{editedScript}</p>
            </div>
            <div style={{ padding:"10px 20px",borderTop:"1px solid #1c1c24",display:"flex",justifyContent:"center",gap:12 }}>
              <span style={{ fontSize:11,color:"#52525b" }}>{PLATFORMS[activeBrief?.platform]?.name} · {activeBrief?.format}</span>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display:"grid",gridTemplateColumns:"280px 1fr",gap:20 }}>
          {/* Queue */}
          <Section title="Recording Queue">
            {approvedBriefs.length === 0 && briefs.filter(b=>b.status==="pending").length === 0
              ? <EmptyState icon={<I.Mic/>} title="Empty queue" sub="Approve briefs from Radar" />
              : [...approvedBriefs, ...briefs.filter(b=>b.status==="pending")].map(b => (
              <div key={b.id} onClick={()=>setActiveBrief(b)} className="row-hover" style={{
                padding:"10px 16px",borderBottom:"1px solid #1c1c24",cursor:"pointer",
                background:activeBrief?.id===b.id?"#1e1b4b10":"transparent",
                borderLeft:activeBrief?.id===b.id?"2px solid #6366f1":"2px solid transparent",
              }}>
                <p style={{ fontSize:13,fontWeight:500,marginBottom:2 }}>{b.title}</p>
                <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                  <PlatformPill id={b.platform} small /><span style={{ fontSize:11,color:"#52525b" }}>{b.format}</span>
                  {b.status==="pending" && <Badge color="#eab308" bg="#422006">Pending</Badge>}
                </div>
              </div>
            ))}
          </Section>

          {/* Editor */}
          {activeBrief ? (
            <div>
              <Section title={activeBrief.title} subtitle={`${PLATFORMS[activeBrief.platform]?.name} · ${activeBrief.format}`}
                right={<Btn onClick={startTeleprompter}><I.Play/> Teleprompter</Btn>}>
                <div style={{ padding:20 }}>
                  <label style={{ fontSize:12,fontWeight:500,color:"#a1a1aa",display:"block",marginBottom:8 }}>Script Editor</label>
                  <textarea value={editedScript} onChange={e=>setEditedScript(e.target.value)} rows={10}
                    style={{ width:"100%",padding:14,borderRadius:8,border:"1px solid #27272a",background:"#0a0a0f",color:"#e4e4e7",fontSize:14,lineHeight:1.7,resize:"vertical",fontFamily:"inherit" }} />
                  <div style={{ display:"flex",justifyContent:"space-between",marginTop:12 }}>
                    <span style={{ fontSize:12,color:"#52525b" }}>{editedScript.split(" ").length} words · ~{Math.round(editedScript.split(" ").length / 2.5)}s read time</span>
                    <div style={{ display:"flex",gap:8 }}>
                      <Btn variant="secondary" onClick={()=>setEditedScript(activeBrief.script)}>Reset</Btn>
                      <Btn onClick={()=>notify("Script saved!","success")}>Save Changes</Btn>
                    </div>
                  </div>
                </div>
              </Section>
            </div>
          ) : <EmptyState icon={<I.Edit/>} title="Select a brief" sub="Choose from the queue to start editing" />}
        </div>
      )}
    </div>
  );
}

// ─── PAGE: CORTEX ─────────────────────────────────────────────────────────────
function Cortex() {
  const { state } = useContext(AppContext);
  const { cortex } = state;
  if (!cortex) return null;

  const catColors = { format:"#6366f1", timing:"#22c55e", content:"#eab308", cadence:"#ef4444" };

  return (
    <div className="anim-fade">
      <div style={{ marginBottom:28 }}>
        <h1 style={{ fontSize:24,fontWeight:700,letterSpacing:"-0.03em",marginBottom:4 }}>Cortex</h1>
        <p style={{ color:"#71717a",fontSize:14 }}>Pattern intelligence. The longer you use Catalyst, the smarter this gets.</p>
      </div>

      {/* Pattern Cards */}
      <Section title="Learned Patterns" subtitle={`${cortex.patterns.length} patterns detected from your audience data`} style={{ marginBottom:20 }}>
        <div style={{ padding:16,display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))",gap:12 }}>
          {cortex.patterns.map(p => (
            <div key={p.id} style={{ padding:16,borderRadius:8,background:"#0a0a0f",border:"1px solid #1c1c24" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10 }}>
                <Badge color={catColors[p.category]||"#6366f1"}>{p.category}</Badge>
                <span style={{ fontSize:11,color:"#52525b" }}>{p.dataPoints} data points</span>
              </div>
              <p style={{ fontSize:13,fontWeight:500,lineHeight:1.5,marginBottom:10 }}>{p.insight}</p>
              <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                <div style={{ flex:1,height:4,borderRadius:2,background:"#1c1c24" }}>
                  <div style={{ height:"100%",borderRadius:2,width:pct(p.confidence),background: p.confidence>0.85?"#22c55e":p.confidence>0.7?"#eab308":"#ef4444" }} />
                </div>
                <span style={{ fontSize:11,color:"#71717a",minWidth:32 }}>{pct(p.confidence)}</span>
                {p.platform !== "all" && <PlatformPill id={p.platform} small />}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Calendar Health */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:20 }}>
        <Section title="Content Mix Health" subtitle="Balance across promotional, educational, and storytelling content">
          <div style={{ padding:20 }}>
            {Object.entries(cortex.calendarHealth.ideal).map(([type, ideal]) => {
              const actual = cortex.calendarHealth[type] || 0;
              const ratio = clamp(actual / 5, 0, 1);
              const idealRatio = clamp(ideal / 5, 0, 1);
              const overIndex = actual > ideal;
              return (
                <div key={type} style={{ marginBottom:16 }}>
                  <div style={{ display:"flex",justifyContent:"space-between",marginBottom:6 }}>
                    <span style={{ fontSize:13,fontWeight:500,textTransform:"capitalize" }}>{type}</span>
                    <span style={{ fontSize:12,color:overIndex?"#ef4444":"#22c55e" }}>{actual} this week (ideal: {ideal})</span>
                  </div>
                  <div style={{ height:8,borderRadius:4,background:"#1c1c24",position:"relative" }}>
                    <div style={{ position:"absolute",left:0,top:0,height:"100%",borderRadius:4,width:pct(ratio),background:overIndex?"#ef4444":"#22c55e",transition:"width 0.3s" }} />
                    <div style={{ position:"absolute",left:pct(idealRatio),top:-2,width:2,height:12,background:"#a1a1aa",borderRadius:1 }} title="Ideal" />
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Weekly Performance Digest" right={<Badge color="#c084fc" bg="#2e1065">AI</Badge>}>
          <div style={{ padding:20 }}>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16 }}>
              <div style={{ padding:12,borderRadius:8,background:"#0a0a0f",border:"1px solid #1c1c24" }}>
                <p style={{ fontSize:11,color:"#52525b",marginBottom:4 }}>Total Reach</p>
                <p style={{ fontSize:22,fontWeight:700 }}>{fmt(cortex.weeklyDigest.totalReach)}</p>
              </div>
              <div style={{ padding:12,borderRadius:8,background:"#0a0a0f",border:"1px solid #1c1c24" }}>
                <p style={{ fontSize:11,color:"#52525b",marginBottom:4 }}>Avg Engagement</p>
                <p style={{ fontSize:22,fontWeight:700 }}>{cortex.weeklyDigest.avgEngagement}%</p>
              </div>
            </div>
            <p style={{ fontSize:11,fontWeight:600,color:"#52525b",marginBottom:8 }}>TOP PERFORMER</p>
            <p style={{ fontSize:14,fontWeight:600,color:"#86efac",marginBottom:16 }}>{cortex.weeklyDigest.topPerformer}</p>
            <p style={{ fontSize:11,fontWeight:600,color:"#52525b",marginBottom:8 }}>RECOMMENDED ACTIONS</p>
            {cortex.weeklyDigest.recommendedActions.map((a,i) => (
              <div key={i} style={{ display:"flex",gap:10,alignItems:"flex-start",padding:"8px 0",borderBottom:i<cortex.weeklyDigest.recommendedActions.length-1?"1px solid #1c1c24":"" }}>
                <div style={{ minWidth:22,height:22,borderRadius:6,background:"#1e1b4b",color:"#a5b4fc",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700 }}>{i+1}</div>
                <p style={{ fontSize:12,color:"#d4d4d8",lineHeight:1.5 }}>{a}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

// ─── PAGE: VOICE DNA ──────────────────────────────────────────────────────────
function VoiceDna() {
  const { state } = useContext(AppContext);
  const notify = useNotify();
  const vd = state.user?.voiceDna || {};
  const [tone, setTone] = useState(vd.tone || "Professional");
  const [incl, setIncl] = useState(vd.includeWords || "");
  const [excl, setExcl] = useState(vd.excludeWords || "");
  const [emoji, setEmoji] = useState(vd.emojiUsage || "minimal");
  const [hash, setHash] = useState(vd.hashtagStyle || "niche");

  const save = async () => {
    await api.updateVoiceDna({ tone, includeWords:incl, excludeWords:excl, emojiUsage:emoji, hashtagStyle:hash });
    notify("Voice DNA saved! All future content uses your voice.", "success");
  };

  return (
    <div className="anim-fade">
      <div style={{ marginBottom:28 }}>
        <h1 style={{ fontSize:24,fontWeight:700,letterSpacing:"-0.03em",marginBottom:4 }}>Voice DNA</h1>
        <p style={{ color:"#71717a",fontSize:14 }}>Train the AI to write like you. Every generated caption, script, and reply will match your voice.</p>
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:20 }}>
        <Section title="Voice Configuration">
          <div style={{ padding:20 }}>
            <label style={{ fontSize:12,fontWeight:500,color:"#a1a1aa",display:"block",marginBottom:8 }}>Primary Tone</label>
            <div style={{ display:"flex",flexWrap:"wrap",gap:6,marginBottom:18 }}>
              {["Professional","Casual","Bold/Provocative","Educational","Storytelling"].map(t => (
                <button key={t} onClick={()=>setTone(t)} style={{ padding:"6px 14px",borderRadius:6,border:`1px solid ${tone===t?"#6366f1":"#27272a"}`,background:tone===t?"#1e1b4b":"transparent",color:tone===t?"#a5b4fc":"#71717a",fontSize:12,fontWeight:500,cursor:"pointer" }}>{t}</button>
              ))}
            </div>
            <label style={{ fontSize:12,fontWeight:500,color:"#a1a1aa",display:"block",marginBottom:6 }}>Words You Use</label>
            <input value={incl} onChange={e=>setIncl(e.target.value)} style={{ width:"100%",padding:"8px 12px",borderRadius:6,border:"1px solid #27272a",background:"#0a0a0f",color:"#e4e4e7",fontSize:13,marginBottom:14 }} />
            <label style={{ fontSize:12,fontWeight:500,color:"#a1a1aa",display:"block",marginBottom:6 }}>Words to Avoid</label>
            <input value={excl} onChange={e=>setExcl(e.target.value)} style={{ width:"100%",padding:"8px 12px",borderRadius:6,border:"1px solid #27272a",background:"#0a0a0f",color:"#e4e4e7",fontSize:13,marginBottom:14 }} />
            <label style={{ fontSize:12,fontWeight:500,color:"#a1a1aa",display:"block",marginBottom:8 }}>Emoji Usage</label>
            <div style={{ display:"flex",gap:6,marginBottom:18 }}>
              {["none","minimal","moderate","heavy"].map(e => (
                <button key={e} onClick={()=>setEmoji(e)} style={{ padding:"6px 14px",borderRadius:6,border:`1px solid ${emoji===e?"#6366f1":"#27272a"}`,background:emoji===e?"#1e1b4b":"transparent",color:emoji===e?"#a5b4fc":"#71717a",fontSize:12,fontWeight:500,cursor:"pointer",textTransform:"capitalize" }}>{e}</button>
              ))}
            </div>
            <label style={{ fontSize:12,fontWeight:500,color:"#a1a1aa",display:"block",marginBottom:8 }}>Hashtag Strategy</label>
            <div style={{ display:"flex",gap:6,marginBottom:20 }}>
              {[["niche","3-5 targeted"],["broad","8-15 mixed"],["none","No hashtags"]].map(([k,l]) => (
                <button key={k} onClick={()=>setHash(k)} style={{ padding:"6px 14px",borderRadius:6,border:`1px solid ${hash===k?"#6366f1":"#27272a"}`,background:hash===k?"#1e1b4b":"transparent",color:hash===k?"#a5b4fc":"#71717a",fontSize:12,fontWeight:500,cursor:"pointer" }}>{l}</button>
              ))}
            </div>
            <Btn onClick={save} style={{ width:"100%" }}>Save Voice DNA</Btn>
          </div>
        </Section>

        <Section title="Training Samples" subtitle="Paste 3-10 of your best-performing posts">
          <div style={{ padding:20 }}>
            {[1,2,3].map(i => (
              <div key={i} style={{ marginBottom:14 }}>
                <label style={{ fontSize:11,fontWeight:500,color:"#52525b",marginBottom:4,display:"block" }}>Sample {i}</label>
                <textarea placeholder="Paste a high-performing post..." rows={3} style={{ width:"100%",padding:"8px 12px",borderRadius:6,border:"1px solid #27272a",background:"#0a0a0f",color:"#e4e4e7",fontSize:12,resize:"vertical" }} />
              </div>
            ))}
            <div style={{ padding:14,borderRadius:8,background:"#0a0a0f",border:"1px solid #1c1c24",marginTop:8 }}>
              <p style={{ fontSize:12,fontWeight:600,color:"#a5b4fc",marginBottom:8 }}>How Voice DNA Works</p>
              {["Extracts sentence rhythm and average length","Identifies vocabulary and signature phrases","Learns opening/closing patterns","Detects humor and tone shifts","Applied to all generated content automatically"].map((t,i) => (
                <div key={i} style={{ display:"flex",alignItems:"flex-start",gap:8,fontSize:12,color:"#71717a",marginBottom:4 }}>
                  <span style={{ color:"#6366f1",fontWeight:600,fontSize:11,minWidth:14 }}>{i+1}.</span>{t}
                </div>
              ))}
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

// ─── PAGE: SETTINGS ───────────────────────────────────────────────────────────
function Settings() {
  const { state } = useContext(AppContext);
  const notify = useNotify();
  return (
    <div className="anim-fade">
      <div style={{ marginBottom:28 }}>
        <h1 style={{ fontSize:24,fontWeight:700,letterSpacing:"-0.03em",marginBottom:4 }}>Settings</h1>
        <p style={{ color:"#71717a",fontSize:14 }}>Account, integrations, and system configuration.</p>
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:20 }}>
        <Section title="Connected Platforms">
          <div style={{ padding:16 }}>
            {Object.entries(PLATFORMS).map(([k,p]) => (
              <div key={k} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid #1c1c24" }}>
                <div style={{ display:"flex",alignItems:"center",gap:10 }}><PlatformPill id={k}/><span style={{ fontSize:13,fontWeight:500 }}>{p.name}</span></div>
                <Badge color="#22c55e" bg="#052e16">Connected</Badge>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Account">
          <div style={{ padding:20 }}>
            <div style={{ display:"flex",alignItems:"center",gap:14,marginBottom:20 }}>
              <div style={{ width:48,height:48,borderRadius:"50%",background:"#27272a",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:600,color:"#a1a1aa" }}>{state.user?.avatar}</div>
              <div>
                <p style={{ fontSize:15,fontWeight:600 }}>{state.user?.name}</p>
                <p style={{ fontSize:12,color:"#71717a" }}>{state.user?.email}</p>
              </div>
            </div>
            <div style={{ padding:12,borderRadius:8,background:"#0a0a0f",border:"1px solid #1c1c24",marginBottom:14 }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                <span style={{ fontSize:13,fontWeight:500 }}>Plan</span>
                <Badge color="#c084fc" bg="#2e1065">Pro</Badge>
              </div>
            </div>
            <div style={{ padding:12,borderRadius:8,background:"#0a0a0f",border:"1px solid #1c1c24",marginBottom:14 }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                <span style={{ fontSize:13,fontWeight:500 }}>Crisis SMS Alerts</span>
                <Badge color="#22c55e" bg="#052e16">Enabled</Badge>
              </div>
            </div>
            <div style={{ padding:12,borderRadius:8,background:"#0a0a0f",border:"1px solid #1c1c24" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                <span style={{ fontSize:13,fontWeight:500 }}>Sentiment Threshold</span>
                <span style={{ fontSize:13,color:"#a1a1aa" }}>30%</span>
              </div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT APP
// ═══════════════════════════════════════════════════════════════════════════════
export default function CatalystOS() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [isAuthenticated, setIsAuthenticated] = useState(api.isAuthenticated());
  const [authMode, setAuthMode] = useState("login");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });

  const loadInitialData = useCallback(async () => {
    dispatch({ type: "SET_LOADING", payload: true });
    try {
      const [user, campaigns, signals, briefs, cortex, apiHealth, stats, calendarBalance] = await Promise.all([
        api.getUser(), api.getCampaigns(), api.getSignals(), api.getBriefs(), api.getCortex(), api.getApiHealth(), api.getDashboardStats(), api.getCalendarBalance(),
      ]);
      dispatch({ type: "SET_USER", payload: user });
      dispatch({ type: "SET_CAMPAIGNS", payload: campaigns });
      dispatch({ type: "SET_SIGNALS", payload: signals });
      dispatch({ type: "SET_BRIEFS", payload: briefs });
      dispatch({ type: "SET_CORTEX", payload: cortex });
      dispatch({ type: "SET_API_HEALTH", payload: apiHealth });
      dispatch({ type: "SET_STATS", payload: stats });
      dispatch({ type: "SET_CALENDAR_BALANCE", payload: calendarBalance });
    } catch (e) {
      if ((e?.message || "").toLowerCase().includes("log in") || (e?.message || "").toLowerCase().includes("session")) {
        api.logout();
        setIsAuthenticated(false);
      } else {
        console.error("Boot failed:", e);
      }
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) loadInitialData();
    else dispatch({ type: "SET_LOADING", payload: false });
  }, [isAuthenticated, loadInitialData]);

  // Refresh stats when campaigns change
  useEffect(() => {
    if (!state.loading && isAuthenticated) {
      api.getDashboardStats().then(s => dispatch({ type:"SET_STATS", payload:s }));
      api.getCalendarBalance().then(b => dispatch({ type:"SET_CALENDAR_BALANCE", payload:b }));
    }
  }, [state.campaigns, state.loading, isAuthenticated]);

  const NAV = [
    { id:"dashboard", label:"Dashboard", icon:<I.Bar/> },
    { id:"forge",     label:"Forge",     icon:<I.Zap/> },
    { id:"launchpad", label:"Launchpad", icon:<I.Calendar/> },
    { id:"radar",     label:"Radar",     icon:<I.Globe/> },
    { id:"studio",    label:"Studio",    icon:<I.Film/> },
    { id:"cortex",    label:"Cortex",    icon:<I.Brain/> },
    { id:"voicedna",  label:"Voice DNA", icon:<I.Mic/> },
    { id:"settings",  label:"Settings",  icon:<I.Shield/> },
  ];

  const VIEW = { dashboard:<Dashboard/>, forge:<Forge/>, launchpad:<Launchpad/>, radar:<Radar/>, studio:<Studio/>, cortex:<Cortex/>, voicedna:<VoiceDna/>, settings:<Settings/> };

  const submitAuth = async (e) => {
    e.preventDefault();
    setAuthError("");
    if (!authForm.email.trim() || !authForm.password.trim()) {
      setAuthError("Email and password are required.");
      return;
    }
    if (authMode === "register" && !authForm.name.trim()) {
      setAuthError("Name is required for account setup.");
      return;
    }

    setAuthBusy(true);
    try {
      if (authMode === "register") await api.register(authForm);
      else await api.login(authForm);
      setIsAuthenticated(true);
      setAuthForm((prev) => ({ ...prev, password: "" }));
    } catch (err) {
      setAuthError(err?.message || "Authentication failed. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = () => {
    api.logout();
    setIsAuthenticated(false);
    dispatch({ type: "SET_USER", payload: null });
    dispatch({ type: "SET_CAMPAIGNS", payload: [] });
    dispatch({ type: "SET_SIGNALS", payload: [] });
    dispatch({ type: "SET_BRIEFS", payload: [] });
    dispatch({ type: "SET_CORTEX", payload: null });
    dispatch({ type: "SET_API_HEALTH", payload: {} });
    dispatch({ type: "SET_CALENDAR_BALANCE", payload: null });
    dispatch({ type: "SET_STATS", payload: null });
    dispatch({ type: "SET_VIEW", payload: "dashboard" });
  };

  if (!isAuthenticated) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0a0a0f", color: "#e4e4e7", padding: 20 }}>
        <form onSubmit={submitAuth} style={{ width: "100%", maxWidth: 420, border: "1px solid #1c1c24", borderRadius: 12, background: "#0f0f15", padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "grid", placeItems: "center", fontSize: 14, fontWeight: 700 }}>C</div>
            <p style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>Catalyst OS</p>
          </div>

          {authMode === "register" && (
            <input
              value={authForm.name}
              onChange={(e) => setAuthForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Full name"
              style={{ width: "100%", marginBottom: 10, padding: "10px 12px", borderRadius: 8, border: "1px solid #27272a", background: "#0a0a0f", color: "#e4e4e7" }}
            />
          )}
          <input
            type="email"
            value={authForm.email}
            onChange={(e) => setAuthForm((prev) => ({ ...prev, email: e.target.value }))}
            placeholder="Email"
            style={{ width: "100%", marginBottom: 10, padding: "10px 12px", borderRadius: 8, border: "1px solid #27272a", background: "#0a0a0f", color: "#e4e4e7" }}
          />
          <input
            type="password"
            value={authForm.password}
            onChange={(e) => setAuthForm((prev) => ({ ...prev, password: e.target.value }))}
            placeholder="Password"
            style={{ width: "100%", marginBottom: 12, padding: "10px 12px", borderRadius: 8, border: "1px solid #27272a", background: "#0a0a0f", color: "#e4e4e7" }}
          />

          {authError && <p style={{ fontSize: 12, color: "#f87171", marginBottom: 10 }}>{authError}</p>}

          <button type="submit" disabled={authBusy} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "none", background: "#6366f1", color: "#fff", fontWeight: 600 }}>
            {authBusy ? "Please wait..." : authMode === "register" ? "Create account" : "Log in"}
          </button>

          <button
            type="button"
            onClick={() => { setAuthMode(authMode === "register" ? "login" : "register"); setAuthError(""); }}
            style={{ width: "100%", marginTop: 10, padding: "9px 12px", borderRadius: 8, border: "1px solid #27272a", background: "transparent", color: "#a1a1aa", fontWeight: 600 }}
          >
            {authMode === "register" ? "I already have an account" : "Create a new account"}
          </button>
        </form>
      </div>
    );
  }

  if (state.loading) {
    return (
      <div style={{ fontFamily:"'DM Sans',system-ui,sans-serif", background:"#0a0a0f", color:"#e4e4e7", minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:16 }}>
        <div style={{ width:48,height:48,borderRadius:12,background:"linear-gradient(135deg,#6366f1,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,fontWeight:700 }}>C</div>
        <p style={{ fontSize:14,color:"#71717a" }}>Loading Catalyst OS...</p>
        <div style={{ width:120,height:3,borderRadius:2,overflow:"hidden",background:"#1c1c24" }}><div className="shimmer" style={{ width:"100%",height:"100%" }} /></div>
      </div>
    );
  }

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      <div style={{ fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif", background:"#0a0a0f", color:"#e4e4e7", minHeight:"100vh", display:"flex", flexDirection:"column" }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
          * { box-sizing:border-box; margin:0; padding:0; }
          ::-webkit-scrollbar { width:5px; } ::-webkit-scrollbar-track { background:transparent; } ::-webkit-scrollbar-thumb { background:#27272a; border-radius:3px; }
          input,textarea,select { font-family:inherit; } button { cursor:pointer; font-family:inherit; }
          @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
          @keyframes slideIn { from{opacity:0;transform:translateX(16px)} to{opacity:1;transform:translateX(0)} }
          @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
          @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
          .anim-fade { animation:fadeIn .25s ease-out; }
          .anim-slide { animation:slideIn .25s ease-out; }
          .pulse { animation:pulse 2s ease-in-out infinite; }
          .shimmer { background:linear-gradient(90deg,#18181b 25%,#27272a 50%,#18181b 75%); background-size:200% 100%; animation:shimmer 1.5s infinite; }
          .row-hover:hover { background:#161620 !important; }
        `}</style>

        <Toasts items={state.notifications} />

        {/* HEADER */}
        <header style={{
          display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 20px",height:52,
          borderBottom:"1px solid #1c1c24",background:"rgba(10,10,15,.92)",backdropFilter:"blur(12px)",
          position:"sticky",top:0,zIndex:50,
        }}>
          <div style={{ display:"flex",alignItems:"center",gap:20 }}>
            <div style={{ display:"flex",alignItems:"center",gap:8,marginRight:8 }}>
              <div style={{ width:26,height:26,borderRadius:6,background:"linear-gradient(135deg,#6366f1,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:"#fff" }}>C</div>
              <span style={{ fontSize:14,fontWeight:700,letterSpacing:"-0.02em" }}>Catalyst<span style={{ color:"#71717a",fontWeight:400 }}>OS</span></span>
            </div>
            <nav style={{ display:"flex",gap:1 }}>
              {NAV.map(t => (
                <button key={t.id} onClick={()=>dispatch({type:"SET_VIEW",payload:t.id})} style={{
                  display:"flex",alignItems:"center",gap:5,padding:"5px 12px",borderRadius:6,border:"none",fontSize:12,fontWeight:500,
                  background:state.view===t.id?"#1e1b4b":"transparent",color:state.view===t.id?"#a5b4fc":"#71717a",transition:"all .12s",
                }}>
                  {t.icon}<span>{t.label}</span>
                  {t.id==="radar" && state.crisisMode && <span className="pulse" style={{ width:5,height:5,borderRadius:"50%",background:"#ef4444" }} />}
                  {t.id==="studio" && state.briefs.filter(b=>b.status==="approved").length > 0 && (
                    <span style={{ minWidth:16,height:16,borderRadius:8,background:"#6366f1",color:"#fff",fontSize:9,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 4px" }}>
                      {state.briefs.filter(b=>b.status==="approved").length}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:10 }}>
            <span style={{ fontSize:11,padding:"2px 8px",borderRadius:4,background:"#14532d",color:"#86efac",fontWeight:600 }}>All Systems Healthy</span>
            <button
              onClick={handleLogout}
              style={{ border: "1px solid #27272a", background: "transparent", color: "#a1a1aa", fontSize: 11, borderRadius: 6, padding: "4px 8px" }}
            >
              Log out
            </button>
            <div style={{ width:28,height:28,borderRadius:"50%",background:"#27272a",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:600,color:"#a1a1aa" }}>{state.user?.avatar}</div>
          </div>
        </header>

        {/* MAIN */}
        <main style={{ flex:1,padding:"24px clamp(16px, 2vw, 32px)",width:"100%" }}>
          {VIEW[state.view] || <Dashboard />}
        </main>

        {/* FOOTER */}
        <footer style={{ padding:"12px 24px",borderTop:"1px solid #1c1c24",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
          <span style={{ fontSize:11,color:"#3f3f46" }}>Catalyst OS v1.0.0 · Human-in-the-loop marketing agent</span>
          <span style={{ fontSize:11,color:"#3f3f46" }}>API-compliant · No autonomous posting · Your data, your control</span>
        </footer>
      </div>
    </AppContext.Provider>
  );
}
