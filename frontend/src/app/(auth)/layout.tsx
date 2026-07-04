export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen pl-14 flex items-center justify-center px-4 bg-neutral-950">
      {children}
    </main>
  );
}
