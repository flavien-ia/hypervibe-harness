import { redirect } from "next/navigation";
import { isAdmin } from "~/server/auth";

export default async function AdminProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isAdmin())) {
    redirect("/admin/signin?callbackUrl=/admin");
  }
  return <>{children}</>;
}
