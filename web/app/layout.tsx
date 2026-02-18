import type { Metadata } from 'next'
import { DM_Sans, DM_Mono } from 'next/font/google'
import './globals.css'
import Link from 'next/link'
import { ToastProvider } from '@/components/ToastContainer'

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-body' })
const dmMono = DM_Mono({ weight: ['400', '500'], subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'Seer — Agent Evaluation',
  description: 'LLM-as-judge evaluation framework for Glean agents',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${dmMono.variable} font-sans`}>
        <ToastProvider>
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-border bg-white">
            <div className="max-w-6xl mx-auto px-6">
              <div className="flex justify-between items-center h-14">
                <div className="flex items-center gap-8">
                  <Link href="/" className="text-xl font-semibold tracking-tight text-glean-blue">
                    Seer
                  </Link>
                  <nav className="flex gap-6">
                    <Link
                      href="/"
                      className="text-sm text-cement hover:text-[#1A1A1A] transition-colors"
                    >
                      Dashboard
                    </Link>
                    <Link
                      href="/sets/new"
                      className="text-sm text-cement hover:text-[#1A1A1A] transition-colors"
                    >
                      New Eval Set
                    </Link>
                    <Link
                      href="/settings"
                      className="text-sm text-cement hover:text-[#1A1A1A] transition-colors"
                    >
                      Settings
                    </Link>
                  </nav>
                </div>
              </div>
            </div>
          </header>

          <main className="flex-1">
            <div className="max-w-6xl mx-auto px-6 py-8">
              {children}
            </div>
          </main>

          <footer className="border-t border-border bg-white">
            <div className="max-w-6xl mx-auto px-6 py-3">
              <p className="text-xs text-cement text-center">
                Seer v0.3.0 · Built on Glean
              </p>
            </div>
          </footer>
        </div>
        </ToastProvider>
      </body>
    </html>
  )
}
