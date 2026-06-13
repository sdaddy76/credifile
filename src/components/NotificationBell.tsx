import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Bell, Check, CheckCheck, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface Notification {
  id: string;
  tipo: string;
  titolo: string;
  testo?: string;
  link?: string;
  letto: boolean;
  created_at: string;
}

const TIPO_ICON: Record<string, string> = {
  pratica_assegnata:    '📋',
  documento_richiesto:  '📄',
  stato_aggiornato:     '🔄',
  task_assegnato:       '✅',
  nota_aggiunta:        '💬',
  email_inviata:        '📧',
};

export default function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const load = async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30);
    const list = (data ?? []) as Notification[];
    setNotifications(list);
    setUnread(list.filter(n => !n.letto).length);
  };

  useEffect(() => {
    load();
    // Polling ogni 30 secondi
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [user?.id]);

  // Chiudi al click fuori
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markAllRead = async () => {
    if (!user?.id) return;
    await supabase.from('notifications').update({ letto: true }).eq('user_id', user.id).eq('letto', false);
    setNotifications(prev => prev.map(n => ({ ...n, letto: true })));
    setUnread(0);
  };

  const markRead = async (id: string) => {
    await supabase.from('notifications').update({ letto: true }).eq('id', id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, letto: true } : n));
    setUnread(prev => Math.max(0, prev - 1));
  };

  const deleteNotif = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await supabase.from('notifications').delete().eq('id', id);
    const notif = notifications.find(n => n.id === id);
    setNotifications(prev => prev.filter(n => n.id !== id));
    if (notif && !notif.letto) setUnread(prev => Math.max(0, prev - 1));
  };

  const handleClick = async (n: Notification) => {
    if (!n.letto) await markRead(n.id);
    if (n.link) {
      navigate(n.link);
      setOpen(false);
    }
  };

  const timeAgo = (dateStr: string) => {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return 'ora';
    if (diff < 3600) return `${Math.floor(diff / 60)}min fa`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h fa`;
    return `${Math.floor(diff / 86400)}g fa`;
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen(!open); if (!open) load(); }}
        className="relative w-9 h-9 flex items-center justify-center rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
        aria-label="Notifiche"
      >
        <Bell className="w-4.5 h-4.5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-80 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm">Notifiche</span>
              {unread > 0 && (
                <span className="bg-red-100 text-red-700 text-xs px-1.5 py-0.5 rounded-full font-semibold">{unread} nuove</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button onClick={markAllRead} className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground" title="Segna tutte come lette">
                  <CheckCheck className="w-3.5 h-3.5" />
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Lista */}
          <div className="max-h-80 overflow-y-auto divide-y divide-border">
            {notifications.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground text-sm">
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-20" />
                Nessuna notifica
              </div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={cn(
                    'flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors group',
                    !n.letto && 'bg-primary/5'
                  )}
                >
                  <span className="text-base mt-0.5 shrink-0">{TIPO_ICON[n.tipo] ?? '🔔'}</span>
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-xs font-medium', !n.letto ? 'text-foreground' : 'text-muted-foreground')}>
                      {n.titolo}
                    </p>
                    {n.testo && <p className="text-xs text-muted-foreground truncate mt-0.5">{n.testo}</p>}
                    <p className="text-[10px] text-muted-foreground mt-1">{timeAgo(n.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!n.letto && (
                      <button onClick={e => { e.stopPropagation(); markRead(n.id); }} className="opacity-0 group-hover:opacity-100 p-1 hover:bg-accent rounded" title="Segna come letta">
                        <Check className="w-3 h-3 text-primary" />
                      </button>
                    )}
                    <button onClick={e => deleteNotif(n.id, e)} className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 rounded" title="Elimina">
                      <Trash2 className="w-3 h-3 text-red-400" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
