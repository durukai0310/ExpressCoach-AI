import { useState, useRef, useEffect } from 'react';
import { api } from '../utils/api';
import { trackEvent } from '../utils/tracker';

const MODES = [
  { key: 'free', label: '自由模式', desc: '随意对话，教练不干预' },
  { key: 'guided', label: '引导模式', desc: '教练在关键节点给出建议' },
  { key: 'stress', label: '压力模式', desc: '对方会刁难你，锻炼应对能力' },
];
const PERSONALITIES = [
  { key: 'friendly', label: '友善' },
  { key: 'hostile', label: '刁难' },
  { key: 'avoidant', label: '回避' },
];

export default function Sandbox() {
  const [phase, setPhase] = useState('setup'); // setup | active | ended
  const [scenario, setScenario] = useState('催同事交报告');
  const [mode, setMode] = useState('guided');
  const [personality, setPersonality] = useState('friendly');
  const [sessionId, setSessionId] = useState(null);
  const [round, setRound] = useState(0);
  const [maxRounds, setMaxRounds] = useState(5);
  const [messages, setMessages] = useState([]);
  const [coachHint, setCoachHint] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const startSession = async () => {
    if (!scenario.trim()) return;
    trackEvent('click', '/sandbox', 'start-session');
    try {
      const data = await api.post('/sandbox/start', { scenario: scenario.trim(), mode, personality });
      setSessionId(data.sessionId);
      setMaxRounds(data.maxRounds || 5);
      setMessages([{ sender: 'simulator', content: data.opening }]);
      setRound(1);
      setPhase('active');
    } catch (err) { alert('启动失败：' + err.message); }
  };

  const sendMessage = async () => {
    const text = inputValue.trim();
    if (!text || !sessionId) return;
    setInputValue('');
    setMessages(prev => [...prev, { sender: 'user', content: text }]);
    setSending(true);
    setCoachHint(null);
    trackEvent('click', '/sandbox', 'send-message');

    try {
      const data = await api.post(`/sandbox/${sessionId}/message`, { message: text });
      setMessages(prev => [...prev, { sender: 'simulator', content: data.simulatorReply }]);
      setRound(data.round);
      if (data.coachIntervention?.should) {
        setCoachHint(data.coachIntervention);
      }
      if (data.isFinished) {
        setPhase('ended');
      }
    } catch (err) {
      setMessages(prev => [...prev, { sender: 'coach', content: '错误：' + err.message }]);
    } finally {
      setSending(false);
    }
  };

  const endSession = async () => {
    if (sessionId) {
      try { await api.delete(`/sandbox/${sessionId}`); } catch (e) {}
    }
    setPhase('setup'); setSessionId(null); setMessages([]); setRound(0); setCoachHint(null);
  };

  if (phase === 'setup') {
    return (
      <div>
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.75rem', fontWeight: 700, marginBottom: 4 }}>对话练习</h1>
          <p style={{ color: 'var(--color-text-light)', margin: 0 }}>在安全环境中练习社交对话，AI 教练实时指导</p>
        </div>

        <div className="card">
          <div className="card-title">练习设置</div>
          <div style={{ marginBottom: 14 }}>
            <textarea className="form-input" rows={2} style={{ fontSize: '1rem' }}
              value={scenario} onChange={e => setScenario(e.target.value)}
              placeholder="输入练习场景，例如：催同事交报告" />
          </div>

          <div style={{ marginBottom: 14 }}>
            <div className="form-label">练习模式</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {MODES.map(m => (
                <div key={m.key} className={`form-option ${mode === m.key ? 'selected' : ''}`}
                  style={{ flex: 1, flexDirection: 'column', alignItems: 'flex-start', padding: '10px 14px' }}
                  onClick={() => setMode(m.key)}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{m.label}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-lighter)' }}>{m.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div className="form-label">对方性格</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {PERSONALITIES.map(p => (
                <div key={p.key} className={`form-option ${personality === p.key ? 'selected' : ''}`}
                  style={{ flex: 1, textAlign: 'center' }}
                  onClick={() => setPersonality(p.key)}>
                  {p.label}
                </div>
              ))}
            </div>
          </div>

          <button className="btn btn-primary btn-lg" onClick={startSession} style={{ width: '100%' }} data-track="start-sandbox">
            开始练习
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>对话练习</h1>
          <p style={{ color: 'var(--color-text-light)', fontSize: '0.85rem', margin: 0 }}>{scenario} · 第 {round}/{maxRounds} 轮</p>
        </div>
        <button className="btn btn-sm btn-outline" onClick={endSession} data-track="end-sandbox">结束练习</button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: 20, maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.map((msg, i) => (
            <div key={i} style={{
              maxWidth: '80%', padding: '10px 14px', borderRadius: 8, fontSize: '0.9rem', lineHeight: 1.6,
              alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
              background: msg.sender === 'user' ? 'var(--color-primary)' : msg.sender === 'coach' ? '#fef9e7' : 'var(--color-bg)',
              color: msg.sender === 'user' ? '#fff' : 'var(--color-text)',
              border: msg.sender === 'coach' ? '1px solid #f9e79f' : '1px solid var(--color-border-light)',
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, opacity: 0.7 }}>
                {msg.sender === 'user' ? '你' : msg.sender === 'coach' ? '教练' : '对方'}
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
            </div>
          ))}
          {sending && <div className="loading" style={{ padding: 8 }}><div className="spinner" style={{ width: 18, height: 18 }}></div></div>}
          <div ref={chatEndRef} />
        </div>

        {coachHint && (
          <div style={{ margin: '0 20px 12px', padding: '10px 14px', background: '#fef9e7', borderLeft: '3px solid #f9e79f', borderRadius: 4, fontSize: '0.85rem' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>教练提示 · {coachHint.reason}</div>
            <div>{coachHint.suggestion}</div>
            {coachHint.example && <div style={{ marginTop: 4, fontSize: '0.8rem', opacity: 0.8 }}>示例：{coachHint.example}</div>}
          </div>
        )}

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--color-border)', display: 'flex', gap: 8 }}>
          <input type="text" className="form-input" style={{ flex: 1, borderRadius: 'var(--radius-full)' }}
            value={inputValue} onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') sendMessage(); }}
            placeholder={phase === 'ended' ? '练习已结束' : '输入你的回复...'}
            disabled={sending || phase === 'ended'} />
          <button className="btn btn-primary" onClick={sendMessage} disabled={sending || phase === 'ended' || !inputValue.trim()} data-track="sandbox-send">
            {sending ? '...' : '发送'}
          </button>
        </div>
      </div>

      {phase === 'ended' && (
        <div className="card" style={{ marginTop: 16, textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: '3rem', marginBottom: 16 }}>🎉</div>
          <h2>练习完成</h2>
          <p style={{ color: 'var(--color-text-light)', marginBottom: 20 }}>共 {round} 轮对话，点击下方按钮开始新练习</p>
          <button className="btn btn-primary btn-lg" onClick={endSession} data-track="new-sandbox">开始新练习</button>
        </div>
      )}
    </div>
  );
}
