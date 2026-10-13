import { getGeneralSettings } from "@/lib/general-settings";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { applicationName } = await getGeneralSettings();
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-md">
        <h1 className="mb-4 break-words text-center text-2xl font-bold text-white">{applicationName}</h1>
        {children}
      </div>
    </div>
  );
}
