import { useEffect, useState } from 'react';
const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
type Withdrawal = { id: number; telegram_id: string; points: number; payout_method: string; payout_details: string; status: string; created_at: string };
const tg = (window as any).Telegram?.WebApp;
async function api(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', 'x-telegram-init-data': tg?.initData || '' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
export default function Admin() {
  const [items, setItems] = useState<Withdrawal[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<number | null>(null);
  async function refresh() {
    setLoading(true); setError('');
    try { const data = await api('/api/admin/withdrawals'); setItems(data.withdrawals); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load requests'); }
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
  return <main className="shell admin-shell">
    <header className="topbar"><div className="brandmark">✦</div><div><div className="eyebrow">TELEGRAM MINI APP</div><h1>NEON <span>ADMIN</span></h1></div><div className="online"><i/> SECURE</div></header>
    <section className="welcome"><div><p className="eyebrow">CONTROL CENTER</p><h2>Withdrawals</h2><p className="muted">Review pending payout requests.</p></div><button className="refresh" onClick={() => void refresh()}>↻ Refresh</button></section>
    <div className="admin-stats panel"><span className="eyebrow">PENDING REQUESTS</span><strong>{items.length}</strong><small>Requests awaiting a decision</small></div>
    {error && <div className="notice" role="alert">{error}</div>}
    {loading ? <div className="empty panel">Loading requests…</div> : items.length === 0 ? <div className="empty panel">No pending withdrawals. You're all caught up.</div> : items.map(item => <article className="withdrawal panel" key={item.id}>
      <div className="withdrawal-head"><div><span className="eyebrow">REQUEST #{item.id}</span><h3>{item.points.toLocaleString()} pts</h3></div><span className="pill">PENDING</span></div>
      <div className="withdrawal-detail"><span>Telegram ID</span><strong>{item.telegram_id}</strong></div>
      <div className="withdrawal-detail"><span>Method</span><strong>{item.payout_method}</strong></div>
      <div className="withdrawal-detail"><span>Payout details</span><strong>{item.payout_details}</strong></div>
      <div className="withdrawal-detail"><span>Requested</span><strong>{new Date(item.created_at).toLocaleString()}</strong></div>
      <div className="review-actions"><button disabled={working === item.id} onClick={() => void review(item.id, 'rejected')} className="reject">Reject & refund</button><button disabled={working === item.id} onClick={() => void review(item.id, 'approved')} className="approve">{working === item.id ? 'Saving…' : 'Approve'}</button></div>
    </article>)}
    <p className="admin-warning">Approval only changes the request status. It does not send money automatically. Verify payout details and fulfil payments manually.</p>
  </main>;
}
