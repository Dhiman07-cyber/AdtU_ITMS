"use client";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/contexts/toast-context";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface SignOutButtonProps {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  showText?: boolean;
  className?: string;
  onClick?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  suppressTrigger?: boolean;
}

import { cn } from "@/lib/utils";

export function SignOutButton({
  variant = "ghost",
  size = "default",
  showText = true,
  className,
  onClick,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
  suppressTrigger = false
}: SignOutButtonProps) {
  const { signOut } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setIsOpen = setControlledOpen !== undefined ? setControlledOpen : setInternalOpen;

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      const response = await signOut();

      if (response.success) {
        showToast("Signed out successfully", "success");
        // Redirect to home page after sign out
        router.push("/");
      } else {
        showToast(response.error || "Failed to sign out", "error");
      }
    } catch (error) {
      showToast("An unexpected error occurred", "error");
    } finally {
      setIsSigningOut(false);
      setIsOpen(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {!suppressTrigger && (
        <DialogTrigger asChild>
          <Button
            variant={variant}
            size={size}
            onClick={onClick}
            className={cn(
              "w-full transition-all duration-200 text-sm font-medium rounded-lg px-3 py-2 gap-3 hover:scale-[1.02] active:scale-[0.98]",
              !className?.includes('justify-') && "justify-start hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400",
              className
            )}
          >
            <LogOut className="h-4 w-4" />
            {showText && <span>Sign Out</span>}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="z-[10001]">
        <DialogHeader>
          <DialogTitle>Sign Out</DialogTitle>
          <DialogDescription>
            Are you sure you want to sign out? You will need to sign in again to access your account.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setIsOpen(false)}
            disabled={isSigningOut}
            className="bg-white text-black border-gray-300 hover:bg-gray-50 hover:text-black"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {isSigningOut ? "Signing out..." : "Sign out"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}