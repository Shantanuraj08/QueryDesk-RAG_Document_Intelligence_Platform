"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { signInWithGoogle } from "@/lib/google-auth";

const inputClassName =
  "w-full px-3.5 py-2.5 text-sm text-gray-900 bg-white border border-gray-300 rounded-lg placeholder-gray-400 focus:outline-none focus:border-gray-500 focus:ring-1 focus:ring-gray-500";
const labelClassName =
  "block text-xs sm:text-sm font-medium text-gray-700 mb-1.5";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isLoading) return;

    setError(null);

    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }

    if (!password) {
      setError("Please enter your password.");
      return;
    }

    setIsLoading(true);

    try {
      const res = await authClient.signIn.email({
        email: email.trim(),
        password,
      });

      if (res.error) {
        setError(res.error.message || "Invalid email or password. Please try again.");
        return;
      }

      router.push("/");
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

const handleGoogleSignIn = async () => {
  if (isLoading) return;

  setError(null);
  setIsLoading(true);

  try {
    const res = await signInWithGoogle();

    if (res.error) {
      setError(res.error.message || "Google sign-in failed.");
    }
  } catch (err: unknown) {
    const msg =
      err instanceof Error
        ? err.message
        : "Google sign-in failed.";

    setError(msg);
  } finally {
    setIsLoading(false);
  }
};

  return (
    <div className="min-h-screen bg-white text-gray-900 flex flex-col justify-between p-6 sm:p-10">
      {/* Top-Left Branding */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 border border-gray-200">
          <Image
            src="/images/netherstar.webp"
            alt="QueryDesk"
            width={32}
            height={32}
            className="w-full h-full object-cover"
            priority
          />
        </div>
        <div className="flex flex-col">
          <span className="text-base font-semibold text-gray-900 leading-none">
            QueryDesk
          </span>
          <span className="text-[11px] text-gray-500 mt-1 leading-none">
            RAG-Powered Document Intelligence Platform
          </span>
        </div>
      </div>

      {/* Main Centered Form Container */}
      <div className="w-full max-w-md mx-auto my-auto py-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl sm:text-[28px] font-semibold text-gray-900 tracking-tight">
            Welcome back
          </h1>
          <p className="text-xs sm:text-sm text-gray-600 mt-1.5">
            Don&apos;t have an account?{" "}
            <Link
              href="/signup"
              className="text-gray-900 underline hover:text-black font-medium"
            >
              Sign up
            </Link>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className={labelClassName}>
              What&apos;s your email?
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email address"
              className={inputClassName}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="password" className="text-xs sm:text-sm font-medium text-gray-700">
                Password
              </label>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="text-gray-500 hover:text-gray-700 focus:outline-none transition-colors"
              >
                {showPassword ? (
                  <EyeOff size={16} />
                ) : (
                  <Eye size={16} />
                )}
              </button>
            </div>
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className={inputClassName}
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 rounded-full text-sm font-medium text-white bg-[#b5b5b5] hover:bg-[#9e9e9e] active:bg-[#8f8f8f] transition-colors focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isLoading ? "Logging in..." : "Log in"}
            </button>
          </div>
        </form>

        <div className="flex items-center gap-4 my-6">
          <div className="flex-1 border-t border-gray-200" />
          <span className="text-xs text-gray-400 font-medium">OR</span>
          <div className="flex-1 border-t border-gray-200" />
        </div>

        {/* Continue with Google Section */}
        <div className="text-center">
          <p className="text-xs text-gray-500 mb-3 font-normal">
            Continue with Google
          </p>
          <div className="flex justify-center">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              aria-label="Continue with Google"
              className="w-full sm:w-auto min-w-[200px] inline-flex items-center justify-center gap-2.5 px-6 py-2.5 bg-white border border-gray-300 rounded-full text-xs sm:text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors focus:outline-none cursor-pointer shadow-2xs disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  fill="#EA4335"
                />
              </svg>
              <span>Google</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
