export default function TestQuestion({ question, index, answer, onAnswer }) {
  return (
    <div className="question-block">
      <div className="question-number">{index + 1}</div>
      <div className="question-text">{question.question}</div>

      {question.type === 'multiple_choice' && (
        <div>
          {question.options.map((opt, i) => {
            const label = typeof opt === 'string' ? opt : opt.text;
            return (
              <div
                key={i}
                className={`form-option ${answer === label ? 'selected' : ''}`}
                onClick={() => onAnswer(question.id, label)}
              >
                {label}
              </div>
            );
          })}
        </div>
      )}

      {question.type === 'scale' && (
        <div className="scale-options">
          {Array.from({ length: question.max - question.min + 1 }, (_, i) => question.min + i).map(val => (
            <button
              key={val}
              className={`scale-btn ${answer === val ? 'selected' : ''}`}
              onClick={() => onAnswer(question.id, val)}
            >
              {val}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
