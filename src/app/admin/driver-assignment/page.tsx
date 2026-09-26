import { redirect } from "next/navigation";

export default function DriverAssignmentRedirect() {
  redirect("/admin/smart-allocation?tab=drivers");
}
