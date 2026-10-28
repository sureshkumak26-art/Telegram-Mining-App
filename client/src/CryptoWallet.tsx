import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
type Summary = {
  network: string; chainId: number; configured: boolean; treasuryAddress: string | null; usdcEnabled: boolean; confirmationsRequired: number;
  wallet: { address: string; verifiedAt: string } | null;
  balances: { asset: string; balance: string }[];
  deposits: { txHash: string; asset: string; amount: string; confirmations: number; created_at: string }[];
  withdrawals: { id: number; asset: string; amount: string; destination_address: string; status: string; txHash: string | null; created_at: string }[];
};
type Props = { initData: string; isTelegram: boolean };
async function api(path: string, initData: string, method = 'GET', body?: unknown) {
  const response = await fetch(API + path, { method, headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
export default function CryptoWallet({ initData, isTelegram }: Props) {
  const [data, setData] = useState<Summary | null>(null);
  const [asset, setAsset] = useState('ETH');
  const [txHash, setTxHash] = useState('');
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function refresh() {
    if (!isTelegram) { setError('Open this Mini App inside Telegram to use authenticated crypto features.'); return; }
    setError('');
    try { setData(await api('/api/crypto/summary', initData)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load crypto wallet'); }
  }
  useEffect(() => { void refresh(); }, [initData, isTelegram]);
  async function connect() {
    if (!isTelegram) { setError('Open the Mini App inside Telegram to link a wallet.'); return; }
    const eth = (window as any).ethereum;
    if (!eth?.request) { setError('No injected Ethereum wallet found. Open this page in MetaMask or another browser with an Ethereum wallet provider.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const accounts = await eth.request({ method: 'eth_requestAccounts' }) as string[];
      const address = accounts?.[0];
      if (!address) throw new Error('No wallet account selected.');
      let chain = String(await eth.request({ method: 'eth_chainId' })).toLowerCase();
      if (chain !== '0x1') {
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] });
        chain = String(await eth.request({ method: 'eth_chainId' })).toLowerCase();
      }
      if (chain !== '0x1') throw new Error('Switch your wallet to Ethereum Mainnet.');
      const challenge = await api('/api/crypto/challenge', initData, 'POST', { address });
      const signature = await eth.request({ method: 'personal_sign', params: [challenge.message, address] });
      await api('/api/crypto/connect', initData, 'POST', { challengeId: challenge.challengeId, signature });
      await refresh(); setMessage('Wallet linked. Signature verified on the server.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Wallet connection failed'); }
    finally { setBusy(false); }
  }
  async function verifyDeposit() {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api('/api/crypto/deposits/verify', initData, 'POST', { asset, txHash: txHash.trim() });
      setTxHash(''); await refresh(); setMessage('Credited ' + result.amount + ' ' + result.asset + ' after ' + result.confirmations + ' confirmations.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Deposit verification failed'); }
    finally { setBusy(false); }
  }
  async function withdraw() {
    setBusy(true); setError(''); setMessage('');
    try {
      await api('/api/crypto/withdrawals', initData, 'POST', { asset, amount: amount.trim(), destination: destination.trim() });
      setAmount(''); await refresh(); setMessage('Withdrawal request submitted for admin review. Payout is not automatic.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Withdrawal request failed'); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true);
    try { await api('/api/crypto/disconnect', initData, 'POST'); await refresh(); setMessage('Wallet disconnected. Internal balances remain in your account.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not disconnect wallet'); }
    finally { setBusy(false); }
  }
  async function copyAddress() {
    if (!data?.treasuryAddress) return;
    try { await navigator.clipboard.writeText(data.treasuryAddress); setMessage('Deposit address copied.'); }
    catch { setError('Could not copy address.'); }
  }
  const balance = (symbol: string) => data?.balances.find(b => b.asset === symbol)?.balance || '0';
  return <section className="crypto-wallet">
    <h1 className="page-heading">Ethereum Crypto Wallet</h1>
    <section className="wallet-balance glass-card crypto-network-card"><label>NETWORK</label><strong>Ethereum <span>MAINNET</span></strong><small>ETH · USDC · 12 confirmations required</small><button className="crypto-refresh" onClick={() => void refresh()}>↻ Refresh wallet</button></section>
    <section className="glass-card crypto-connect-card">
      <div className="crypto-card-heading"><div><label>EXTERNAL WALLET</label><h3>{data?.wallet ? 'Wallet connected' : 'Connect your wallet'}</h3></div><div className="crypto-coin-icon">Ξ</div></div>
      {data?.wallet ? <><div className="crypto-address">{data.wallet.address}</div><p className="crypto-hint">Verified by signature. Private keys stay in your wallet and are never sent to this app.</p><button className="secondary-btn full-btn" disabled={busy} onClick={disconnect}>Disconnect wallet</button></> : <><p className="crypto-hint">Connect MetaMask or another injected Ethereum wallet. Sign a one-time message; it does not send a transaction or spend gas.</p><button className="blue-btn full-btn" disabled={busy} onClick={connect}>{busy ? 'Connecting…' : 'Connect Ethereum wallet'}</button></>}
    </section>
    <section className="crypto-balances">
      <div className="crypto-balance-card glass-card"><span className="crypto-asset-icon">Ξ</span><small>ETH BALANCE</small><strong>{balance('ETH')}</strong><span>Ethereum</span></div>
      <div className="crypto-balance-card glass-card"><span className="crypto-asset-icon">$</span><small>USDC BALANCE</small><strong>{balance('USDC')}</strong><span>USD Coin</span></div>
    </section>
    {data?.treasuryAddress ? <section className="glass-card crypto-deposit-card"><label>DEPOSIT ADDRESS · ETHEREUM MAINNET</label><div className="crypto-address">{data.treasuryAddress}</div><button className="secondary-btn full-btn" onClick={() => void copyAddress()}>Copy deposit address</button><p className="crypto-hint">Only send ETH or the configured USDC token from your linked wallet. Verify deposits after sending. Credits require {data.confirmationsRequired} confirmations. Never send other tokens or use another network; transfers may be irreversible.</p></section> : <div className="crypto-config-warning"><b>Deposits are not configured.</b><span>The server owner must set ETHEREUM_RPC_URL and ETHEREUM_TREASURY_ADDRESS before deposits can be accepted.</span></div>}
    <section className="glass-card withdraw-form crypto-form"><h3>Verify a deposit</h3><p>The backend checks the Ethereum receipt, sender, destination, token contract, amount and confirmations. A transaction hash can only be credited once.</p><label htmlFor="crypto-deposit-asset">Asset</label><select id="crypto-deposit-asset" value={asset} onChange={e => setAsset(e.target.value)}><option value="ETH">ETH</option><option value="USDC" disabled={!data?.usdcEnabled}>USDC{!data?.usdcEnabled ? ' (not configured)' : ''}</option></select><label htmlFor="crypto-deposit-hash">Transaction hash</label><input id="crypto-deposit-hash" autoComplete="off" placeholder="0x…" value={txHash} onChange={e => setTxHash(e.target.value)} /><button className="blue-btn full-btn" disabled={busy || !data?.wallet || !data?.configured || !txHash.trim()} onClick={verifyDeposit}>{busy ? 'Verifying…' : 'Verify & credit deposit'}</button></section>
    <section className="glass-card withdraw-form crypto-form"><h3>Request crypto withdrawal</h3><p>Funds are reserved from your internal balance. Admin approval and a manually sent payout are required.</p><label htmlFor="crypto-withdraw-asset">Asset</label><select id="crypto-withdraw-asset" value={asset} onChange={e => setAsset(e.target.value)}><option value="ETH">ETH</option><option value="USDC" disabled={!data?.usdcEnabled}>USDC{!data?.usdcEnabled ? ' (not configured)' : ''}</option></select><label htmlFor="crypto-withdraw-amount">Amount</label><input id="crypto-withdraw-amount" inputMode="decimal" placeholder={asset === 'ETH' ? '0.01' : '10.00'} value={amount} onChange={e => setAmount(e.target.value)} /><label htmlFor="crypto-withdraw-address">Destination address</label><input id="crypto-withdraw-address" autoComplete="off" placeholder="0x…" value={destination} onChange={e => setDestination(e.target.value)} /><button className="blue-btn full-btn" disabled={busy || !data?.wallet || !amount.trim() || !destination.trim()} onClick={withdraw}>{busy ? 'Submitting…' : 'Request withdrawal'}</button></section>
    <section className="glass-card crypto-history"><h3>Recent crypto activity</h3>{!data || (!data.deposits.length && !data.withdrawals.length) ? <p className="crypto-hint">No crypto transactions yet.</p> : <>{data.deposits.map(d => <div className="crypto-history-row" key={d.txHash}><div><b>Deposit · {d.asset}</b><small>{d.txHash.slice(0, 12)}… · {d.confirmations} confirmations</small></div><strong>+{d.amount}</strong></div>)}{data.withdrawals.map(w => <div className="crypto-history-row" key={w.id}><div><b>Withdrawal · {w.asset}</b><small>{w.status.toUpperCase()} · {w.txHash ? w.txHash.slice(0, 12) + '…' : 'Awaiting review'}</small></div><strong>-{w.amount}</strong></div>)}</>}</section>
    {(error || message) && <div className={error ? 'crypto-error' : 'crypto-success'} role="status"><span>{error || message}</span><button onClick={() => { setError(''); setMessage(''); }}>×</button></div>}
    <p className="task-disclaimer">Crypto balances are separate from mining points. This is an in-app ledger, not a newly generated personal blockchain wallet. Only Ethereum mainnet ETH and the configured USDC contract are supported. On-chain transfers are irreversible.</p>
  </section>;
}
