export default function MessageBubble({ message }) {
  const isUser = message.role === 'user';

  return (
    <div className={`message ${isUser ? 'message-user' : 'message-ai'}`}>
      {isUser ? (
        <div>{message.content}</div>
      ) : (
        <div
          dangerouslySetInnerHTML={{
            __html: formatAIMessage(message.content),
          }}
        />
      )}
    </div>
  );
}

function formatAIMessage(text) {
  if (!text) return '';
  // Convert markdown-style formatting to HTML
  let html = text
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    // Numbered lists
    .replace(/^\d+\.\s(.+)$/gm, '<li>$1</li>')
    // Bullet points
    .replace(/^[-•]\s(.+)$/gm, '<li>$1</li>')
    // Line breaks
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');

  // Wrap in paragraphs
  html = '<p>' + html + '</p>';

  // Wrap consecutive <li> in <ol> or <ul>
  html = html.replace(/((?:<li>.*?<\/li>\s*)+)/g, (match) => {
    return '<ul>' + match + '</ul>';
  });

  return html;
}
