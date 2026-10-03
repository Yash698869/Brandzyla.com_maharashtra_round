import React, { useState } from 'react';
import {
  ChevronUp,
  ChevronDown,
  Terminal,
  ShieldCheck,
  Gift,
  KeyRound,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import type { Config, Actor } from '../lib/types';
import type { UserAccount } from '../lib/auth';

interface DevDemoDrawerProps {
  config: Config;
  currentActorAddress?: string;
  onSwitchActor: (actor: Actor) => Promise<void>;
}

export default function DevDemoDrawer({
  config,
  currentActorAddress,
  onSwitchActor,
}: DevDemoDrawerProps) {
  const [expanded, setExpanded] = useState(false);
  const [switching, setSwitching] = useState(false);

  if (config.mode !== 'local') return null;

  async function handleSelect(actor: Actor) {
    if (switching || actor.address.toLowerCase() === currentActorAddress?.toLowerCase()) return;
    setSwitching(true);
    try {
      await onSwitchActor(actor);
    } finally {
      setSwitching(false);
    }
  }

  const currentActor = config.actors.find(
    a => a.address.toLowerCase() === currentActorAddress?.toLowerCase()
  );

  return (
    <div className={`dev-demo-drawer ${expanded ? 'expanded' : 'collapsed'}`}>
      <div className="dev-drawer-handle" onClick={() => setExpanded(!expanded)}>
        <div className="dev-drawer-badge">
          <Terminal size={13} />
          <span>DEVELOPMENT DEMO</span>
          <span className="dev-tag">LOCAL CHAIN 31337</span>
        </div>
        <div className="dev-drawer-acting">
          <span>Active:</span>
          <strong>{currentActor?.name ?? 'Connecting'}</strong>
          <span className={`actor-role-chip ${currentActor?.role ?? 'owner'}`}>
            {currentActor?.role ?? 'owner'}
          </span>
        </div>
        <button
          type="button"
          className="dev-drawer-toggle-btn"
          aria-label={expanded ? 'Collapse dev bar' : 'Expand dev bar'}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {expanded && (
        <div className="dev-drawer-content">
          <div className="dev-drawer-info">
            <p>
              <strong>Developer Evaluation Tool:</strong> Switch between the 5 pre-funded local Hardhat accounts
              to inspect each distinct workspace and test multi-actor recovery flows. This control is purely for
              local evaluation and is <strong>absent from public testnet/production</strong>.
            </p>
          </div>

          <div className="dev-actor-cards-grid">
            {config.actors.filter(a => a.isDemo !== false).slice(0, 5).map(a => {
              const isCurrent = a.address.toLowerCase() === currentActorAddress?.toLowerCase();
              const Icon =
                a.role === 'owner' ? ShieldCheck : a.role === 'beneficiary' ? Gift : KeyRound;
              const routeLabel =
                a.role === 'owner' ? '/owner' : a.role === 'beneficiary' ? '/beneficiary' : '/guardian';

              return (
                <button
                  key={a.address}
                  type="button"
                  className={`dev-actor-card ${isCurrent ? 'active' : ''}`}
                  disabled={switching || isCurrent}
                  onClick={() => handleSelect(a)}
                >
                  <div className="dev-actor-card-top">
                    <span className="dev-actor-avatar">{a.initials}</span>
                    <span className={`actor-role-chip ${a.role}`}>{a.role}</span>
                  </div>
                  <strong>{a.name}</strong>
                  <small>{routeLabel}</small>
                  {isCurrent && <span className="dev-current-badge">Active session</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
