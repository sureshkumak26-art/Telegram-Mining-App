import { useEffect, useMemo, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const tg = (window as any).Telegram?.WebApp;
type Tab = 'overview' | 'users' | 'withdrawals' | 'ledger';
type Withdrawal = { id: number; telegram_id: string; points: number; payout_method: string; payout_details: string; status: string; created_at: string };
type User = { telegram_id: string; first_name: string; username?: string; points: number; energy: number; taps: number; created_at: string; updated_at: string };
type Ledger = { id: number; telegram_id: string; delta: number; reason: string; created_at: string };
type Dashboard = { stats: { totalUsers: number; totalPoints: number; totalTaps: number; active24h: number; pendingWithdrawals: number }; users: User[]; ledger: Ledger[]; withdrawals: Withdrawal[] };
async function api(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', 'x-telegram-init-data': tg?.initData || '' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
const number = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const date = (value: string) => new Date(value).toLocaleString();
export default function Admin() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<number | null>(null);
  async function refresh() {
    setLoading(true); setError('');
    try { setDashboard(await api('/api/admin/dashboard')); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load admin dashboard'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  async function review(id: number, decision: 'approved' | 'rejected') {
    if (!window.confirm(`${decision === 'approved' ? 'Approve' : 'Reject and refund'} withdrawal #${id}?`)) return;
    setWorking(id); setError('');
    try { await api(`/api/admin/withdrawals/${id}/review`, 'POST', { decision }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Review failed'); }
    finally { setWorking(null); }
  }
  const users = useMemo(() => (dashboard?.users || []).filter(u => {
    const q = query.trim().toLowerCase();
    return !q || u.telegram_id.includes(q) || u.first_name.toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q);
  }), [dashboard, query]);
  const stats = dashboard?.stats;
  const nav: { id: Tab; label: string; icon: string }[] = [
    { id: 'overview', label: 'Overview', icon: '◫' },
    { id: 'users', label: 'Users', icon: '♙' },
    { id: 'withdrawals', label: 'Withdrawals', icon: '↗' },
    { id: 'ledger', label: 'Ledger', icon: '≋' }
  ];
  return <main className="admin-dashboard">
    <header className="admin-header">
      <div className="admin-brand-icon">✦</div>
      <div className="admin-brand"><span>HYPERLIQUID · CONTROL CENTER</span><h1>MINER <b>ADMIN</b></h1></div>
      <div className="admin-secure"><i/> SECURE</div>
    </header>
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <span className="admin-nav-label">WORKSPACE</span>
        {nav.map(n => <button key={n.id} className={tab === n.id ? 'admin-nav active' : 'admin-nav'} onClick={() => setTab(n.id)}><span>{n.icon}</span>{n.label}{n.id === 'withdrawals' && stats?.pendingWithdrawals ? <b>{stats.pendingWithdrawals}</b> : null}</button>)}
        <div className="admin-sidebar-bottom"><span className="admin-live-dot"/> API-connected dashboard <small>Access is controlled by your backend admin ID.</small></div>
      </aside>
      <section className="admin-main">
        <div className="admin-page-head"><div><span className="admin-kicker">ADMINISTRATION / {tab.toUpperCase()}</span><h2>{nav.find(n => n.id === tab)?.label}</h2><p>Manage your Telegram mining app.</p></div><button className="admin-refresh" onClick={() => void refresh()} disabled={loading}>↻ {loading ? 'Refreshing…' : 'Refresh data'}</button></div>
        {error && <div className="admin-error" role="alert"><b>Request failed</b><span>{error}</span>{error.includes('Admin access') || error.includes('403') ? <small>Set ADMIN_TELEGRAM_IDS on the API to your numeric Telegram ID, then restart the backend and reopen this page inside Telegram.</small> : null}</div>}
        {loading && !dashboard ? <div className="admin-empty">Loading secure dashboard…</div> : !dashboard ? <div className="admin-empty">Dashboard data is unavailable. Check the API and your admin access.</div> : <>
          {tab === 'overview' && <>
            <div className="admin-stat-grid">
              <article className="admin-stat"><span>REGISTERED USERS</span><strong>{number(stats!.totalUsers)}</strong><small>All accounts</small><i>♙</i></article>
              <article className="admin-stat"><span>VIRTUAL POINTS</span><strong>{number(stats!.totalPoints)}</strong><small>Current user balances</small><i>◈</i></article>
              <article className="admin-stat"><span>TOTAL TAPS</span><strong>{number(stats!.totalTaps)}</strong><small>Lifetime mining taps</small><i>✦</i></article>
              <article className="admin-stat"><span>ACTIVE · 24H</span><strong>{number(stats!.active24h)}</strong><small>Updated in last 24 hours</small><i>⌁</i></article>
            </div>
            <div className="admin-section-head"><div><h3>Pending withdrawals</h3><p>Review requests before manually paying.</p></div><button onClick={() => setTab('withdrawals')}>View all →</button></div>
            {dashboard.withdrawals.length === 0 ? <div className="admin-empty">No pending withdrawals.</div> : dashboard.withdrawals.slice(0,4).map(item => <WithdrawalCard key={item.id} item={item} working={working === item.id} onReview={review}/>)}
            <div className="admin-section-head"><div><h3>Recent activity</h3><p>Latest points ledger entries.</p></div><button onClick={() => setTab('ledger')}>Open ledger →</button></div>
            <LedgerTable entries={dashboard.ledger.slice(0,6)}/>
          </>}
          {tab === 'users' && <>
            <div className="admin-section-head"><div><h3>User directory</h3><p>Latest 100 recently updated accounts.</p></div><span className="admin-count">{users.length} shown</span></div>
            <input className="admin-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, username, or Telegram ID…"/>
            <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>USER</th><th>TELEGRAM ID</th><th>POINTS</th><th>ENERGY</th><th>TAPS</th><th>LAST UPDATED</th></tr></thead><tbody>{users.map(u => <tr key={u.telegram_id}><td><b>{u.first_name}</b><small>{u.username ? '@'+u.username : 'No username'}</small></td><td>{u.telegram_id}</td><td className="admin-positive">{number(u.points)}</td><td>{number(u.energy)}/1000</td><td>{number(u.taps)}</td><td>{date(u.updated_at)}</td></tr>)}</tbody></table>{users.length === 0 && <div className="admin-empty">No users match that search.</div>}</div>
          </>}
          {tab === 'withdrawals' && <>
            <div className="admin-section-head"><div><h3>Withdrawal queue</h3><p>Approving does not automatically transfer funds.</p></div><span className="admin-count">{dashboard.withdrawals.length} pending</span></div>
            {dashboard.withdrawals.length === 0 ? <div className="admin-empty">No pending withdrawals. You're all caught up.</div> : dashboard.withdrawals.map(item => <WithdrawalCard key={item.id} item={item} working={working === item.id} onReview={review}/>)}
            <p className="admin-warning">Verify payout details and complete payments manually. Rejecting refunds points to the user's balance.</p>
          </>}
          {tab === 'ledger' && <>
            <div className="admin-section-head"><div><h3>Points ledger</h3><p>Latest 50 point changes from the database.</p></div><span className="admin-count">{dashboard.ledger.length} entries</span></div>
            <LedgerTable entries={dashboard.ledger}/>
          </>}
        </>}
      </section>
    </div>
  </main>;
}
function WithdrawalCard({ item, working, onReview }: { item: Withdrawal; working: boolean; onReview: (id: number, decision: 'approved' | 'rejected') => void }) {
  return <article className="admin-withdrawal"><div className="admin-withdrawal-top"><div><span>REQUEST #{item.id}</span><h3>{number(item.points)} pts</h3></div><b className="admin-pending">PENDING</b></div><div className="admin-withdrawal-grid"><div><small>TELEGRAM ID</small><b>{item.telegram_id}</b></div><div><small>METHOD</small><b>{item.payout_method}</b></div><div className="admin-payout"><small>PAYOUT DETAILS</small><b>{item.payout_details}</b></div><div><small>REQUESTED</small><b>{date(item.created_at)}</b></div></div><div className="admin-review-actions"><button disabled={working} className="admin-reject" onClick={() => onReview(item.id,'rejected')}>{working ? 'Saving…' : 'Reject & refund'}</button><button disabled={working} className="admin-approve" onClick={() => onReview(item.id,'approved')}>{working ? 'Saving…' : 'Approve request'}</button></div></article>;
}
function LedgerTable({ entries }: { entries: Ledger[] }) {
  return <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>ENTRY</th><th>USER ID</th><th>CHANGE</th><th>REASON</th><th>DATE</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id}><td>#{entry.id}</td><td>{entry.telegram_id}</td><td className={entry.delta >= 0 ? 'admin-positive' : 'admin-negative'}>{entry.delta > 0 ? '+' : ''}{number(entry.delta)}</td><td>{entry.reason}</td><td>{date(entry.created_at)}</td></tr>)}</tbody></table>{entries.length === 0 && <div className="admin-empty">No ledger entries yet.</div>}</div>;
}
