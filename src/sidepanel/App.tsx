import { useState, useEffect } from 'preact/hooks';
import { NoteList } from './components/notelist';
import { SearchBar } from './components/searchbar';
import { TagFilter } from './components/tagfilter';
import { db } from '../db/database';
import type { Bookmark } from '../content/types';

export function App() {
  const [notes, setNotes] = useState<Bookmark[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [filteredNotes, setFilteredNotes] = useState<Bookmark[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Загружаем данные при инициализации
  useEffect(() => {
    loadInitialData();
    setupMessageListener();
  }, []);

  // Фильтрация заметок при изменении поиска или тегов
  useEffect(() => {
    filterNotes();
  }, [notes, searchQuery, selectedTags]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      
      // Получаем текущий чат ID от content script
      console.log('[Sidepanel] loadInitialData');
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_CURRENT_CHAT_ID' }, {}, (response: any) => {
          console.log('[Sidepanel] GET_CURRENT_CHAT_ID resp:', response);
          if (response?.chatId) {
            setCurrentChatId(response.chatId);
            loadNotesForChat(response.chatId);
          }
        });
      }
      
      // No chat selector; rely on current tab's chatId only
      
    } catch (error) {
      console.error('Error loading initial data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadNotesForChat = async (chatId: string) => {
    try {
      console.log('[Sidepanel] loadNotesForChat via SW', chatId);
      const resp = await new Promise<any>((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_NOTES_BY_CHAT', data: { chatId } }, {}, (r: any) => resolve(r));
      });
      const chatNotes = resp?.success ? (resp.notes as Bookmark[]) : [];
      console.log('[Sidepanel] notes count for chat:', chatNotes.length);
      setNotes(chatNotes);
      
      // Собираем все уникальные теги из полученных заметок
      const tagSet = new Set<string>();
      chatNotes.forEach(n => n.tags.forEach(t => tagSet.add(t)));
      const allTags = Array.from(tagSet).sort();
      console.log('[Sidepanel] all tags count:', allTags.length);
      setAllTags(allTags);
      
    } catch (error) {
      console.error('Error loading notes for chat:', error);
    }
  };

  const filterNotes = () => {
    let filtered = notes;

    // Фильтрация по поисковому запросу
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(note => 
        note.selectedText.toLowerCase().includes(query) ||
        (note.note && note.note.toLowerCase().includes(query)) ||
        note.tags.some(tag => tag.toLowerCase().includes(query))
      );
    }

    // Фильтрация по выбранным тегам
    if (selectedTags.length > 0) {
      filtered = filtered.filter(note =>
        selectedTags.every(tag => note.tags.includes(tag))
      );
    }

    setFilteredNotes(filtered);
  };

  const setupMessageListener = () => {
    // Слушаем сообщения от content script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('[Sidepanel] runtime message:', message.type, message.data);
      (async () => {
        switch (message.type) {
          case 'NOTES_REFRESH':
            // Update notes list when notes are added/modified
            console.log('[Sidepanel] NOTES_REFRESH received', message.data);
            if (message.data.chatId === currentChatId) {
              setNotes(message.data.notes);
            }
            break;
            
          case 'NOTE_DELETED':
            // Удаляем заметку из IndexedDB и обновляем список
            await db.deleteBookmark(message.data.noteId);
            setNotes(prev => prev.filter(note => note.id !== message.data.noteId));
            break;
            
          case 'CHAT_CHANGED':
            // Сменился чат, загружаем заметки для нового чата
            setCurrentChatId(message.data.chatId);
            loadNotesForChat(message.data.chatId);
            break;
        }
      })();
      return true;
    });
  };

  const handleNoteClick = async (noteId: number) => {
    try {
      // Отправляем сообщение content script для перехода к заметке
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'JUMP_TO_NOTE',
          data: { noteId }
        });
      }
    } catch (error) {
      console.error('Error jumping to note:', error);
    }
  };

  const handleNoteDelete = async (noteId: number) => {
    try {
      // Удаляем из IndexedDB
      await db.deleteBookmark(noteId);
      // Обновляем локальный список
      setNotes(prev => prev.filter(note => note.id !== noteId));
      
      // Уведомляем content script
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'DELETE_NOTE',
          data: { noteId }
        });
      }
    } catch (error) {
      console.error('Error deleting note:', error);
    }
  };


  if (loading) {
    return (
      <div style={{ 
        padding: '20px', 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center',
        height: '200px'
      }}>
        <div>Loading notes...</div>
      </div>
    );
  }

  return (
    <div style={{ 
      padding: '16px', 
      height: '100vh', 
      display: 'flex', 
      flexDirection: 'column',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ 
          margin: '0 0 16px 0', 
          fontSize: '18px', 
          fontWeight: '600',
          color: '#333'
        }}>
          📝 GPT Notes
        </h1>
        
        {/* Debug button for testing scroll */}
        <button
          onClick={() => {
            chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
              if (tabs[0]?.id) {
                chrome.tabs.sendMessage(
                  tabs[0].id, 
                  {type: 'DEBUG_SCROLL'}, 
                  undefined,
                  (response: any) => {
                    console.log('Debug scroll response:', response);
                  }
                );
              }
            });
          }}
          style={{
            padding: '4px 8px',
            marginBottom: '8px',
            background: '#ff6b6b',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            fontSize: '11px',
            cursor: 'pointer'
          }}
        >
          Test Scroll (Debug)
        </button>
        
        <SearchBar 
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search notes..."
        />
        
        {allTags.length > 0 && (
          <TagFilter
            allTags={allTags}
            selectedTags={selectedTags}
            onTagsChange={setSelectedTags}
          />
        )}
      </div>

      <div style={{ 
        flex: 1, 
        overflowY: 'auto',
        borderTop: '1px solid #eee',
        paddingTop: '16px'
      }}>
        {filteredNotes.length === 0 ? (
          <div style={{ 
            textAlign: 'center', 
            color: '#666', 
            padding: '40px 20px',
            fontSize: '14px'
          }}>
            {notes.length === 0 
              ? 'No notes yet. Select text on ChatGPT to create your first note!' 
              : 'No notes match your search criteria.'
            }
          </div>
        ) : (
          <NoteList 
            notes={filteredNotes}
            onNoteClick={handleNoteClick}
            onNoteDelete={handleNoteDelete}
          />
        )}
      </div>
    </div>
  );
}
