import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

const API = import.meta.env.VITE_API_URL || '';
type Summary = {
  network: string; chainId: number; configured: boolean; qrDataUrl?: string | null; configurationMessage?: string; treasuryAddress: string | null; usdcEnabled: boolean; confirmationsRequired: number; withdrawalFeeEth: string; minimumWithdrawalEth: string;
  wallet: { address: string; verifiedAt: string } | null;
  balances: { asset: string; balance: string }[];
  deposits: { txHash: string; asset: string; amount: string; confirmations: number; created_at: string }[];
  withdrawals: { id: number; asset: string; amount: string; destination_address: string; status: string; txHash: string | null; created_at: string }[];
};
type Props = { initData: string; isTelegram: boolean; onBalanceChange?: (balance: string) => void; action?: 'deposit' | 'withdraw' | null; onActionChange?: (action: 'deposit' | 'withdraw' | null) => void };
async function api(path: string, initData: string, method = 'GET', body?: unknown) {
  const response = await fetch(API + path, { method, headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
export default function CryptoWallet({ initData, isTelegram, onBalanceChange, action = null, onActionChange }: Props) {
  const [data, setData] = useState<Summary | null>(null);
  const [txHash, setTxHash] = useState('');
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [depositSeconds, setDepositSeconds] = useState(15 * 60);
  async function refresh() {
    setError('');
    try {
      const endpoint = isTelegram ? '/api/crypto/summary' : '/api/crypto/public-config';
      const summary = await api(endpoint, initData) as Summary;
      setData(summary);
      onBalanceChange?.(summary.balances.find(b => b.asset === 'ETH')?.balance || '0');
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load crypto wallet'); }
  }
  useEffect(() => { void refresh(); }, [initData, isTelegram, onBalanceChange]);
  useEffect(() => {
    if (action !== 'deposit') return;
    setDepositSeconds(15 * 60);
    const timer = window.setInterval(() => setDepositSeconds(seconds => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [action]);
  useEffect(() => {
    if (!data?.treasuryAddress) { setQrCode(''); return; }
    if (data.qrDataUrl) { setQrCode(data.qrDataUrl); return; }
    QRCode.toDataURL(`ethereum:${data.treasuryAddress}`, { width: 220, margin: 1, errorCorrectionLevel: 'M' }).then(setQrCode).catch(() => setQrCode(''));
  }, [data?.treasuryAddress, data?.qrDataUrl]);
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
      const result = await api('/api/crypto/deposits/verify', initData, 'POST', { asset: 'ETH', txHash: txHash.trim() });
      setTxHash(''); await refresh(); setMessage('Credited ' + result.amount + ' ' + result.asset + ' after ' + result.confirmations + ' confirmations.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Deposit verification failed'); }
    finally { setBusy(false); }
  }
  async function withdraw() {
    if (!isTelegram) { setError('Open the Mini App inside Telegram to request a real Hyperliquid withdrawal.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      await api('/api/crypto/withdrawals', initData, 'POST', { asset: 'ETH', amount: amount.trim(), destination: destination.trim() });
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
  const depositCountdown = `${String(Math.floor(depositSeconds / 60)).padStart(2, '0')}:${String(depositSeconds % 60).padStart(2, '0')}`;
  const withdrawalFee = data?.withdrawalFeeEth || '0.02';
  const totalDebit = amount && Number.isFinite(Number(amount)) ? (Number(amount) + Number(withdrawalFee)).toFixed(6) : '—';
  return <section className="crypto-wallet">
    <h1 className="page-heading">ETH Wallet</h1>
    <section className="wallet-balance glass-card crypto-network-card"><label>NETWORK</label><strong>Ethereum <span>MAINNET</span></strong><small>ETH deposits · Hyperliquid-only ETH withdrawals · 12 confirmations</small><button className="crypto-refresh" onClick={() => void refresh()}>↻ Refresh wallet</button></section>
    <section className="glass-card crypto-connect-card">
      <div className="crypto-card-heading"><div><label>EXTERNAL WALLET</label><h3>{data?.wallet ? 'Wallet connected' : 'Connect your wallet'}</h3></div><div className="crypto-coin-icon">Ξ</div></div>
      {data?.wallet ? <><div className="crypto-address">{data.wallet.address}</div><p className="crypto-hint">Verified by signature. Private keys stay in your wallet and are never sent to this app.</p><button className="secondary-btn full-btn" disabled={busy} onClick={disconnect}>Disconnect wallet</button></> : <><p className="crypto-hint">Connect MetaMask or another injected Ethereum wallet. Sign a one-time message; it does not send a transaction or spend gas.</p><button className="blue-btn full-btn" disabled={busy} onClick={connect}>{busy ? 'Connecting…' : 'Connect Ethereum wallet'}</button></>}
    </section>
    <section className="crypto-balances crypto-balances-single">
      <div className="crypto-balance-card glass-card"><span className="crypto-asset-icon">Ξ</span><small>ETH BALANCE</small><strong>{balance('ETH')}</strong><span>Ethereum Mainnet</span></div>
    </section>
    {data?.treasuryAddress ? <section className="glass-card crypto-deposit-card"><label>DEPOSIT ADDRESS · ETHEREUM MAINNET</label><div className="crypto-qr-wrap">{qrCode && <img className="crypto-qr" src={qrCode} alt="ETH deposit QR code" />}</div><div className="crypto-address">{data.treasuryAddress}</div><button className="secondary-btn full-btn" onClick={() => void copyAddress()}>Copy deposit address</button><p className="crypto-hint">Send ETH on Ethereum Mainnet from your linked wallet only. Verify deposits after sending. Credits require {data.confirmationsRequired} confirmations. Never send other tokens or use another network; transfers may be irreversible.</p></section> : <div className="crypto-config-warning"><b>Deposit address unavailable.</b><span>Set ETHEREUM_DEPOSIT_ADDRESS on the backend. RPC is only needed to verify transactions.</span></div>}
    {action === 'deposit' && <section id="eth-deposit-form" className="glass-card withdraw-form crypto-form payment-gateway"><div className="crypto-form-title"><div><span className="payment-kicker">ETHEREUM MAINNET · PAYMENT</span><h3>ETH Deposit</h3></div><button aria-label="Close deposit" onClick={() => onActionChange?.(null)}>×</button></div><div className="payment-status"><span><i /> Awaiting payment · not credited</span><b>Expires {depositCountdown}</b></div><p>Send only Ethereum (ETH) to this verified address. Your balance changes only after the backend verifies the transaction.</p>{data?.treasuryAddress ? <><div className="payment-qr"><img src={qrCode} alt="ETH deposit QR code" /></div><label>DEPOSIT ADDRESS</label><div className="crypto-address">{data.treasuryAddress}</div><button className="secondary-btn full-btn" onClick={() => void copyAddress()}>Copy address</button></> : <div className="crypto-config-warning"><b>Deposit address unavailable</b><span>Set ETHEREUM_DEPOSIT_ADDRESS on the backend.</span></div>}<div className="crypto-fixed-asset">ASSET <strong>ETH</strong></div><label htmlFor="crypto-deposit-hash">Transaction hash after sending</label><input id="crypto-deposit-hash" autoComplete="off" placeholder="0x…" value={txHash} onChange={e => setTxHash(e.target.value)} /><button className="blue-btn full-btn" disabled={busy || !isTelegram || !data?.wallet || !data?.configured || !txHash.trim()} onClick={verifyDeposit}>{busy ? 'Checking blockchain…' : 'I sent ETH · Verify deposit'}</button><small className="payment-note">No simulated payment is created. Verification requires a mined Ethereum transaction and the configured confirmation count.</small></section>}
    {action === 'withdraw' && <section id="eth-withdraw-form" className="glass-card withdraw-form crypto-form"><div className="crypto-form-title"><h3>ETH Withdrawal</h3><button aria-label="Close withdrawal" onClick={() => onActionChange?.(null)}>×</button></div><p>Withdraw ETH to your Hyperliquid Ethereum address. No external wallet connection is required for the request. Admin approval and a verified manual payout are required.</p><div className="crypto-config-warning"><b>Fee: {data?.withdrawalFeeEth || '0.02'} ETH · Minimum: {data?.minimumWithdrawalEth || '0.02'} ETH</b><span>Pay the network fee first: {withdrawalFee} ETH is reserved immediately with this request. Total debited: {totalDebit} ETH.</span></div><div className="crypto-fixed-asset">ASSET <strong>ETH</strong></div><label htmlFor="crypto-withdraw-amount">Amount</label><input id="crypto-withdraw-amount" inputMode="decimal" placeholder={data?.minimumWithdrawalEth || '0.02'} value={amount} onChange={e => setAmount(e.target.value)} /><label htmlFor="crypto-withdraw-address">Hyperliquid ETH address</label><input id="crypto-withdraw-address" autoComplete="off" placeholder="0x…" value={destination} onChange={e => setDestination(e.target.value)} /><div className="crypto-withdraw-total"><span>Requested payout</span><b>{amount || '0'} ETH</b><span>Network fee</span><b>{withdrawalFee} ETH</b><span>Total debit</span><b>{totalDebit} ETH</b></div><button className="blue-btn full-btn" disabled={busy || !amount.trim() || !destination.trim()} onClick={withdraw}>{busy ? 'Submitting…' : 'Withdraw to Hyperliquid'}</button></section>}
    <section id="eth-history" className="glass-card crypto-history"><h3>Recent crypto activity</h3>{!data || (!data.deposits.length && !data.withdrawals.length) ? <p className="crypto-hint">No crypto transactions yet.</p> : <>{data.deposits.map(d => <div className="crypto-history-row" key={d.txHash}><div><b>Deposit · {d.asset}</b><small>{d.txHash.slice(0, 12)}… · {d.confirmations} confirmations</small></div><strong>+{d.amount}</strong></div>)}{data.withdrawals.map(w => <div className="crypto-history-row" key={w.id}><div><b>Withdrawal · {w.asset}</b><small>{w.status.toUpperCase()} · {w.txHash ? w.txHash.slice(0, 12) + '…' : 'Awaiting review'}</small></div><strong>-{w.amount}</strong></div>)}</>}</section>
    {(error || message) && <div className={error ? 'crypto-error' : 'crypto-success'} role="status"><span>{error || message}</span><button onClick={() => { setError(''); setMessage(''); }}>×</button></div>}
    <p className="task-disclaimer">Crypto balances are separate from mining points. This is an in-app ledger, not a newly generated personal blockchain wallet. ETH deposits are verified on Ethereum Mainnet; withdrawals are manually sent only to the Hyperliquid ETH destination entered by the user. On-chain transfers are irreversible.</p>
  </section>;
}
