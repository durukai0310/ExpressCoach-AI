export default function SurveyCard({ survey, onClick }) {
  let questionCount = 0;
  try {
    const questions = typeof survey.questions === 'string'
      ? JSON.parse(survey.questions)
      : survey.questions;
    questionCount = Array.isArray(questions) ? questions.length : 0;
  } catch (e) { /* ignore */ }

  return (
    <div className="card survey-card" onClick={onClick} data-track={`survey-${survey.id}`}>
      <h3 className="card-title">{survey.title}</h3>
      <p className="card-description">{survey.description}</p>
      <div className="card-meta">
        <span>📋 {questionCount} 个问题</span>
        <span style={{ color: 'var(--color-success)' }}>● 进行中</span>
      </div>
    </div>
  );
}
