import type { Bookmark } from '../../content/types';

interface NoteItemProps {
  note: Bookmark;
  onClick: (id: number) => void;
  onDelete: (id: number) => void;
}

const truncate = (text: string, maxLength: number) =>
  text.length <= maxLength ? text : text.substring(0, maxLength) + '...';

export function NoteItem({ note, onClick, onDelete }: NoteItemProps) {
  return (
    <div
      style={{
        border: '1px solid #e0e0e0',
        borderRadius: '8px',
        padding: '12px',
        cursor: 'pointer',
        transition: 'all 0.2s',
        backgroundColor: 'white',
        position: 'relative'
      }}
      onClick={() => note.id && onClick(typeof note.id === 'number' ? note.id : parseInt(String(note.id), 10))}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = '#10a37f';
        (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(16, 163, 127, 0.1)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = '#e0e0e0';
        (e.currentTarget as HTMLElement).style.boxShadow = 'none';
      }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (note.id) onDelete(typeof note.id === 'number' ? note.id : parseInt(String(note.id), 10));
        }}
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          background: 'none',
          border: 'none',
          color: '#999',
          cursor: 'pointer',
          fontSize: '16px',
          padding: '4px',
          borderRadius: '4px',
          lineHeight: '1'
        }}
        onMouseEnter={(e) => {
          (e.target as HTMLButtonElement).style.backgroundColor = '#f5f5f5';
          (e.target as HTMLButtonElement).style.color = '#ff4444';
        }}
        onMouseLeave={(e) => {
          (e.target as HTMLButtonElement).style.backgroundColor = 'transparent';
          (e.target as HTMLButtonElement).style.color = '#999';
        }}
        title="Delete note"
      >
        ×
      </button>

      <div style={{
        fontSize: '13px',
        color: '#666',
        marginBottom: '8px',
        fontStyle: 'italic',
        borderLeft: '3px solid #10a37f',
        paddingLeft: '8px',
        paddingRight: '24px'
      }}>
        "{truncate(note.selectedText, 100)}"
      </div>

      {note.note && (
        <div style={{
          fontSize: '14px',
          color: '#333',
          marginBottom: '8px',
          lineHeight: '1.4'
        }}>
          {truncate(note.note, 120)}
        </div>
      )}

      {note.tags.length > 0 && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px',
          marginBottom: '8px'
        }}>
          {note.tags.map((tag: string) => (
            <span
              key={tag}
              style={{
                backgroundColor: '#f0f0f0',
                color: '#666',
                fontSize: '10px',
                padding: '2px 6px',
                borderRadius: '8px',
                whiteSpace: 'nowrap'
              }}
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      <div style={{
        fontSize: '11px',
        color: '#999',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <span>{new Intl.DateTimeFormat('ru-RU', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit'
        }).format(new Date(note.timestamp))}</span>
        <span style={{
          backgroundColor: note.isHighlighted ? '#e8f5e8' : '#f5f5f5',
          color: note.isHighlighted ? '#2e7d32' : '#666',
          padding: '2px 6px',
          borderRadius: '4px',
          fontSize: '10px'
        }}>
          {note.isHighlighted ? '📝 Note' : '🖍️ Highlight'}
        </span>
      </div>
    </div>
  );
}
