import type { Bookmark } from '../../content/types';
import { NoteItem } from './noteitem';

interface NoteListProps {
  notes: Bookmark[];
  onNoteClick: (noteId: number) => void;
  onNoteDelete: (noteId: number) => void;
}

export function NoteList({ notes, onNoteClick, onNoteDelete }: NoteListProps) {
  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat(getLocale(), {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(date));
  };

  const getLocale = () => (navigator.languages && navigator.languages.length) ? navigator.languages[0] : navigator.language;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {notes.map((note) => (
        <NoteItem
          key={note.id}
          note={note}
          onClick={onNoteClick}
          onDelete={onNoteDelete}
        />
      ))}
    </div>
  );
}