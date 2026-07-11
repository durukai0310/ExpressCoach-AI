import { useState, useEffect } from 'react';
import { api } from '../utils/api';
import TestQuestion from '../components/TestQuestion';

const CATEGORY_LABELS = {
  learning_style: '学习风格',
  motivation: '学习动力',
  career_values: '职业价值观',
};

export default function Tests() {
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTest, setActiveTest] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { loadTests(); }, []);

  const loadTests = async () => {
    try {
      const data = await api.get('/tests');
      setTests(data.tests || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const openTest = (test) => {
    let questions = test.questions;
    if (typeof questions === 'string') {
      try { questions = JSON.parse(questions); } catch (e) { questions = []; }
    }
    setActiveTest({ ...test, questions });
    setAnswers({});
    setResult(null);
  };

  const handleAnswer = (questionId, value) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const allAnswered = () => {
    if (!activeTest) return false;
    return activeTest.questions.every(q => answers[q.id] !== undefined && answers[q.id] !== null && answers[q.id] !== '');
  };

  const handleSubmit = async () => {
    if (!activeTest || !allAnswered()) return;

    setSubmitting(true);
    try {
      const data = await api.post(`/tests/${activeTest.id}/submit`, { answers });
      setResult(data.result);
    } catch (err) {
      alert('提交失败：' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="loading"><div className="spinner"></div> 加载中...</div>;
  if (error) return <div className="error-state">加载失败：{error}</div>;

  // Test result view
  if (result) {
    return (
      <div>
        <button
          className="btn btn-sm btn-outline"
          onClick={() => { setActiveTest(null); setResult(null); }}
          style={{ marginBottom: 'var(--space-lg)' }}
          data-track="back-to-tests"
        >
          ← 返回测试列表
        </button>

        <div className="card result-card">
          <span style={{ fontSize: '3rem' }}>
            {result.percentage >= 80 ? '🏆' : result.percentage >= 60 ? '🌟' : result.percentage >= 40 ? '💪' : '🌱'}
          </span>
          <h2 style={{ marginTop: 'var(--space-lg)', fontFamily: 'var(--font-serif)' }}>
            {activeTest?.title} - 评估报告
          </h2>

          <div className="result-score">{result.percentage}%</div>
          <div className="result-percentage">
            {result.score} / {result.maxScore} 分
          </div>

          {result.dimensionScores && Object.keys(result.dimensionScores).length > 0 && (
            <div style={{ marginTop: 'var(--space-lg)' }}>
              <h3>各维度得分</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)', marginTop: 'var(--space-md)', justifyContent: 'center' }}>
                {Object.entries(result.dimensionScores).map(([dim, score]) => (
                  <div key={dim} style={{
                    padding: 'var(--space-sm) var(--space-lg)',
                    background: 'var(--color-primary-light)',
                    borderRadius: 'var(--radius-md)',
                    textAlign: 'center',
                  }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-primary)' }}>{score}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-light)' }}>{dim}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="result-analysis">
            <div
              dangerouslySetInnerHTML={{
                __html: result.analysis
                  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                  .replace(/^### (.+)$/gm, '<h3>$1</h3>')
                  .replace(/^## (.+)$/gm, '<h2>$1</h2>')
                  .replace(/^\d+\.\s(.+)$/gm, '<li>$1</li>')
                  .replace(/\n\n/g, '</p><p>')
                  .replace(/\n/g, '<br/>'),
              }}
            />
          </div>

          <div style={{ marginTop: 'var(--space-xl)', display: 'flex', gap: 'var(--space-md)', justifyContent: 'center' }}>
            <button className="btn btn-outline" onClick={() => { setActiveTest(null); setResult(null); }} data-track="back-to-test-list">
              返回列表
            </button>
            <button className="btn btn-primary" onClick={() => openTest(activeTest)} data-track="retake-test">
              重新测试
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Test taking view
  if (activeTest) {
    return (
      <div>
        <button
          className="btn btn-sm btn-outline"
          onClick={() => setActiveTest(null)}
          style={{ marginBottom: 'var(--space-lg)' }}
          data-track="back-to-tests"
        >
          ← 返回列表
        </button>

        <h1 className="page-title">{activeTest.title}</h1>
        <p className="page-subtitle">{activeTest.description}</p>
        {activeTest.category && (
          <span className="test-category" style={{ marginBottom: 'var(--space-lg)' }}>
            {CATEGORY_LABELS[activeTest.category] || activeTest.category}
          </span>
        )}

        {activeTest.questions.map((q, idx) => (
          <TestQuestion
            key={q.id}
            question={q}
            index={idx}
            answer={answers[q.id]}
            onAnswer={handleAnswer}
          />
        ))}

        <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
          <button
            className="btn btn-primary btn-lg"
            onClick={handleSubmit}
            disabled={!allAnswered() || submitting}
            data-track="submit-test"
          >
            {submitting ? '正在分析中...' : '提交评估'}
          </button>
          {!allAnswered() && (
            <p style={{ color: 'var(--color-text-lighter)', fontSize: '0.85rem', marginTop: 'var(--space-sm)' }}>
              请回答所有问题后再提交
            </p>
          )}
        </div>
      </div>
    );
  }

  // Test list view
  return (
    <div>
      <h1 className="page-title">🧪 评估测试</h1>
      <p className="page-subtitle">参加科学的评估测试，获取 AI 深度分析和个性化建议</p>

      {tests.length === 0 ? (
        <div className="empty-state">
          <span className="icon">🧪</span>
          <p>暂无可用的测试</p>
        </div>
      ) : (
        <div className="test-grid">
          {tests.map(test => (
            <div
              key={test.id}
              className="card test-card"
              onClick={() => openTest(test)}
              data-track={`test-${test.id}`}
            >
              <span className="test-category">
                {CATEGORY_LABELS[test.category] || test.category || '评估'}
              </span>
              <h3 className="card-title" style={{ marginTop: 'var(--space-sm)' }}>{test.title}</h3>
              <p className="card-description">{test.description}</p>
              <div className="card-meta">
                <span>📋 {(() => {
                  try { const q = typeof test.questions === 'string' ? JSON.parse(test.questions) : test.questions; return Array.isArray(q) ? q.length : 0; }
                  catch (e) { return 0; }
                })()} 道题</span>
                <span style={{ color: 'var(--color-secondary)' }}>含 AI 分析</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
