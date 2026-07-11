import { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';
import SurveyCard from '../components/SurveyCard';

export default function Surveys() {
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeSurvey, setActiveSurvey] = useState(null);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadSurveys();
  }, []);

  const loadSurveys = async () => {
    try {
      const data = await api.get('/surveys');
      setSurveys(data.surveys || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const openSurvey = (survey) => {
    let questions = survey.questions;
    if (typeof questions === 'string') {
      try { questions = JSON.parse(questions); } catch (e) { questions = []; }
    }
    setActiveSurvey({ ...survey, questions });
    setAnswers({});
    setSubmitted(false);
  };

  const handleAnswer = (questionId, value) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const handleScaleAnswer = (questionId, value) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const handleCheckboxAnswer = (questionId, option, checked) => {
    setAnswers(prev => {
      const current = prev[questionId] || [];
      if (checked) {
        return { ...prev, [questionId]: [...current, option] };
      } else {
        return { ...prev, [questionId]: current.filter(o => o !== option) };
      }
    });
  };

  const handleSubmit = async () => {
    if (!activeSurvey) return;

    const formattedAnswers = activeSurvey.questions.map(q => ({
      question_id: q.id,
      question: q.question,
      answer: answers[q.id] || '',
    }));

    setSubmitting(true);
    try {
      await api.post(`/surveys/${activeSurvey.id}/submit`, { answers: formattedAnswers });
      setSubmitted(true);
    } catch (err) {
      alert('提交失败：' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const isComplete = () => {
    if (!activeSurvey) return false;
    return activeSurvey.questions
      .filter(q => q.required)
      .every(q => {
        const answer = answers[q.id];
        if (q.type === 'checkbox') return Array.isArray(answer) && answer.length > 0;
        return answer !== undefined && answer !== null && answer !== '';
      });
  };

  if (loading) return <div className="loading"><div className="spinner"></div> 加载中...</div>;
  if (error) return <div className="error-state">加载失败：{error}</div>;

  // Survey detail view
  if (activeSurvey) {
    if (submitted) {
      return (
        <div>
          <div className="result-card card">
            <span style={{ fontSize: '3rem' }}>🎉</span>
            <h2 style={{ marginTop: 'var(--space-lg)' }}>感谢你的参与！</h2>
            <p style={{ color: 'var(--color-text-light)', marginTop: 'var(--space-md)' }}>
              你的「{activeSurvey.title}」已成功提交。
            </p>
            <div style={{ marginTop: 'var(--space-xl)', display: 'flex', gap: 'var(--space-md)', justifyContent: 'center' }}>
              <button className="btn btn-outline" onClick={() => setActiveSurvey(null)} data-track="back-to-surveys">
                返回问卷列表
              </button>
              <button className="btn btn-primary" onClick={() => openSurvey(activeSurvey)} data-track="retake-survey">
                重新填写
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div>
        <button
          className="btn btn-sm btn-outline"
          onClick={() => setActiveSurvey(null)}
          style={{ marginBottom: 'var(--space-lg)' }}
          data-track="back-to-surveys"
        >
          ← 返回列表
        </button>

        <h1 className="page-title">{activeSurvey.title}</h1>
        <p className="page-subtitle">{activeSurvey.description}</p>

        {activeSurvey.questions.map((q, idx) => (
          <div key={q.id} className="question-block">
            <div className="question-number">{idx + 1}</div>
            <div className="question-text">
              {q.question}
              {q.required && <span className="required-badge">*必填</span>}
            </div>

            {q.type === 'multiple_choice' && (
              <div>
                {q.options.map((opt, i) => (
                  <div
                    key={i}
                    className={`form-option ${answers[q.id] === opt ? 'selected' : ''}`}
                    onClick={() => handleAnswer(q.id, opt)}
                  >
                    {opt}
                  </div>
                ))}
              </div>
            )}

            {q.type === 'scale' && (
              <div className="scale-options">
                {Array.from({ length: q.max - q.min + 1 }, (_, i) => q.min + i).map(val => (
                  <button
                    key={val}
                    className={`scale-btn ${answers[q.id] === val ? 'selected' : ''}`}
                    onClick={() => handleScaleAnswer(q.id, val)}
                  >
                    {val}
                  </button>
                ))}
              </div>
            )}

            {q.type === 'checkbox' && (
              <div>
                {q.options.map((opt, i) => (
                  <label key={i} className="checkbox-option">
                    <input
                      type="checkbox"
                      checked={(answers[q.id] || []).includes(opt)}
                      onChange={(e) => handleCheckboxAnswer(q.id, opt, e.target.checked)}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            )}

            {q.type === 'text' && (
              <textarea
                className="form-input"
                placeholder="请输入你的回答..."
                value={answers[q.id] || ''}
                onChange={(e) => handleAnswer(q.id, e.target.value)}
                rows={3}
              />
            )}
          </div>
        ))}

        <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
          <button
            className="btn btn-primary btn-lg"
            onClick={handleSubmit}
            disabled={!isComplete() || submitting}
            data-track="submit-survey"
          >
            {submitting ? '提交中...' : '提交问卷'}
          </button>
          {!isComplete() && (
            <p style={{ color: 'var(--color-text-lighter)', fontSize: '0.85rem', marginTop: 'var(--space-sm)' }}>
              请完成所有必填项后再提交
            </p>
          )}
        </div>
      </div>
    );
  }

  // Survey list view
  return (
    <div>
      <h1 className="page-title">📝 问卷调查</h1>
      <p className="page-subtitle">完成以下问卷，帮助我们更好地了解你</p>

      {surveys.length === 0 ? (
        <div className="empty-state">
          <span className="icon">📋</span>
          <p>暂无可用的问卷</p>
        </div>
      ) : (
        <div className="survey-grid">
          {surveys.map(survey => (
            <SurveyCard
              key={survey.id}
              survey={survey}
              onClick={() => openSurvey(survey)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
