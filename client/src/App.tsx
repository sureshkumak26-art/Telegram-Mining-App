import { useEffect, useState } from 'react';
import Admin from './Admin';

type Profile = { id: string; firstName: string; username?: string; points: number; energy: number; maxEnergy: number; taps: number };
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
  const [profile, setProfile] = useState<Profile>({ id: 'demo', firstName: 'Miner', points: 0, energy: 100, maxEnergy: 100, taps: 0 });
  const [tab, setTab] = useState<Tab>('tap');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [withdrawPoints, setWithdrawPoints] = useState('100');
  const [upi, setUpi] = useState('');
  const [refCopied, setRefCopied] = useState(false);
  const initData = telegram?.initData || '';
  const isTelegram = Boolean(initData);
  const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || '';
  const referralLink = botUsername ? `https://t.me/${botUsername}?start=ref_${profile.id}` : '';

  useEffect(() => {
    if (!initData) { setNotice('Preview mode · open this Mini App inside Telegram to save progress.'); return; }
    request('/api/me', initData).then((d) => setProfile(d.profile)).catch((e) => setNotice(e.message));
  }, [initData]);

  async function tap() {
    if (busy || profile.energy < 1) return;
    if (!isTelegram) { setProfile(p => ({ ...p, points: p.points + 1, energy: Math.max(0, p.energy - 1), taps: p.taps + 1 })); return; }
    setBusy(true); setNotice('');
    try { const d = await request('/api/tap', initData, { method: 'POST', body: JSON.stringify({ count: 1 }) }); setProfile(d.profile); }
    catch (e) { setNotice(e instanceof Error ? e.message : 'Tap failed'); }
    finally { setBusy(false); }
  }
  async function copyReferral() {
    if (!referralLink) { setNotice('Set VITE_TELEGRAM_BOT_USERNAME in the frontend environment to enable your referral link.'); return; }
    try { await navigator.clipboard.writeText(referralLink); setRefCopied(true); setTimeout(() => setRefCopied(false), 1800); }
    catch { setNotice('Copy is unavailable in this browser.'); }
  }
  async function withdraw() {
    const points = Number(withdrawPoints);
    if (!isTelegram) { setNotice('Open this app inside Telegram to submit a real withdrawal request.'); return; }
    setBusy(true); setNotice('');
    try {
      await request('/api/withdrawals', initData, { method:'POST', body:JSON.stringify({ points, payoutMethod:'UPI', payoutDetails:upi }) });
      const d = await request('/api/me', initData); setProfile(d.profile); setNotice('Withdrawal request submitted for admin review. Payment is not automatic.');
    } catch(e) { setNotice(e instanceof Error ? e.message : 'Withdrawal request failed'); }
    finally { setBusy(false); }
  }

  return <main className="app-shell">
    <header className="telegram-bar"><div className="tg-close">×</div><div className="tg-title">Hyperliquid</div><div className="tg-chevron">⌄</div><div className="tg-menu">⋮</div></header>
    <div className="app-content">
      {tab === 'tap' && <>
        <section className="user-strip"><div className="user-avatar">{(profile.firstName[0] || 'M').toUpperCase()}</div><div className="user-name"><strong>{profile.firstName}</strong><small>{profile.username ? '@'+profile.username : 'Telegram Miner'}</small></div><div className="wallet-chip">◈ <span>WALLET<br/><b>{profile.points.toLocaleString()} PTS</b></span> ›</div></section>
        <section className="tap-balance"><div className="balance-number">{profile.points.toLocaleString()} <span>HYPERLIQUID</span></div><div className="balance-sub">Your virtual mining balance</div></section>
        <section className="coin-stage"><div className="coin-glow"/><div className="coin-ring"><div className="coin-inner"><div className="logo-symbol"><i/><i/><i/><i/></div></div></div><div className="tap-plus">+1</div></section>
        <button className="tap-cta" onClick={tap} disabled={busy || profile.energy < 1}>{busy ? 'MINING…' : '✦  Tap to mine'}</button>
        <section className="meters"><div className="meter"><span>⚡</span><b>{profile.energy}/{profile.maxEnergy}</b><small>ENERGY</small></div><div className="meter"><span>⏳</span><b>{Math.max(0,profile.maxEnergy-profile.energy)} taps</b><small>USED</small></div></section>
        <div className="energy-track"><div style={{width:`${Math.min(100,profile.energy/Math.max(1,profile.maxEnergy)*100)}%`}}/></div>
        <p className="fine-print">Points are virtual rewards and have no guaranteed cash value.</p>
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
        <h1 className="page-heading">Wallet</h1><section className="wallet-balance glass-card"><label>TOTAL BALANCE</label><strong>{profile.points.toLocaleString()} <span>HYPERLIQUID</span></strong><small>Virtual points · no fixed USD value</small></section>
        <button className="withdraw-btn" onClick={() => document.getElementById('withdraw-form')?.scrollIntoView({behavior:'smooth',block:'center'})}>↑ Withdraw points</button>
        <p className="wallet-section-label">Your wallet</p><section className="wallet-option glass-card"><div className="wallet-brand">UPI</div><div><strong>UPI payout</strong><small>India · admin review required</small></div><span>Available</span></section>
        <section id="withdraw-form" className="glass-card withdraw-form"><h3>Request withdrawal</h3><p>Minimum 100 points. Approval does not send money automatically.</p><label htmlFor="withdraw-points">Points to withdraw</label><input id="withdraw-points" type="number" min="100" max={profile.points} value={withdrawPoints} onChange={e=>setWithdrawPoints(e.target.value)}/><label htmlFor="upi-id">UPI ID</label><input id="upi-id" autoComplete="off" placeholder="name@bank" value={upi} onChange={e=>setUpi(e.target.value)}/><button className="blue-btn full-btn" disabled={busy || !upi.trim() || Number(withdrawPoints)<100 || Number(withdrawPoints)>profile.points} onClick={withdraw}>{busy ? 'Submitting…' : 'Submit request'}</button></section>
      </>}
      {notice && <div className="notice" role="status">{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss">×</button></div>}
    </div>
    <nav className="bottom-nav">{(['refer','tasks','tap','wallet'] as Tab[]).map(item=><button key={item} className={tab===item?'active':''} onClick={()=>{setTab(item);setNotice('');}}><Icon name={item}/><span>{item==='refer'?'Refer':item==='tasks'?'Task':item==='tap'?'Tap':'Wallet'}</span></button>)}</nav>
  </main>;
}
