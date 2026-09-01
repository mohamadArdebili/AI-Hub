"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { LoginView } from "@/components/auth/login-view";
import { ChatView } from "@/components/app/chat-view";
import { AdminView } from "@/components/app/admin-view";
import { Loader2 } from "lucide-react";

export default function Home() {
  const { session, isLoading, currentView, initialize } = useAuthStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Show loading spinner while checking session
  if (isLoading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not authenticated → show login
  if (!session?.user) {
    return <LoginView />;
  }

  // Admin panel view
  if (currentView === "admin") {
    return <AdminView />;
  }

  // Default: chat view
  return <ChatView />;
}
