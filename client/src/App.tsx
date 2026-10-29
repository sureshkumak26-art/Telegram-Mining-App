import { useEffect, useRef, useState } from 'react';
import Admin from './Admin';
import CryptoWallet from './CryptoWallet';

type Profile = { id: string; firstName: string; username?: string; points: number; energy: number; maxEnergy: number; taps: number; resetAt?: string | null };
type Tab = 'refer' | 'tasks' | 'tap' | 'wallet';
const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const telegram = (window as any).Telegram?.WebApp;

async function request(path: string, initData: string, options: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, { ...options, headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData, ...options.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function Icon({ name }: { name: string }) {
  const paths: Record<string,string> = { refer:'♟', tasks:'☑', tap:'❖', wallet:'▣' };
  return <span className="nav-icon" aria-hidden="true">{paths[name] || '✦'}</span>;
}
export default function App() {
  if (window.location.pathname === '/admin') return <Admin />;
  const initData = telegram?.initData || '';
  const [profile, setProfile] = useState<Profile>(() => {
    if (!initData) {
      try {
        const saved = localStorage.getItem('hyperliquid-preview-profile');
        if (saved) {
          const parsed: unknown = JSON.parse(saved);
          if (
            parsed !== null &&
            typeof parsed === 'object' &&
            'id' in parsed &&
            typeof parsed.id === 'string' &&
            'firstName' in parsed &&
            typeof parsed.firstName === 'string' &&
            'points' in parsed &&
            typeof parsed.points === 'number' &&
            'energy' in parsed &&
            typeof parsed.energy === 'number' &&
            'maxEnergy' in parsed &&
            typeof parsed.maxEnergy === 'number' &&
            'taps' in parsed &&
            typeof parsed.taps === 'number'
          ) {
            const savedProfile = parsed as Profile;
            // Migrate preview saves from older builds (100 energy / missing resetAt).
            const maxEnergy = 1000;
            const energy = Math.min(maxEnergy, Math.max(0, savedProfile.energy));
            const resetAt = energy === 0
              ? (savedProfile.resetAt && Number.isFinite(new Date(savedProfile.resetAt).getTime())
                  && new Date(savedProfile.resetAt).getTime() > Date.now()
                  ? savedProfile.resetAt
                  : new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString())
              : null;
            return { ...savedProfile, energy, maxEnergy, resetAt };
          }
        }
      } catch {
        // Ignore invalid or unavailable local preview storage.
      }
    }

    return { id: 'demo', firstName: 'Miner', points: 0, energy: 1000, maxEnergy: 1000, taps: 0, resetAt: null };
  });
  const [tab, setTab] = useState<Tab>('tap');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const pendingTaps = useRef(0);
  const tapTimer = useRef<number | null>(null);
  const tapInFlight = useRef(false);
  const visibleEnergy = useRef(profile.energy);
  const [tapAnimation, setTapAnimation] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [refCopied, setRefCopied] = useState(false);
  const isTelegram = Boolean(initData);
  const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || '';
  const referralLink = botUsername ? `https://t.me/${botUsername}?start=ref_${profile.id}` : '';

  useEffect(() => {
    if (!initData) {
      setNotice('Preview mode · progress is saved in this browser only. Open inside Telegram to use your server balance.');
      return;
    }
    request('/api/me', initData).then((d) => setProfile(d.profile)).catch((e) => setNotice(e.message));
  }, [initData]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!initData || profile.energy !== 0 || !profile.resetAt) return;
    const refreshProfile = () => {
      request('/api/me', initData).then(d => setProfile(d.profile)).catch(e => setNotice(e instanceof Error ? e.message : 'Could not refresh energy'));
    };
    const remaining = new Date(profile.resetAt).getTime() - Date.now();
    if (remaining <= 0) { refreshProfile(); return; }
    const timer = window.setTimeout(refreshProfile, remaining + 100);
    return () => window.clearTimeout(timer);
  }, [initData, profile.energy, profile.resetAt]);

  useEffect(() => {
    if (initData || profile.energy !== 0 || !profile.resetAt) return;
    if (new Date(profile.resetAt).getTime() <= now) {
      setProfile(p => ({ ...p, energy: p.maxEnergy, resetAt: null }));
    }
  }, [initData, profile.energy, profile.maxEnergy, profile.resetAt, now]);

  useEffect(() => {
    // Local preview progress is separate from authenticated Telegram balances.
    if (initData) return;
    try {
      localStorage.setItem('hyperliquid-preview-profile', JSON.stringify(profile));
    } catch {
      setNotice('This browser could not save preview progress. Check storage settings.');
    }
  }, [profile, initData]);

  const resetRemaining = profile.resetAt ? Math.max(0, new Date(profile.resetAt).getTime() - now) : 0;
  const resetCountdown = `${String(Math.floor(resetRemaining / 3600000)).padStart(2, '0')}:${String(Math.floor((resetRemaining % 3600000) / 60000)).padStart(2, '0')}:${String(Math.floor((resetRemaining % 60000) / 1000)).padStart(2, '0')}`;

  async function flushTapQueue() {
    if (!isTelegram || tapInFlight.current || pendingTaps.current < 1) return;
    if (tapTimer.current !== null) { window.clearTimeout(tapTimer.current); tapTimer.current = null; }
    tapInFlight.current = true;
    setBusy(true);
    const count = Math.min(50, pendingTaps.current);
    pendingTaps.current -= count;
    try {
      const d = await request('/api/tap', initData, { method: 'POST', body: JSON.stringify({ count }) });
      const accepted = Number(d.acceptedCount ?? count);
      const rejected = count - accepted;
      if (rejected > 0) {
        pendingTaps.current = Math.max(0, pendingTaps.current - rejected);
        visibleEnergy.current = Math.min(1000, visibleEnergy.current + rejected);
      }
      const stillQueued = pendingTaps.current;
      const energy = Math.max(0, Number(d.profile.energy) - stillQueued);
      const resetAt = energy === 0 ? (d.profile.resetAt || new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString()) : d.profile.resetAt;
      const nextProfile = { ...d.profile, points: Math.round((Number(d.profile.points) + stillQueued * 0.02) * 100) / 100, energy, taps: Number(d.profile.taps) + stillQueued, resetAt };
      visibleEnergy.current = energy;
      setProfile(nextProfile);
    } catch (e) {
      // Roll back only the batch that failed; taps queued while it was in flight remain visible.
      setProfile(p => {
        const energy = Math.min(p.maxEnergy, p.energy + count);
        visibleEnergy.current = Math.min(p.maxEnergy, visibleEnergy.current + count);
        return { ...p, points: Math.max(0, Math.round((p.points - count * 0.02) * 100) / 100), energy, taps: Math.max(0, p.taps - count), resetAt: energy > 0 ? null : p.resetAt };
      });
      setNotice(e instanceof Error ? e.message : 'Tap failed. Please try again.');
    } finally {
      tapInFlight.current = false;
      setBusy(false);
      if (pendingTaps.current > 0) void flushTapQueue();
    }
  }

  function tap() {
    if (visibleEnergy.current < 1) return;
    visibleEnergy.current -= 1;
    pendingTaps.current += 1;
    setTapAnimation(n => n + 1);
    setProfile(p => {
      if (p.energy < 1) return p;
      const energy = Math.max(0, p.energy - 1);
      return { ...p, points: Math.round((p.points + 0.02) * 100) / 100, energy, taps: p.taps + 1, resetAt: energy === 0 ? (p.resetAt && new Date(p.resetAt).getTime() > Date.now() ? p.resetAt : new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString()) : p.resetAt };
    });
    if (!isTelegram) return;
    setNotice('');
    if (tapTimer.current === null && !tapInFlight.current) {
      tapTimer.current = window.setTimeout(() => { tapTimer.current = null; void flushTapQueue(); }, 80);
    }
  }
  async function copyReferral() {
    if (!referralLink) { setNotice('Set VITE_TELEGRAM_BOT_USERNAME in the frontend environment to enable your referral link.'); return; }
    try { await navigator.clipboard.writeText(referralLink); setRefCopied(true); setTimeout(() => setRefCopied(false), 1800); }
    catch { setNotice('Copy is unavailable in this browser.'); }
  }

  return <main className="app-shell">
    <header className="telegram-bar"><div className="tg-close">×</div><div className="tg-title">Hyperliquid</div><div className="tg-chevron">⌄</div><div className="tg-menu">⋮</div></header>
    <div className="app-content">
      {tab === 'tap' && <>
        <section className="user-strip"><div className="user-avatar">{(profile.firstName[0] || 'M').toUpperCase()}</div><div className="user-name"><strong>{profile.firstName}</strong><small>{profile.username ? '@'+profile.username : 'Telegram Miner'}</small></div><div className="wallet-chip">◈ <span>WALLET<br/><b>{profile.points.toLocaleString()} PTS</b></span> ›</div></section>
        <section className="tap-balance"><div className="balance-number">{profile.points.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span>HYPERLIQUID</span></div><div className="balance-sub">Your virtual mining balance</div></section>
        <section className="coin-stage" role="button" tabIndex={0} aria-label="Tap the Hyperliquid mining coin to earn 0.02 points" onClick={tap} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tap(); } }}><div className="coin-glow"/><div className="coin-ring"><div className="coin-inner"><div className="logo-symbol"><i/><i/><i/><i/></div></div></div><div key={tapAnimation} className={`tap-plus${tapAnimation > 0 ? ' animate' : ''}`}>+0.02</div></section>
        <button className="tap-cta" onClick={tap} disabled={profile.energy < 1}>{profile.energy < 1 ? '⏳  Resetting…' : busy ? '✦  Tap to mine · syncing' : '✦  Tap to mine'}</button>
        <section className="meters"><div className="meter"><span>⚡</span><b>{profile.energy}/{profile.maxEnergy}</b><small>TAPS LEFT</small></div><div className="meter"><span>⌛</span><b>{profile.energy === 0 ? resetCountdown : 'READY'}</b><small>RESET TIMER (H:M:S)</small></div></section>
        {profile.energy === 0 && <p className="fine-print">Tap limit reached. Energy refills when the countdown reaches 00:00:00.</p>}
        <div className="energy-track"><div style={{width:`${Math.min(100,profile.energy/Math.max(1,profile.maxEnergy)*100)}%`}}/></div>
        <p className="fine-print">Each tap earns 0.02 virtual points. 1,000 taps per cycle; full reset after 5 hours. Points have no guaranteed cash value.</p>
      </>}
      {tab === 'refer' && <>
        <h1 className="page-heading">Refer &amp; Earn</h1><p className="page-subtitle">Invite friends and grow together</p>
        <section className="invite-reward"><small>PER INVITE</small><strong><span>✦</span> Referral rewards</strong><p>Referral rewards are not enabled on the server yet.</p></section>
        <section className="glass-card referral-card"><label>YOUR REFERRAL LINK</label><div className="link-box"><span>{referralLink || 'Set bot username to generate link'}</span><button onClick={copyReferral} aria-label="Copy referral link">▢</button></div><div className="two-buttons"><button className="secondary-btn" onClick={copyReferral}>▢ {refCopied ? 'Copied!' : 'Copy Link'}</button><button className="blue-btn" onClick={() => referralLink ? window.open('https://t.me/share/url?url='+encodeURIComponent(referralLink),'_blank') : setNotice('Configure the bot username first.')}>➤ Share</button></div></section>
        <section className="glass-card referral-stats"><div><b>0</b><small>Total Referrals</small></div><div><b>0</b><small>Active Referrals</small></div><div><b>0</b><small>Points Earned</small></div></section>
      </>}
      {tab === 'tasks' && <>
        <h1 className="page-heading">Tasks</h1><p className="page-subtitle">Complete missions to earn rewards</p>
        <section className="task-card"><div className="task-logo x-logo">𝕏</div><div className="task-details"><strong>Follow our X page</strong><a href="https://x.com/" target="_blank" rel="noreferrer">Open X</a><small>Reward system not enabled</small></div><button className="start-btn" onClick={() => window.open('https://x.com/','_blank')}>Start</button></section>
        <section className="task-card"><div className="task-logo telegram-logo">➤</div><div className="task-details"><strong>Join our Telegram</strong><a href="https://telegram.org/" target="_blank" rel="noreferrer">Open Telegram</a><small>Reward system not enabled</small></div><button className="start-btn" onClick={() => window.open('https://telegram.org/','_blank')}>Start</button></section>
        <section className="task-card"><div className="task-logo video-logo">▶</div><div className="task-details"><strong>Watch community videos</strong><a href="https://youtube.com/" target="_blank" rel="noreferrer">Open YouTube</a><small>Reward system not enabled</small></div><button className="start-btn" onClick={() => window.open('https://youtube.com/','_blank')}>Start</button></section>
        <p className="task-disclaimer">Task verification and rewards are not active yet. These links do not award points.</p>
      </>}
      {tab === 'wallet' && <>
        <h1 className="page-heading">Mining Points Wallet</h1><section className="wallet-balance glass-card"><label>TOTAL BALANCE</label><strong>{profile.points.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span>HYPERLIQUID</span></strong><small>Virtual points · no fixed USD value</small></section>
        <p className="wallet-section-label">Your wallet</p>
        <CryptoWallet initData={initData} isTelegram={isTelegram} />
      </>}
      {notice && <div className="notice" role="status">{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss">×</button></div>}
    </div>
    <nav className="bottom-nav">{(['refer','tasks','tap','wallet'] as Tab[]).map(item=><button key={item} className={tab===item?'active':''} onClick={()=>{setTab(item);setNotice('');}}><Icon name={item}/><span>{item==='refer'?'Refer':item==='tasks'?'Task':item==='tap'?'Tap':'Wallet'}</span></button>)}</nav>
  </main>;
}
