import { useState } from 'react';
import { api } from '../utils/api';
import { trackEvent } from '../utils/tracker';

const EXAMPLES = [
  { text: '我想拒绝朋友借钱但不想伤感情', intent: '拒绝' },
  { text: '同事的报告拖了三天了我想催他', intent: '催促' },
  { text: '领导安排不太合理我想提出来', intent: '反馈' },
  { text: '同事总在下班后给我发工作消息', intent: '设边界' },
  { text: '我想向老板请假但不知道怎么开口', intent: '求助' },
];

const ICONS = { mild: { label: '温', bg: '#8a9a7f' }, firm: { label: '定', bg: '#a8907a' }, eq: { label: '衡', bg: '#8a8890' } };

export default function Analyze() {
  const [scenario, setScenario] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const doAnalyze = async () => {
    const text = scenario.trim();
    if (!text) return;
    setLoading(true); setError(null); setResult(null);
    trackEvent('click', '/analyze', 'analyze-btn');
    try {
      const data = await api.post('/analyze', { scenario: text });
      setResult(data);
      trackEvent('analyze_complete', '/analyze');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.75rem', fontWeight: 700, marginBottom: 4 }}>全链路场景分析</h1>
        <p style={{ color: 'var(--color-text-light)', margin: 0 }}>意图识别 → 关系判断 → 三种表达 → 差异度检查</p>
      </div>

      <div className="card">
        <textarea
          className="form-input"
          style={{ border: 'none', fontSize: '1.1rem', padding: '12px 0', background: 'transparent', resize: 'none', borderRadius: 0, borderBottom: '1px solid var(--color-border)' }}
          rows={2}
          value={scenario}
          onChange={e => setScenario(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doAnalyze(); } }}
          placeholder="描述你的社交困境……如：我想拒绝朋友借钱但不想伤感情"
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {EXAMPLES.map((ex, i) => (
              <button key={i} onClick={() => { setScenario(ex.text); setResult(null); }}
                style={{ cursor: 'pointer', border: 'none', fontSize: 12, background: 'var(--color-border-light)', padding: '4px 12px', borderRadius: 'var(--radius-full)', fontFamily: 'inherit', color: 'var(--color-text-light)' }}>
                {ex.intent}
              </button>
            ))}
          </div>
          <button className="btn btn-primary" onClick={doAnalyze} disabled={loading || !scenario.trim()} data-track="analyze-btn">
            {loading ? '分析中...' : '开始分析'}
          </button>
        </div>
      </div>

      {loading && <div className="loading"><div className="spinner"></div> AI 正在分析你的场景...</div>}
      {error && <div className="error-state">分析失败：{error}</div>}

      {result?.errors && result.errors.length > 0 && (
        <div className="card" style={{ marginTop: 16, borderLeft: '3px solid var(--color-secondary)', background: '#fef9e7' }}>
          <div className="card-title" style={{ color: 'var(--color-secondary)' }}>后端错误信息</div>
          {result.errors.map((e, i) => (
            <div key={i} style={{ fontSize: '0.85rem', marginTop: i > 0 ? 8 : 0, color: 'var(--color-text-light)' }}>{e}</div>
          ))}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 16 }}>
          {/* Overview */}
          <div className="card" style={{ marginBottom: 8 }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--color-text-light)' }}>
              总耗时 <strong>{result.timing?.total?.toFixed(1)}s</strong>
              {result.intent && <span> · 意图：<strong>{result.intent.primary}</strong></span>}
              {result.relation && <span> · 关系：<strong>{result.relation.type}</strong></span>}
            </div>
          </div>

          {/* Intent */}
          {result.intent && (
            <div className="card" style={{ marginBottom: 8 }}>
              <div className="card-title">🔍 意图识别</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ padding: '4px 14px', borderRadius: 4, background: '#ede7de', color: '#9b8c78', fontWeight: 700, fontSize: 16 }}>{result.intent.primary}</span>
                {result.intent.secondary?.map((s, i) => <span key={i} className="tag">{s}</span>)}
                <span className="tag" style={{ background: '#f7f0de', color: '#c4a86a' }}>置信度 {(result.intent.confidence * 100).toFixed(0)}%</span>
              </div>
              {result.intent.analysis && <p style={{ marginTop: 8, fontSize: '0.9rem', color: 'var(--color-text-light)' }}>{result.intent.analysis}</p>}
            </div>
          )}

          {/* Relation */}
          {result.relation && (
            <div className="card" style={{ marginBottom: 8 }}>
              <div className="card-title">👥 关系判断</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ padding: '4px 14px', borderRadius: 4, background: '#eceaed', color: '#8a8890', fontWeight: 600 }}>{result.relation.type}</span>
                {result.relation.intimacy && <span className="tag">亲密 {result.relation.intimacy}</span>}
                {result.relation.power && <span className="tag">权力 {result.relation.power}</span>}
                {result.relation.interest && <span className="tag">利益 {result.relation.interest}</span>}
                {result.relation.sensitivity && <span className="tag" style={{ background: '#f5e8e5', color: '#b8847c' }}>敏感 {result.relation.sensitivity}</span>}
              </div>
              {result.relation.strategy && <p style={{ marginTop: 8, fontSize: '0.9rem', color: 'var(--color-primary)' }}>策略：{result.relation.strategy}</p>}
              {result.relation.caution && <p style={{ marginTop: 4, fontSize: '0.85rem', color: 'var(--color-secondary)' }}>注意：{result.relation.caution}</p>}
            </div>
          )}

          {/* Three Versions */}
          {result.versions?.length > 0 && (
            <div className="card" style={{ marginBottom: 8 }}>
              <div className="card-title">📝 三种表达方案</div>
              <div className="version-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                {result.versions.map(v => {
                  const icon = ICONS[v.key] || ICONS.mild;
                  return (
                    <div key={v.key} className="version-card" style={{ background: 'var(--color-bg)', borderRadius: 8, padding: 20, border: '1px solid var(--color-border-light)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 4, background: icon.bg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{icon.label}</div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{v.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-lighter)' }}>{v.tag}</div>
                        </div>
                      </div>
                      <div style={{ fontSize: '0.9rem', lineHeight: 1.8, whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto', marginBottom: 10, color: 'var(--color-text)' }}>{v.content || '(生成失败)'}</div>
                      {v.strategy && <div style={{ fontSize: '0.85rem', color: 'var(--color-text-light)', borderTop: '1px solid var(--color-border)', paddingTop: 10, fontStyle: 'italic' }}>{v.strategy}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Jaccard */}
          {result.jaccard && (
            <div className="card" style={{ marginBottom: 8 }}>
              <div className="card-title">📐 差异度检查 (Jaccard)</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {Object.entries(result.jaccard).map(([k, v]) => (
                  <span key={k} className="tag" style={{ background: (v || 0) < 0.5 ? '#edf0e9' : '#f7f0de', color: (v || 0) < 0.5 ? '#7a8b6f' : '#c4a86a' }}>
                    {k}: {((v || 0) * 100).toFixed(0)}%
                  </span>
                ))}
              </div>
              <p style={{ fontSize: 11, color: 'var(--color-text-lighter)', marginTop: 6 }}>相似度 &lt; 70% 表示三个版本差异化达标</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
