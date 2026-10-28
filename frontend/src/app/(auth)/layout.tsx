import { LegalLinks } from "@/components/ui/LegalLinks";
import { PageCenter } from "@/components/ui/PageFrame";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main>
      <PageCenter className="px-4 bg-neutral-950">
        <div className="flex flex-col items-center gap-4">
          {children}
          <LegalLinks />
        </div>
      </PageCenter>
    </main>
  );
}
