/**
 * Auth pages (M3 spec §Frozen Interface): AuthErrorPage renders generic
 * failure copy (SEC-007 — no internals leaked) with a retry link;
 * SignedOutPage confirms logout. No dashboard mock covers these — kept
 * minimal, composed from Layout, existing tokens only (structure mirrors
 * the verify not-found centered card). Pure components: no D1/env/fetch.
 */

import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';
import { sealSvg } from '../badges/seal';
import { Layout } from './layout';

export function AuthErrorPage() {
  return (
    <AuthFrame title="GitCert — sign-in error">
      <div class="font-mono text-[14px] tracking-[-0.1px] text-soft">
        Sign-in didn&apos;t complete.
      </div>
      <div class="mt-[14px] font-mono text-[12px] text-muted">
        <a data-nav href="/auth/login" class="text-accent">
          try again
        </a>
      </div>
    </AuthFrame>
  );
}

export function SignedOutPage() {
  return (
    <AuthFrame title="GitCert — signed out">
      <div class="font-mono text-[14px] tracking-[-0.1px] text-soft">You&apos;re signed out.</div>
      <div class="mt-[14px] font-mono text-[12px] text-muted">
        <a data-nav href="/auth/login" class="text-accent">
          sign in
        </a>
      </div>
    </AuthFrame>
  );
}

/** Shared minimal card: shell + brand mark + centered mono message. */
function AuthFrame(props: { title: string; children?: Child }) {
  return (
    <Layout title={props.title}>
      <div class="mx-auto max-w-[680px] px-4 pt-8 pb-16 sm:px-7 sm:pt-[52px] sm:pb-24">
        <div class="border border-hair-strong bg-card shadow-[0_1px_0_rgba(0,0,0,0.03)]">
          <div class="px-5 pt-6 pb-7 sm:px-[44px] sm:pt-[34px] sm:pb-10">
            <div class="flex items-center gap-[10px]">
              {raw(sealSvg({ size: 26, kind: 'check', color: 'var(--accent)' }))}
              <span class="font-mono text-[19px] font-semibold tracking-[-0.4px]">GitCert</span>
            </div>
            <div class="my-6 h-px bg-hair" />
            <div class="flex min-h-[180px] flex-col items-center justify-center pt-8 pb-10 text-center">
              {props.children}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
