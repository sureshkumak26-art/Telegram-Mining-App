import { useEffect, useMemo, useState } from 'react';
import { useEffect as useQrEffect, useState as useQrState } from 'react';
import QRCode from 'qrcode';

const API = import.meta.env.VITE_API_URL || '';

type TelegramWebAppAuth = {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
};

function getTelegramInitData(): string {
  // Read WebApp at request time rather than capturing it during module evaluation.
  // This also handles Telegram's script becoming available after the app bundle.
  const webApp = (window as any).Telegram?.WebApp as TelegramWebAppAuth | undefined;
  webApp?.ready?.();
  webApp?.expand?.();
  return typeof webApp?.initData === 'string' ? webApp.initData : '';
}
type Tab = 'overview' | 'users' | 'withdrawals' | 'ledger';
type Withdrawal = { id: number; telegram_id: string; points: number; payout_method: string; payout_details: string; status: string; created_at: string };
type User = { telegram_id: string; first_name: string; username?: string; points: number; energy: number; taps: number; created_at: string; updated_at: string };
type Ledger = { id: number; telegram_id: string; delta: number; reason: string; created_at: string };
type CryptoWithdrawal = { id: number; telegram_id: string; asset: string; amount: string; fee?: string; destination_address: string; status: string; txHash: string | null; created_at: string };
type TaskConfig = { id: string; title: string; description: string; url: string; icon: string; reward: number; enabled: boolean };
type Dashboard = { settings: { ethereumTreasuryAddress: string | null; ethereumDepositQr: string | null; network: string };  cryptoWithdrawals: CryptoWithdrawal[]; stats: { totalUsers: number; totalPoints: number; totalTaps: number; active24h: number; pendingWithdrawals: number; totalDeposits: string; totalWithdrawals: string }; users: User[]; ledger: Ledger[]; withdrawals: Withdrawal[] };
async function api(path: string, method = 'GET', body?: unknown) {
  const initData = getTelegramInitData();
  const browserSession = sessionStorage.getItem('admin-session') || '';
  if (!initData && !browserSession) throw new Error('Please sign in to the admin dashboard.');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (initData) headers['x-telegram-init-data'] = initData;
  if (browserSession) headers['x-admin-session'] = browserSession;
  const response = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function AdminBrowserLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch(`${API}/api/admin/browser/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.token !== 'string') throw new Error(data.error || 'Sign-in failed.');
      sessionStorage.setItem('admin-session', data.token);
      window.location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not sign in.'); }
    finally { setBusy(false); }
  }
  return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, background: '#05090d', color: '#edf7f7', fontFamily: 'Inter,system-ui,sans-serif' }}>
    <form onSubmit={submit} style={{ width: 'min(100%, 390px)', padding: 28, border: '1px solid #1c3935', borderRadius: 18, background: '#091316', boxSizing: 'border-box' }}>
      <div style={{ color: '#4FD2C0', fontSize: 11, letterSpacing: 2, fontWeight: 800 }}>HYPERLIQUID · CONTROL CENTER</div>
      <h1 style={{ margin: '10px 0 6px', fontSize: 27 }}>MINER ADMIN</h1>
      <p style={{ color: '#829b95', fontSize: 12, lineHeight: 1.6, marginBottom: 24 }}>Sign in securely to manage your Telegram Mining App.</p>
      <label style={{ display: 'block', fontSize: 11, color: '#a9c1bb', marginBottom: 7 }}>ADMIN USERNAME</label>
      <input autoComplete="username" required value={username} onChange={e => setUsername(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: 13, marginBottom: 16, borderRadius: 9, border: '1px solid #21423c', background: '#050b0e', color: 'white' }} />
      <label style={{ display: 'block', fontSize: 11, color: '#a9c1bb', marginBottom: 7 }}>PASSWORD</label>
      <input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: 13, marginBottom: 18, borderRadius: 9, border: '1px solid #21423c', background: '#050b0e', color: 'white' }} />
      {error && <p role="alert" style={{ color: '#ffabb1', fontSize: 12 }}>{error}</p>}
      <button disabled={busy} type="submit" style={{ width: '100%', padding: 14, border: 0, borderRadius: 10, background: '#4FD2C0', color: '#041017', fontWeight: 800 }}>{busy ? 'Signing in…' : 'Sign in securely'}</button>
    </form>
  </main>;
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
  const [adminQr, setAdminQr] = useQrState('');
  const [depositAddress, setDepositAddress] = useState('');
  const [manualQr, setManualQr] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);
  const [taskConfigs, setTaskConfigs] = useState<TaskConfig[]>([]);
  const [savingTask, setSavingTask] = useState('');
  const [referralSettings, setReferralSettings] = useState({ enabled: true, reward: 10 });
  const [savingReferral, setSavingReferral] = useState(false);
  const telegramAdmin = Boolean(getTelegramInitData());
  const browserAdmin = Boolean(sessionStorage.getItem('admin-session'));
  async function refresh() {
    setLoading(true); setError('');
    try { setDashboard(await api('/api/admin/dashboard')); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load admin dashboard'); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (!telegramAdmin && !browserAdmin) { setLoading(false); return; } void refresh(); void api('/api/admin/tasks').then(d => setTaskConfigs(d.tasks || [])).catch(() => undefined); void api('/api/admin/referral-settings').then(setReferralSettings).catch(() => undefined); }, []);
  useEffect(() => { if (dashboard?.settings?.ethereumTreasuryAddress) setDepositAddress(dashboard.settings.ethereumTreasuryAddress);
    if (dashboard?.settings?.ethereumDepositQr !== undefined) setManualQr(dashboard.settings.ethereumDepositQr || ''); }, [dashboard?.settings?.ethereumTreasuryAddress]);
  useQrEffect(() => {
    const address = dashboard?.settings.ethereumTreasuryAddress;
    if (!address) { setAdminQr(''); return; }
    if (manualQr) { setAdminQr(manualQr); return; }
    QRCode.toDataURL(`ethereum:${address}`, { width: 220, margin: 1, errorCorrectionLevel: 'M' }).then(setAdminQr).catch(() => setAdminQr(''));
  }, [dashboard?.settings.ethereumTreasuryAddress, manualQr]);
  async function copyDepositAddress() {
    const address = dashboard?.settings?.ethereumTreasuryAddress;
    if (!address) return;
    try { await navigator.clipboard.writeText(address); setError(''); } catch { setError('Could not copy the deposit address.'); }
  }
  function downloadDepositQr() {
    if (!adminQr) return;
    const link = document.createElement('a'); link.href = adminQr; link.download = 'ethereum-deposit-qr.png'; link.click();
  }
  function handleQrUpload(file?: File) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 500000) { setError('Upload a PNG, JPEG, or WebP QR image under 500 KB.'); return; }
    const reader = new FileReader(); reader.onload = () => setManualQr(typeof reader.result === 'string' ? reader.result : ''); reader.readAsDataURL(file);
  }
  async function saveDepositAddress() {
    setSavingAddress(true); setError('');
    try {
      const saved = await api('/api/admin/settings', 'PATCH', { ethereumDepositAddress: depositAddress.trim(), qrDataUrl: manualQr });
      setDashboard(current => current ? { ...current, settings: { ...current.settings, ethereumTreasuryAddress: saved.ethereumDepositAddress, ethereumDepositQr: manualQr || null } } : current);
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save deposit address'); }
    finally { setSavingAddress(false); }
  }
  function handleTaskIconUpload(taskId: string, file?: File) { if (!file) return; if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 250000) { setError('Task icon must be a PNG, JPEG, or WebP image under 250 KB.'); return; } const reader = new FileReader(); reader.onload = () => setTaskConfigs(current => current.map(item => item.id === taskId ? { ...item, icon: typeof reader.result === 'string' ? reader.result : item.icon } : item)); reader.readAsDataURL(file); }
  async function saveReferralSettings() { setSavingReferral(true); setError(''); try { const saved = await api('/api/admin/referral-settings', 'PATCH', referralSettings); setReferralSettings(saved); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save referral settings'); } finally { setSavingReferral(false); } }
  async function saveTask(task: TaskConfig) {
    setSavingTask(task.id); setError('');
    try { const result = await api('/api/admin/tasks/' + task.id, 'PATCH', task); setTaskConfigs(current => current.map(item => item.id === task.id ? result.task : item)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save task settings'); }
    finally { setSavingTask(''); }
  }
  async function reviewCrypto(id: number, decision: 'approved' | 'rejected') {
    if (!window.confirm((decision === 'approved' ? 'Approve' : 'Reject and refund') + ' crypto withdrawal #' + id + '?')) return;
    setWorking(id); setError('');
    try { await api('/api/admin/crypto/withdrawals/' + id + '/review', 'POST', { decision }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Crypto withdrawal review failed'); }
    finally { setWorking(null); }
  }
  async function markCryptoPaid(id: number) {
    const txHash = window.prompt('Enter the outgoing Ethereum transaction hash. The server will verify it on-chain.');
    if (!txHash) return;
    setWorking(id); setError('');
    try { await api('/api/admin/crypto/withdrawals/' + id + '/paid', 'POST', { txHash: txHash.trim() }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not verify payout transaction'); }
    finally { setWorking(null); }
  }
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
  if (!telegramAdmin && !browserAdmin) return <AdminBrowserLogin />;
  return <main className="admin-dashboard">
    <header className="admin-header">
      <div className="admin-brand-icon">✦</div>
      <div className="admin-brand"><span>HYPERLIQUID · CONTROL CENTER</span><h1>MINER <b>ADMIN</b></h1></div>
      <div className="admin-secure"><i/> SECURE</div>{browserAdmin && <button className="admin-refresh" onClick={() => { sessionStorage.removeItem('admin-session'); window.location.reload(); }}>Sign out</button>}
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
            <div className="admin-referral-settings"><div><span className="admin-kicker">REFERRAL PROGRAM</span><h3>Invite rewards</h3><p>Configure the one-time reward paid to the inviter after a new Telegram user joins.</p></div><label className="admin-task-reward">PRIZE<input type="number" min="0" step="0.01" value={referralSettings.reward} onChange={e => setReferralSettings(current => ({ ...current, reward: Number(e.target.value) }))}/><small>points</small></label><label className="admin-task-toggle"><input type="checkbox" checked={referralSettings.enabled} onChange={e => setReferralSettings(current => ({ ...current, enabled: e.target.checked }))}/><span>{referralSettings.enabled ? 'ON' : 'OFF'}</span></label><button className="admin-approve" disabled={savingReferral} onClick={() => void saveReferralSettings()}>{savingReferral ? 'Saving…' : 'Save'}</button></div>
            <div className="admin-task-settings"><div className="admin-section-head"><div><h3>Task rewards</h3><p>Enable missions, change icons, destinations, and point prizes.</p></div><span className="admin-count">{taskConfigs.filter(t => t.enabled).length} enabled</span></div>{taskConfigs.map(task => <div className="admin-task-row" key={task.id}><div className="admin-task-icon-wrap">{task.icon.startsWith('data:image/') || task.icon.startsWith('http') ? <img className="admin-task-icon" src={task.icon} alt="" /> : <span className="admin-task-icon">{task.icon}</span>}<label className="admin-task-upload">Select image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => handleTaskIconUpload(task.id, e.target.files?.[0])}/></label><input className="admin-task-icon-url" value={task.icon.startsWith('http') ? task.icon : ''} aria-label="HTTPS task icon URL" placeholder="or HTTPS icon URL" onChange={e => setTaskConfigs(current => current.map(item => item.id === task.id ? { ...item, icon: e.target.value } : item))}/></div><div className="admin-task-fields"><input className="admin-search" value={task.title} onChange={e => setTaskConfigs(current => current.map(item => item.id === task.id ? { ...item, title: e.target.value } : item))}/><input className="admin-search" value={task.url} onChange={e => setTaskConfigs(current => current.map(item => item.id === task.id ? { ...item, url: e.target.value } : item))}/></div><label className="admin-task-reward">PRIZE<input type="number" min="0" step="0.01" value={task.reward} onChange={e => setTaskConfigs(current => current.map(item => item.id === task.id ? { ...item, reward: Number(e.target.value) } : item))}/><small>points</small></label><label className="admin-task-toggle"><input type="checkbox" checked={task.enabled} onChange={e => setTaskConfigs(current => current.map(item => item.id === task.id ? { ...item, enabled: e.target.checked } : item))}/><span>{task.enabled ? 'ON' : 'OFF'}</span></label><button className="admin-approve" disabled={savingTask === task.id} onClick={() => void saveTask(task)}>{savingTask === task.id ? 'Saving…' : 'Save'}</button></div>)}</div>
            <div className="admin-deposit-settings"><div><span className="admin-kicker">ETHEREUM MAINNET</span><h3>Deposit address</h3><p>Public address used for ETH deposits. Never enter a private key.</p><input className="admin-search" value={depositAddress} onChange={e => setDepositAddress(e.target.value)} placeholder="0x… public Ethereum address" /><label className="admin-upload-label">Manual QR image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => handleQrUpload(e.target.files?.[0])} /></label><div className="admin-setting-actions"><button className="admin-approve admin-save-setting" disabled={savingAddress || !depositAddress.trim()} onClick={() => void saveDepositAddress()}>{savingAddress ? 'Saving…' : 'Save deposit address'}</button><button className="admin-refresh" disabled={!dashboard?.settings?.ethereumTreasuryAddress} onClick={() => void copyDepositAddress()}>Copy address</button><button className="admin-refresh" disabled={!adminQr} onClick={downloadDepositQr}>Download QR</button><button className="admin-refresh" disabled={!dashboard?.settings?.ethereumTreasuryAddress} onClick={() => setDepositAddress('')}>Change QR address</button></div></div>{adminQr ? <img src={adminQr} alt="Ethereum deposit QR code" /> : <span className="admin-qr-empty">QR appears after saving the address.</span>}</div>
            <div className="admin-stat-grid">
              <article className="admin-stat"><span>REGISTERED USERS</span><strong>{number(stats!.totalUsers)}</strong><small>All accounts</small><i>♙</i></article>
              <article className="admin-stat"><span>VIRTUAL POINTS</span><strong>{number(stats!.totalPoints)}</strong><small>Current user balances</small><i>◈</i></article>
              <article className="admin-stat"><span>TOTAL TAPS</span><strong>{number(stats!.totalTaps)}</strong><small>Lifetime mining taps</small><i>✦</i></article>
              <article className="admin-stat"><span>ACTIVE · 24H</span><strong>{number(stats!.active24h)}</strong><small>Updated in last 24 hours</small><i>⌁</i></article><article className="admin-stat"><span>ETH DEPOSITS</span><strong>{stats!.totalDeposits}</strong><small>Verified on-chain</small><i>Ξ</i></article><article className="admin-stat"><span>ETH WITHDRAWALS</span><strong>{stats!.totalWithdrawals}</strong><small>Approved or paid</small><i>↗</i></article>
            </div>
            <div className="admin-section-head"><div><h3>Pending withdrawals</h3><p>Review requests before manually paying.</p></div><button onClick={() => setTab('withdrawals')}>View all →</button></div>
            {dashboard.withdrawals.length === 0 ? <div className="admin-empty">No pending withdrawals.</div> : dashboard.withdrawals.slice(0,4).map(item => <WithdrawalCard key={item.id} item={item} working={working === item.id} onReview={review}/>)}
            <div className="admin-section-head"><div><h3>Crypto withdrawals</h3><p>Approve or reject requests; record a verified payout transaction after sending it.</p></div><span className="admin-count">{dashboard.cryptoWithdrawals.length} open</span></div>
            {dashboard.cryptoWithdrawals.length === 0 ? <div className="admin-empty">No pending crypto withdrawals.</div> : dashboard.cryptoWithdrawals.map(item => <article className="admin-withdrawal" key={'crypto-'+item.id}><div className="admin-withdrawal-top"><div><span>HYPERLIQUID REQUEST #{item.id} · TELEGRAM {item.telegram_id}</span><h3>{item.amount} {item.asset}</h3></div><b className="admin-pending">{item.status.toUpperCase()}</b></div><div className="admin-withdrawal-grid"><div className="admin-payout"><small>HYPERLIQUID DESTINATION</small><b>{item.destination_address}</b></div><div><small>NETWORK FEE</small><b>{item.fee || '0.02'} ETH</b></div><div><small>TOTAL DEBIT</small><b>{(Number(item.amount) + Number(item.fee || '0.02')).toFixed(6)} ETH</b></div><div><small>REQUESTED</small><b>{new Date(item.created_at).toLocaleString()}</b></div></div><div className="admin-review-actions">{item.status === 'pending' ? <><button disabled={working === item.id} className="admin-reject" onClick={() => void reviewCrypto(item.id,'rejected')}>Reject & refund</button><button disabled={working === item.id} className="admin-approve" onClick={() => void reviewCrypto(item.id,'approved')}>Approve request</button></> : <button disabled={working === item.id} className="admin-approve" onClick={() => void markCryptoPaid(item.id)}>{working === item.id ? 'Verifying…' : 'Record payout tx hash'}</button>}</div></article>)}
            <p className="admin-warning">Crypto approvals do not send funds automatically. After manually sending a payout from your treasury, submit its transaction hash; the backend verifies the Ethereum receipt, destination and amount.</p>
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
