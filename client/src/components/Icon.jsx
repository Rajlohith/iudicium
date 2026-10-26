import {
  Activity, ArrowRight, AtSign, Check, ChevronDown, ChevronRight, Download, ExternalLink, FileCheck, FileCode,
  FileSpreadsheet, FileText, FolderArchive, Github, HelpCircle, Home, LayoutGrid, ListChecks, Loader, Mail,
  Menu, MessageCircle, Pencil, Play, Search, Send, ShieldCheck, Square, Trash2, X, XCircle, Zap, BookOpen,
  Info, Lightbulb, AlertTriangle, Sparkles, Settings, Filter, User, LogOut, History, RotateCcw,
} from 'lucide-react';

// Icons are referenced by their kebab-case lucide names (the names the original pages used).
const ICONS = {
  activity: Activity, 'arrow-right': ArrowRight, 'at-sign': AtSign, check: Check, 'chevron-down': ChevronDown,
  'chevron-right': ChevronRight, download: Download, 'external-link': ExternalLink, 'file-check': FileCheck,
  'file-code': FileCode, 'file-spreadsheet': FileSpreadsheet, 'file-text': FileText, 'folder-archive': FolderArchive,
  github: Github, 'help-circle': HelpCircle, home: Home, 'layout-grid': LayoutGrid, 'list-checks': ListChecks,
  loader: Loader, mail: Mail, menu: Menu, 'message-circle': MessageCircle, pencil: Pencil, play: Play,
  search: Search, send: Send, 'shield-check': ShieldCheck, square: Square, 'trash-2': Trash2, x: X,
  'x-circle': XCircle, zap: Zap, 'book-open': BookOpen, info: Info, lightbulb: Lightbulb,
  'alert-triangle': AlertTriangle, sparkles: Sparkles, settings: Settings, filter: Filter,
  user: User, 'log-out': LogOut, history: History, 'rotate-ccw': RotateCcw,
};

export default function Icon({ name, ...props }) {
  const Component = ICONS[name];
  if (!Component) {
    if (import.meta.env.DEV) console.warn(`Icon "${name}" is not registered in components/Icon.jsx`);
    return null;
  }
  return <Component aria-hidden="true" {...props} />;
}
