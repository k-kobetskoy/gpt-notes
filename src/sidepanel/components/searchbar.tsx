interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChange, placeholder = "Search..." }: SearchBarProps) {
  return (
    <div style={{ position: 'relative', marginBottom: '12px' }}>
      <input
        type="text"
        value={value}
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '8px 32px 8px 12px',
          border: '1px solid #ddd',
          borderRadius: '6px',
          fontSize: '14px',
          boxSizing: 'border-box',
          outline: 'none',
          transition: 'border-color 0.2s'
        }}
        onFocus={(e) => {
          (e.target as HTMLInputElement).style.borderColor = '#10a37f';
        }}
        onBlur={(e) => {
          (e.target as HTMLInputElement).style.borderColor = '#ddd';
        }}
      />
      <div style={{
        position: 'absolute',
        right: '8px',
        top: '50%',
        transform: 'translateY(-50%)',
        color: '#999',
        fontSize: '14px',
        pointerEvents: 'none'
      }}>
        🔍
      </div>
      {value && (
        <button
          onClick={() => onChange('')}
          style={{
            position: 'absolute',
            right: '28px',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 'none',
            color: '#999',
            cursor: 'pointer',
            fontSize: '16px',
            padding: '0',
            lineHeight: '1'
          }}
          title="Clear search"
        >
          ×
        </button>
      )}
    </div>
  );
}
