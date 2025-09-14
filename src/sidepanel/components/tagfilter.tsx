interface TagFilterProps {
  allTags: string[];
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
}

export function TagFilter({ allTags, selectedTags, onTagsChange }: TagFilterProps) {
  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      onTagsChange(selectedTags.filter(t => t !== tag));
    } else {
      onTagsChange([...selectedTags, tag]);
    }
  };

  const clearAll = () => {
    onTagsChange([]);
  };

  if (allTags.length === 0) {
    return null;
  }

  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '8px'
      }}>
        <span style={{
          fontSize: '12px',
          fontWeight: '500',
          color: '#666'
        }}>
          Filter by tags:
        </span>
        {selectedTags.length > 0 && (
          <button
            onClick={clearAll}
            style={{
              background: 'none',
              border: 'none',
              color: '#10a37f',
              cursor: 'pointer',
              fontSize: '11px',
              textDecoration: 'underline'
            }}
          >
            Clear all
          </button>
        )}
      </div>
      
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px'
      }}>
        {allTags.map(tag => {
          const isSelected = selectedTags.includes(tag);
          return (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              style={{
                background: isSelected ? '#10a37f' : '#f1f1f1',
                color: isSelected ? 'white' : '#333',
                border: 'none',
                borderRadius: '12px',
                padding: '4px 8px',
                fontSize: '11px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                whiteSpace: 'nowrap'
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  (e.target as HTMLButtonElement).style.backgroundColor = '#e0e0e0';
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  (e.target as HTMLButtonElement).style.backgroundColor = '#f1f1f1';
                }
              }}
            >
              #{tag}
            </button>
          );
        })}
      </div>
    </div>
  );
}
