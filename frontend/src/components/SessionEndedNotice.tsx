"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { isAuthRoute } from "@/lib/auth-routes";
import { loginNext } from "@/lib/navigation";
import { Button } from "@/components/ui/Button";
import { FORM_ERROR_BANNER } from "@/components/ui/form-styles";
import { TEXT_LINK } from "@/components/ui/styles";

/** Tells a reader whose session ended that they are signed out now, with the way back to the
 *  page they were on. It floats at the foot of the viewport until they sign in or dismiss it.
 *  On the sign-in page, where a protected page sends them, the form is the way back. */
export default function SessionEndedNotice() {
  const { user, sessionEnded, dismissSessionEnded } = useAuth();
  const pathname = usePathname() ?? "/";
  const onSignIn = pathname === "/login";
  if (!sessionEnded || user || (isAuthRoute(pathname) && !onSignIn)) return null;
  return (
    <div className="fixed inset-x-4 bottom-4 z-1200 mx-auto max-w-md">
      <div role="alert" className={`${FORM_ERROR_BANNER} flex items-center gap-3 shadow-lg`}>
        <p className="flex-1">
          Your session ended.
          {!onSignIn && (
            <>
              {" "}
              <Link href={loginNext(pathname)} className={TEXT_LINK}>
                Sign in again
              </Link>
              .
            </>
          )}
        </p>
        <Button icon variant="ghost" aria-label="Dismiss" onClick={dismissSessionEnded}>
          <X size={14} />
        </Button>
      </div>
    </div>
  );
}
