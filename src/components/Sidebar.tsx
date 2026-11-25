import {
  Activity,
  BookOpen,
  Cpu,
  LogOut,
  Terminal,
  X,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type { NavSection, RuntimeSession } from '../types';
import { GoogleSignInButton } from './GoogleSignInButton';

interface SidebarProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  activeRuntime: RuntimeSession | null;
  runningCount: number;
  user: User | null;
  isLoggingIn: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
}

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: typeof Activity;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: Activity },
  { id: 'notebooks', label: 'Notebooks', icon: BookOpen },
  { id: 'runtimes', label: 'Runtimes', icon: Cpu },
  { id: 'logs', label: 'Logs', icon: Terminal },
];

export function Sidebar({
  activeSection,
  onSelectSection,
  mobileOpen,
  onCloseMobile,
  activeRuntime,
  runningCount,
  user,
  isLoggingIn,
  onSignIn,
  onSignOut,
}: SidebarProps) {
  const sidebarBody = (
    <div className="flex h-full flex-col border-r border-slate-800 bg-[#0F172A]">
      {/* Brand header */}
      <div className="flex h-14 items-center justify-between border-b border-slate-800 px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/15 text-amber-400">
            <Terminal className="h-4 w-4" />
          </div>
          <span className="text-base font-semibold tracking-tight text-slate-100 whitespace-nowrap">
            ColabControl
          </span>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100 lg:hidden"
          aria-label="Close sidebar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Primary Sidebar Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Main navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectSection(item.id);
                onCloseMobile();
              }}
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-slate-800 text-amber-400'
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-100'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Icon className={`h-4 w-4 ${isActive ? 'text-amber-400' : 'text-slate-500'}`} />
                <span>{item.label}</span>
              </span>
              {item.id === 'notebooks' && runningCount > 0 && (
                <span className="font-mono text-xs text-emerald-400 tabular-nums">
                  {runningCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Active Runtime Summary */}
      <div className="mx-3 mb-3 rounded-md border border-slate-800 bg-[#111827] px-3 py-2.5">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Active Runtime</span>
          <span
            className={`font-medium ${
              !activeRuntime || activeRuntime.status === 'stopped'
                ? 'text-slate-500'
                : activeRuntime.status === 'busy'
                  ? 'text-amber-400'
                  : 'text-emerald-400'
            }`}
          >
            {activeRuntime ? activeRuntime.status : 'None'}
          </span>
        </div>
        {activeRuntime ? (
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="truncate font-mono text-xs font-medium text-slate-200">
              {activeRuntime.name}
            </span>
            <span className="font-mono text-[11px] text-slate-400 whitespace-nowrap">
              {activeRuntime.specs.label}
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              onSelectSection('runtimes');
              onCloseMobile();
            }}
            className="mt-1 text-xs font-medium text-amber-400 hover:text-amber-300"
          >
            Create runtime
          </button>
        )}
      </div>

      {/* Google Account Footer */}
      <div className="border-t border-slate-800 p-3">
        {user ? (
          <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5">
            <div className="flex min-w-0 items-center gap-2.5">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'Google user'}
                  referrerPolicy="no-referrer"
                  className="h-7 w-7 shrink-0 rounded-full border border-slate-700 object-cover"
                />
              ) : (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-slate-200">
                  {(user.displayName || user.email || 'G')[0].toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-slate-200">
                  {user.displayName || 'Google Account'}
                </div>
                <div className="truncate text-[11px] text-slate-400">{user.email}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              title="Sign out"
              className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 shrink-0"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <GoogleSignInButton
            onClick={onSignIn}
            disabled={isLoggingIn}
            label={isLoggingIn ? 'Signing in...' : 'Sign in with Google'}
            fullWidth
          />
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop fixed sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:block lg:w-60">
        {sidebarBody}
      </aside>

      {/* Mobile slide-over drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/65"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-60 max-w-[80vw]">{sidebarBody}</aside>
        </div>
      )}
    </>
  );
}
