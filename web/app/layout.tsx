import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Link from 'next/link'
import { ToastProvider } from '@/components/ToastContainer'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Seer - Agent Evaluation',
  description: 'LLM-as-judge evaluation framework for Glean agents',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ToastProvider>
        <div className="min-h-screen flex flex-col">
          {/* Header */}
          <header className="border-b border-gray-200 bg-white">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center h-16">
                <div className="flex items-center gap-8">
                  <Link href="/" className="text-2xl font-bold text-gray-900">
                    Seer
                  </Link>
                  <nav className="flex gap-6">
                    <Link
                      href="/"
                      className="text-gray-600 hover:text-gray-900 transition-colors"
                    >
                      Dashboard
                    </Link>
                    <Link
                      href="/sets/new"
                      className="text-gray-600 hover:text-gray-900 transition-colors"
                    >
                      New Eval Set
                    </Link>
                    <Link
                      href="/settings"
                      className="text-gray-600 hover:text-gray-900 transition-colors"
                    >
                      Settings
                    </Link>
                  </nav>
                </div>
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main className="flex-1 bg-gray-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
              {children}
            </div>
          </main>

          {/* Footer */}
          <footer className="border-t border-gray-200 bg-white">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
              <p className="text-sm text-gray-500 text-center">
                Seer v0.2.0 - Agent Evaluation Framework
              </p>
            </div>
          </footer>
        </div>
        </ToastProvider>
      </body>
    </html>
  )
}
