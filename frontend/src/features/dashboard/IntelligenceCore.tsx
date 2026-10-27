import { Sparkles } from 'lucide-react'

export type CoreState = 'idle' | 'processing' | 'response' | 'offline'

const labels: Record<CoreState, string> = {
  idle: 'ACADEMIC CORE ONLINE',
  processing: 'PROCESSING REQUEST',
  response: 'RESPONSE READY',
  offline: 'WORKSPACE OFFLINE',
}

export default function IntelligenceCore({ state = 'idle' }: { state?: CoreState }) {
  return <div className={`intelligence-core core-${state}`} role="img" aria-label={labels[state]}>
    <div className="core-rings"><i/><i/><i/><b/><b/><b/></div>
    <span className="core-center"><Sparkles size={26} strokeWidth={1.5}/></span>
    <span className="core-readout"><i/>{labels[state]}</span>
  </div>
}
