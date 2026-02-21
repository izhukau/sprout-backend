"use client";

import { Loader2, Sprout } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await register({ email, password, name });
      router.push("/graph");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-svh items-center justify-center bg-[#0A1A0F] px-4">
      {/* Ambient radial glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#2EE84A] opacity-[0.04] blur-[120px]" />
      </div>

      <Card
        className={cn(
          "relative w-full max-w-[420px] overflow-hidden",
          "bg-[rgba(17,34,20,0.55)] backdrop-blur-[16px]",
          "border-[rgba(46,232,74,0.15)]",
          "shadow-[0_8px_32px_rgba(0,0,0,0.3)]",
        )}
      >
        {/* Gradient overlay */}
        <div className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-b from-white/[0.06] to-transparent" />

        <CardHeader className="relative text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-[rgba(46,232,74,0.25)] bg-[rgba(46,232,74,0.1)]">
            <Sprout className="h-5 w-5 text-[#2EE84A]" />
          </div>
          <CardTitle className="text-xl text-white">Create account</CardTitle>
          <CardDescription className="text-[#b0b8b4]">
            Start your adaptive learning journey
          </CardDescription>
        </CardHeader>

        <CardContent className="relative">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="name" className="text-[#b0b8b4]">
                Name
              </Label>
              <Input
                id="name"
                type="text"
                placeholder="Your name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="border-[#1e3d24] bg-[#0d2010] text-white placeholder:text-[#4a5a4e] focus-visible:ring-[#2EE84A]/50"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="email" className="text-[#b0b8b4]">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="border-[#1e3d24] bg-[#0d2010] text-white placeholder:text-[#4a5a4e] focus-visible:ring-[#2EE84A]/50"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password" className="text-[#b0b8b4]">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="border-[#1e3d24] bg-[#0d2010] text-white placeholder:text-[#4a5a4e] focus-visible:ring-[#2EE84A]/50"
              />
            </div>

            <Button
              type="submit"
              disabled={isSubmitting}
              className="mt-2 h-10 w-full bg-[#2EE84A] font-semibold text-[#0A1A0F] hover:bg-[#3DBF5A] disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin" />
                  Creating account...
                </>
              ) : (
                "Create account"
              )}
            </Button>
          </form>
        </CardContent>

        <CardFooter className="relative flex-col gap-4">
          <Separator className="bg-[rgba(46,232,74,0.12)]" />
          <p className="text-sm text-[#b0b8b4]">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-[#2EE84A] transition-colors hover:text-[#3DBF5A]"
            >
              Sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
