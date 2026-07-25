"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useState } from "react";

const navLinks = [
  { href: "/picks", label: "My Picks" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/settings", label: "Settings" },
];

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  // Mirror the login flow (signIn redirect:false + client-side router.push):
  // signOut's default redirect:true resolves the callbackUrl against
  // NEXTAUTH_URL server-side and returns an absolute URL, so from a non-localhost
  // origin (LAN IP, alternate hostname) it lands on localhost/login. redirect:false
  // + a relative push keeps logout on the same origin. (#78)
  const handleSignOut = async () => {
    await signOut({ redirect: false });
    router.push("/login");
  };

  return (
    <nav className="border-b border-gray-800 bg-gray-900">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/picks" className="text-lg font-bold tracking-tight transition-opacity hover:opacity-80">
            GFL Survivor
          </Link>

          {/* Desktop nav */}
          <div className="hidden sm:flex gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  pathname === link.href
                    ? "bg-gray-800 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            ))}
            {session?.user?.role === "ADMIN" && (
              <Link
                href="/admin"
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  pathname.startsWith("/admin")
                    ? "bg-gray-800 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                Admin
              </Link>
            )}
          </div>
        </div>

        {/* Desktop user info */}
        <div className="hidden sm:flex items-center gap-4">
          <span className="text-sm text-gray-400">{session?.user?.name}</span>
          <button
            onClick={handleSignOut}
            className="text-sm text-gray-400 hover:text-white"
          >
            Sign out
          </button>
        </div>

        {/* Mobile hamburger */}
        <button
          className="sm:hidden p-2 text-gray-400 hover:text-white transition-transform active:scale-90"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {menuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="sm:hidden border-t border-gray-800 pb-3 animate-fade-in">
          <div className="space-y-1 px-4 pt-2">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className={`block rounded-md px-3 py-2 text-sm font-medium ${
                  pathname === link.href
                    ? "bg-gray-800 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            ))}
            {session?.user?.role === "ADMIN" && (
              <Link
                href="/admin"
                onClick={() => setMenuOpen(false)}
                className={`block rounded-md px-3 py-2 text-sm font-medium ${
                  pathname.startsWith("/admin")
                    ? "bg-gray-800 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                Admin
              </Link>
            )}
          </div>
          <div className="mt-3 border-t border-gray-800 px-4 pt-3">
            <div className="text-sm text-gray-400 mb-2">{session?.user?.name}</div>
            <button
              onClick={handleSignOut}
              className="text-sm text-gray-400 hover:text-white"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
