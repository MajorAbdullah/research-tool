/**
 * The sign-in page. Assumes the root layout (`src/app/layout.tsx`, owned by another phase)
 * already provides `<html>`/`<body>` and global styles — this file only exports a page
 * component, per this phase's scope.
 *
 * Submits through an inline Server Action rather than a client-side `onSubmit` — no client JS
 * needed for the common case, and it's the pattern next-auth v5 itself documents for credentials
 * sign-in under the App Router.
 */

import { redirect } from 'next/navigation'
import { AuthError } from 'next-auth'
import { signIn } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>
}

async function authenticate(formData: FormData): Promise<void> {
  'use server'

  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  try {
    // redirect: true (the default) means a *successful* signIn never returns — it throws
    // Next.js's internal redirect signal, which must propagate past this catch untouched (see
    // the re-throw below). Only a genuine auth failure (`AuthError`/`CredentialsSignin`) is ours
    // to handle.
    await signIn('credentials', { email, password, redirectTo: '/' })
  } catch (err) {
    if (err instanceof AuthError) {
      // Deliberately the same generic outcome regardless of *why* authorize() returned null
      // (unknown email vs. wrong password) — see src/lib/auth.ts on no user enumeration.
      redirect('/login?error=1')
    }
    throw err
  }
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold text-foreground">Sign in to Sieve</h1>
          <p className="text-sm text-muted-foreground">Your self-hosted research library.</p>
        </div>

        <form action={authenticate} className="space-y-4 rounded-lg border border-border p-6">
          {error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Invalid email or password.
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>

          <Button type="submit" className="w-full">
            Sign in
          </Button>
        </form>
      </div>
    </main>
  )
}
