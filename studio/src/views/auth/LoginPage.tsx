import { Leaf } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { COMPANY_INFO } from '@/lib/constants'
import { redirectToAzureLogin } from '@/lib/azureAuth'
import './LoginPage.css'

export default function LoginPage() {
  const toast = useUIStore((s) => s.toast)

  async function handleSsoClick() {
    try {
      await redirectToAzureLogin()
    } catch {
      toast('Could not reach Microsoft sign-in. Try again.', { variant: 'error' })
    }
  }

  return (
    <div className="min-h-screen bg-[hsl(0_0%_98%)] grid lg:grid-cols-[1.05fr_1fr]">

      {/* ── Left: Photo panel ── */}
      <div className="hidden lg:flex p-5">
        <div className="login-photo-frame relative flex-1 rounded-[20px] overflow-hidden isolate bg-[#143626]">

          {/* Brand tint + directional gradient */}
          <div className="login-photo-overlay absolute inset-0 z-[1] pointer-events-none" />

          {/* Grain overlay */}
          <div className="login-grain absolute inset-0 z-[2] pointer-events-none" />

          {/* Content */}
          <div className="relative z-[3] h-full w-full p-10 flex flex-col justify-between text-white">

            {/* Brand mark */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/[.16] backdrop-blur-sm border border-white/[.22] flex items-center justify-center shrink-0">
                <Leaf className="w-5 h-5 text-white" aria-hidden="true" />
              </div>
              <div>
                <p className="font-bold text-[15px] leading-tight text-white">Sales Studio</p>
                <p className="text-[12px] text-white/70 mt-0.5 font-medium">{COMPANY_INFO.name}</p>
              </div>
            </div>

            {/* Hero copy */}
            <div className="max-w-[480px]">
              <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] uppercase text-white/75 mb-5">
                <span className="block w-6 h-px bg-white/60 shrink-0" aria-hidden="true" />
                Commercial Sales Platform
              </p>
              <h1 className="text-[clamp(36px,4.2vw,52px)] font-bold leading-[1.02] tracking-[-0.025em] text-white mb-[18px]">
                Your pipeline,<br />
                always{' '}
                <em className="not-italic text-[#BBEBCC]">in view</em>.
              </h1>
              <p className="text-[15px] leading-[1.55] text-white/80 max-w-[420px] font-normal mb-8">
                Track leads, manage bids, and close more commercial
                landscaping contracts — all from one place.
              </p>

              {/* Footer */}
              <div className="flex justify-between items-center pt-6 border-t border-white/[.18] text-[11px] text-white/50">
                <span>© {new Date().getFullYear()} {COMPANY_INFO.name}</span>
                <span className="flex items-center gap-2">
                  <a href="#" className="hover:text-white/80 transition-colors duration-100">Help</a>
                  <span aria-hidden="true">·</span>
                  <a href="#" className="hover:text-white/80 transition-colors duration-100">Status</a>
                </span>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ── Right: Form panel ── */}
      <div className="flex items-center justify-center px-8 py-12">
        <div className="w-full max-w-[380px]">

          {/* Mobile brand — hidden on desktop */}
          <div className="flex items-center gap-3 mb-7 lg:hidden">
            <div className="w-10 h-10 rounded-xl bg-[#2E7D52] flex items-center justify-center shrink-0">
              <Leaf className="w-5 h-5 text-white" aria-hidden="true" />
            </div>
            <div>
              <p className="font-bold text-[15px] leading-tight text-[#0d1117]">Sales Studio</p>
              <p className="text-[12px] text-[#6b7280] mt-0.5">{COMPANY_INFO.name}</p>
            </div>
          </div>

          {/* Header */}
          <div className="mb-7">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#f0faf4] border border-[#dcf5e6] text-[#1e5238] rounded-full text-[11px] font-semibold mb-[18px]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2E7D52] shadow-[0_0_0_3px_rgba(46,125,82,.18)]" aria-hidden="true" />
              Employee sign in
            </span>
            <h2 className="text-[26px] font-bold tracking-tight text-[#0d1117] mb-2 leading-[1.12]">
              Welcome back.
            </h2>
            <p className="text-sm text-[#6b7280] leading-relaxed">
              Sign in with your Juniper account to access leads, bids, and estimates.
            </p>
          </div>

          {/* SSO button */}
          <button
            type="button"
            onClick={handleSsoClick}
            className="w-full flex items-center justify-center gap-2.5 h-11 px-4 rounded-lg bg-white border border-[hsl(220_13%_91%)] shadow-sm text-[13.5px] font-semibold text-[#0d1117] cursor-pointer hover:bg-[hsl(220_14%_99%)] hover:border-[hsl(220_13%_86%)] active:translate-y-px transition-all duration-100"
          >
            {/* Microsoft 4-square logo */}
            <svg width="16" height="16" viewBox="0 0 23 23" aria-hidden="true" focusable="false">
              <rect x="1"  y="1"  width="10" height="10" fill="#F25022" />
              <rect x="12" y="1"  width="10" height="10" fill="#7FBA00" />
              <rect x="1"  y="12" width="10" height="10" fill="#00A4EF" />
              <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
            </svg>
            Continue with Azure Entra ID
          </button>

          {/* SSO is the only entry point — role + branch resolve from crm_users
              in the Entra callback, after Microsoft proves identity. */}
          <p className="mt-5 text-[12.5px] leading-relaxed text-[#6b7280]">
            Access is managed through your Juniper Microsoft account. If you can’t
            sign in, ask an admin to provision your CRM access.
          </p>

        </div>
      </div>

    </div>
  )
}
