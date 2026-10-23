import { useEffect, useState } from 'react';

type Profile = { id: string; firstName: string; username?: string; points: number; energy: number; maxEnergy: number; taps: number };
const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const telegram = (window as any).Telegram?.WebApp;

async function request(path: string, initData: string, options: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, { ...options, headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData, ...options.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
export default function App() {
  const [profile, setProfile] = useState<Profile>({ id: 'demo', firstName: 'Miner', points: 0, energy: 100, maxEnergy: 100, taps: 0 });
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const initData = telegram?.initData || '';
  const isTelegram = Boolean(initData);

  useEffect(() => {
    if (!initData) { setNotice('Preview mode · open this Mini App inside Telegram to save progress.'); return; }
    request('/api/me', initData).then((d) => setProfile(d.profile)).catch((e) => setNotice(e.message));
  }, [initData]);

  async function tap() {
    if (busy || profile.energy < 1) return;
    if (!isTelegram) { setProfile(p => ({ ...p, points: p.points + 1, energy: Math.max(0, p.energy - 1), taps: p.taps + 1 })); return; }
    setBusy(true); setNotice('');
    try {
      const d = await request('/api/tap', initData, { method: 'POST', body: JSON.stringify({ count: 1 }) });
      setProfile(d.profile);
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Tap failed'); }
    finally { setBusy(false); }
  }

  return <main className="shell">
    <header className="topbar"><div className="brandmark">✦</div><div><div className="eyebrow">TELEGRAM MINI APP</div><h1>NEON <span>MINER</span></h1></div><div className="online"><i /> LIVE</div></header>
    <section className="welcome"><div><p className="eyebrow">WELCOME BACK</p><h2>{profile.firstName}</h2><p className="muted">Your next point is one tap away.</p></div><div className="avatar">{(profile.firstName[0] || 'M').toUpperCase()}</div></section>
    <section className="balance panel"><div className="eyebrow">TOTAL VIRTUAL POINTS</div><div className="points">{profile.points.toLocaleString()}<span> pts</span></div><div className="balance-foot"><span>◈ {profile.taps.toLocaleString()} taps</span><span className="pill">Season 01</span></div></section>
    <section className="mine-area"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><button className="mine-button" onClick={tap} disabled={busy || profile.energy < 1} aria-label="Tap to mine"><span className="crystal">◆</span><strong>{busy ? 'MINING…' : 'TAP TO MINE'}</strong><small>+1 VIRTUAL POINT</small></button></section>
    <section className="energy panel"><div className="energy-head"><span>⚡ ENERGY</span><strong>{profile.energy}<small> / {profile.maxEnergy}</small></strong></div><div className="energy-track"><div style={{ width: `${Math.min(100, profile.energy / Math.max(1, profile.maxEnergy) * 100)}%` }}/></div><p className="muted">Energy is limited to keep play fair.</p></section>
    <section className="tasks panel"><div className="section-title"><div><p className="eyebrow">MORE WAYS TO EARN</p><h3>Daily missions</h3></div><span className="pill">COMING SOON</span></div><div className="task-row"><div className="task-icon">✦</div><div className="task-copy"><strong>Visit the community</strong><small>Follow official updates</small></div><span className="reward">+50</span></div><div className="task-row"><div className="task-icon">◎</div><div className="task-copy"><strong>Daily check-in</strong><small>Build your streak</small></div><span className="reward">+25</span></div></section>
    {notice && <div className="notice" role="status">{notice}</div>}
    <footer>POINTS HAVE NO CASH VALUE UNLESS OFFICIALLY ANNOUNCED <span>·</span> PLAY FAIR</footer>
  </main>;
}
